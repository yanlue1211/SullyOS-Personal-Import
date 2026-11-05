import {it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('../features/personal/chatMedia/recording',()=>({recordingToWav:vi.fn(async()=>new Blob(['converted'],{type:'audio/wav'}))}));
vi.mock('./audioApi',()=>({audioBlobToPayload:vi.fn(async()=>({format:'wav',data:'audio',bytes:100})),recognizeUserRecording:vi.fn(async()=>({transcript:'盖好被子了',analysis:'声音轻柔'}))}));
vi.mock('./speechToText',()=>({resolveSttProvider:()=> 'elevenlabs',startStt:vi.fn(),transcribeAudioWithProvider:vi.fn(async()=> '识别原文')}));
import {handsFree} from '../features/yueqi/listen';
import {recognizeUserRecording} from './audioApi';
import {recordingToWav} from '../features/personal/chatMedia/recording';
let stop=vi.fn(),level=.1,contextCount=0;
class Recorder {
 static isTypeSupported(type:string){return type.includes('webm');}
 state='inactive';mimeType='audio/webm;codecs=opus';
 ondataavailable?: (e:any)=>void;onstop?:()=>void;onerror?:()=>void;
 constructor(public stream:any){}
 start(){this.state='recording';}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['recorded'])});queueMicrotask(()=>this.onstop?.());}
}
class Context {
 constructor(){contextCount++;}
 async resume(){} async close(){}
 createGain(){return{gain:{value:1},connect(){},disconnect(){}};} destination={};
 createMediaStreamSource(){return{connect(){},disconnect(){}};}
 createAnalyser(){return{fftSize:2048,connect(){},disconnect(){},getFloatTimeDomainData(samples:Float32Array){samples.forEach((_,i)=>{samples[i]=(i%2?1:-1)*level;});}};}
 createScriptProcessor(){throw Error('Must not capture audio on the main thread');}
}
const cb=()=>({text:vi.fn(),speech:vi.fn(),error:vi.fn(),end:vi.fn()});
const api={enabled:true,baseUrl:'https://audio.test',apiKey:'test',model:'test'} as any;
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
beforeEach(()=>{
 vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>Date.now());
 stop=vi.fn();level=.1;contextCount=0;
 vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('AudioContext',Context);
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop}]}))}});
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it('manual capture uses the working chat recorder and conversion without a live PCM graph',async()=>{
 const c=cb();const cancel=await handsFree({} as any,c,{manual:true,audioApi:api});
 expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({audio:true});
 expect(contextCount).toBe(0);await vi.advanceTimersByTimeAsync(2000);expect(recognizeUserRecording).not.toHaveBeenCalled();
 cancel.finish!();cancel.finish!();await settle();
 expect(recordingToWav).toHaveBeenCalledTimes(1);expect(c.text).toHaveBeenCalledWith('盖好被子了','声音轻柔');expect(stop).toHaveBeenCalledTimes(1);expect(c.end).toHaveBeenCalledTimes(1);
});
it('automatic mode observes silence without collecting PCM and finishes after speech',async()=>{
 level=0;const c=cb();await handsFree({} as any,c,{audioApi:api});
 await vi.advanceTimersByTimeAsync(700);level=.1;await vi.advanceTimersByTimeAsync(700);level=0;await vi.advanceTimersByTimeAsync(4100);await settle();
 expect(c.text).toHaveBeenCalledWith('盖好被子了','声音轻柔');expect(stop).toHaveBeenCalledTimes(1);
});
it('cancellation before stop discards the recording',async()=>{
 const c=cb();const cancel=await handsFree({} as any,c,{manual:true,audioApi:api});cancel();await settle();
 expect(recordingToWav).not.toHaveBeenCalled();expect(c.text).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledTimes(1);
});
it('cancellation during recognition suppresses late transcript and tone',async()=>{
 let resolve:any;vi.mocked(recognizeUserRecording).mockImplementationOnce(()=>new Promise(r=>resolve=r));
 const c=cb();const cancel=await handsFree({} as any,c,{manual:true,audioApi:api});cancel.finish!();await settle();expect(c.speech).toHaveBeenLastCalledWith(true);cancel();resolve({transcript:'迟到结果',analysis:'语气'});await settle();expect(c.text).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledTimes(1);
});
it('silent automatic recordings release the microphone at the time limit without sending noise',async()=>{
 level=0;const c=cb();await handsFree({} as any,c,{audioApi:api});await vi.advanceTimersByTimeAsync(30000);await settle();expect(c.end).toHaveBeenCalledTimes(1);expect(recordingToWav).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledTimes(1);
});
it('conversion failure is reported and does not leak microphone resources',async()=>{
 vi.mocked(recordingToWav).mockRejectedValueOnce(Error('decode failed'));const c=cb();const cancel=await handsFree({} as any,c,{manual:true,audioApi:api});cancel.finish!();await settle();expect(c.error).toHaveBeenCalled();expect(c.end).toHaveBeenCalledTimes(1);expect(stop).toHaveBeenCalledTimes(1);
});
