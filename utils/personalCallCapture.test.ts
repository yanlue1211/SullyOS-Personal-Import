import {beforeEach,afterEach,it,vi,expect} from 'vitest';
vi.mock('../features/personal/chatMedia/recording',()=>({recordingToWav:vi.fn(async()=>new Blob(['wav'],{type:'audio/wav'}))}));
import {recordingToWav} from '../features/personal/chatMedia/recording';
import {captureSpeechTurn} from '../features/personal/calls/handsFree';
let level=.1,tracks=vi.fn(),contextCount=0;
class Recorder{
 static isTypeSupported=(mime:string)=>mime.includes('webm');
 state='inactive';mimeType='audio/webm';ondataavailable?: (event:any)=>void;onstop?:()=>void;onerror?:()=>void;
 start(){this.state='recording';}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['native encoded audio'])});queueMicrotask(()=>this.onstop?.());}
}
class Context{
 constructor(){contextCount++;}resume=async()=>{};close=async()=>{};
 createGain(){return{gain:{value:1},connect(){},disconnect(){}};} destination={};
 createMediaStreamSource=()=>({connect(){},disconnect(){}});
 createAnalyser=()=>({fftSize:2048,connect(){},disconnect(){},getFloatTimeDomainData:(samples:Float32Array)=>samples.forEach((_,i)=>{samples[i]=(i%2?1:-1)*level;})});
 createScriptProcessor(){throw Error('Main-thread PCM capture must never be used');}
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>Date.now());tracks=vi.fn();level=.1;contextCount=0;
 vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('AudioContext',Context);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop:tracks}]}))}});
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it('click-to-stop records natively, converts only after stop, and needs no live audio graph',async()=>{
 let stop:(()=>void)|undefined;const promise=captureSpeechTurn(undefined,new AbortController().signal,{manual:true,onStarted:fn=>stop=fn});await flush();
 expect(contextCount).toBe(0);expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({audio:true});
 await vi.advanceTimersByTimeAsync(2100);expect(recordingToWav).not.toHaveBeenCalled();stop!();stop!();
 const result=await promise;expect(result.audio?.type).toBe('audio/wav');expect(result.duration).toBeCloseTo(2.1);expect(tracks).toHaveBeenCalledOnce();expect(recordingToWav).toHaveBeenCalledOnce();
});
it('automatic capture only observes silence and preserves actual speech through the native recorder',async()=>{
 level=0;const promise=captureSpeechTurn(undefined,new AbortController().signal);await flush();await vi.advanceTimersByTimeAsync(700);level=.1;await vi.advanceTimersByTimeAsync(700);level=0;await vi.advanceTimersByTimeAsync(4100);
 expect((await promise).audio?.type).toBe('audio/wav');expect(tracks).toHaveBeenCalledOnce();
});
it('an all-silent automatic turn ends without sending an audio API request',async()=>{
 level=0;const promise=captureSpeechTurn(undefined,new AbortController().signal);await flush();await vi.advanceTimersByTimeAsync(30100);
 expect(await promise).toEqual({duration:0});expect(recordingToWav).not.toHaveBeenCalled();expect(tracks).toHaveBeenCalledOnce();
});
it('cancelling while recording discards audio and releases the microphone once',async()=>{
 const controller=new AbortController(),promise=captureSpeechTurn(undefined,controller.signal,{manual:true});await flush();const rejected=expect(promise).rejects.toHaveProperty('name','AbortError');controller.abort();await rejected;await flush();expect(recordingToWav).not.toHaveBeenCalled();expect(tracks).toHaveBeenCalledOnce();
});
it('late decoding after cancellation never delivers audio',async()=>{
 let deliver:(blob:Blob)=>void=()=>{},stop:(()=>void)|undefined;
 vi.mocked(recordingToWav).mockImplementationOnce(()=>new Promise(resolve=>deliver=resolve));
 const controller=new AbortController(),promise=captureSpeechTurn(undefined,controller.signal,{manual:true,onStarted:fn=>stop=fn});await flush();stop!();await flush();
 const rejected=expect(promise).rejects.toHaveProperty('name','AbortError');controller.abort();deliver(new Blob(['late']));await rejected;expect(tracks).toHaveBeenCalledOnce();
});

it('the explicit finish button submits one automatic turn without waiting for the silence gate',async()=>{
 level=0;let stop:(()=>void)|undefined;
 const promise=captureSpeechTurn(undefined,new AbortController().signal,{onStarted:fn=>stop=fn});await flush();await vi.advanceTimersByTimeAsync(800);stop!();
 expect((await promise).audio?.type).toBe('audio/wav');expect(tracks).toHaveBeenCalledOnce();
});

it('removes a constant input bias and still ends a real captured turn on silence',async()=>{
 const context=new Context();context.createAnalyser=()=>({fftSize:2048,connect(){},disconnect(){},getFloatTimeDomainData:(samples:Float32Array)=>samples.forEach((_,i)=>{samples[i]=.04+(i%2?1:-1)*level;})});
 level=0;const result=captureSpeechTurn(context as any,new AbortController().signal);await flush();await vi.advanceTimersByTimeAsync(700);level=.1;await vi.advanceTimersByTimeAsync(700);level=0;await vi.advanceTimersByTimeAsync(4100);
 expect((await result).audio).toBeDefined();expect(tracks).toHaveBeenCalledOnce();
});
it('reports and resumes an interrupted analysis context independently of recording',async()=>{
 const context=new Context();let paused=false;Object.defineProperty(context,'state',{get:()=>paused?'suspended':'running'});Object.defineProperty(context,'currentTime',{get:()=>paused?0:Date.now()/1000});
 context.resume=vi.fn(async()=>{paused=false;});const progress=vi.fn();
 level=0;const result=captureSpeechTurn(context as any,new AbortController().signal,{onProgress:progress});await flush();await vi.advanceTimersByTimeAsync(700);level=.1;await vi.advanceTimersByTimeAsync(700);
 paused=true;await vi.advanceTimersByTimeAsync(100);expect(progress).toHaveBeenCalledWith({state:'interrupted'});expect(context.resume).toHaveBeenCalledTimes(2);
 level=0;await vi.advanceTimersByTimeAsync(4200);expect((await result).audio).toBeDefined();expect(tracks).toHaveBeenCalledOnce();
});
it('does not feed stale loud samples into the gate when resume fails; explicit finish remains available',async()=>{
 const context=new Context();let paused=false;Object.defineProperty(context,'state',{get:()=>paused?'suspended':'running'});Object.defineProperty(context,'currentTime',{get:()=>paused?0:Date.now()/1000});
 context.resume=vi.fn(async()=>{if(paused)throw Error('interrupted');});let finish:()=>void=()=>{};const progress=vi.fn();
 level=0;const result=captureSpeechTurn(context as any,new AbortController().signal,{onProgress:progress,onStarted:stop=>finish=stop});await flush();await vi.advanceTimersByTimeAsync(700);level=.1;await vi.advanceTimersByTimeAsync(700);paused=true;
 await vi.advanceTimersByTimeAsync(6000);expect(recordingToWav).not.toHaveBeenCalled();expect(progress).toHaveBeenLastCalledWith({state:'interrupted'});expect(context.resume).toHaveBeenCalledTimes(4);
 finish();expect((await result).audio).toBeDefined();expect(tracks).toHaveBeenCalledOnce();
});
