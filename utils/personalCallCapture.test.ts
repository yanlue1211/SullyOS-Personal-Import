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
 createMediaStreamSource=()=>({connect(){},disconnect(){}});
 createAnalyser=()=>({fftSize:2048,getFloatTimeDomainData:(samples:Float32Array)=>samples.fill(level)});
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
 const promise=captureSpeechTurn(undefined,new AbortController().signal);await flush();await vi.advanceTimersByTimeAsync(600);level=0;await vi.advanceTimersByTimeAsync(1500);
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
