import {it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('./audioApi',()=>({audioBlobToPayload:vi.fn(async()=>({format:'wav',data:'audio',bytes:100})),recognizeUserRecording:vi.fn(async()=>({transcript:'我盖好被子了。',analysis:'声音轻柔，稍有困意。'}))}));
vi.mock('./speechToText',()=>({resolveSttProvider:()=> 'browser',startStt:vi.fn(),transcribeAudioWithProvider:vi.fn(),encodeWavFromFloat32:()=>new Blob(['wav'],{type:'audio/wav'})}));
import {handsFree} from '../features/yueqi/listen';
import {recognizeUserRecording} from './audioApi';
import {startStt} from './speechToText';
import {turnContext} from '../features/yueqi/model';
let processor:any,now=1000,stop=vi.fn();
class FakeContext{sampleRate=16000;async resume(){}async close(){}createMediaStreamSource(){return{connect(){},disconnect(){}};}createScriptProcessor(){processor={connect(){},disconnect(){},onaudioprocess:null};return processor;}createGain(){return{gain:{value:1},connect(){},disconnect(){}};}destination={};}
const api={enabled:true,baseUrl:'https://audio.test',apiKey:'test',model:'test'} as any;
const callbacks=()=>({text:vi.fn(),speech:vi.fn(),end:vi.fn(),error:vi.fn()});
const sample=(level:number,advance=300)=>{now+=advance;processor.onaudioprocess({inputBuffer:{getChannelData:()=>Float32Array.from({length:4096},(_,i)=>(i%2?1:-1)*level)}});};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
beforeEach(()=>{now=1000;stop=vi.fn();vi.stubGlobal('AudioContext',FakeContext);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop}]}))}});vi.spyOn(performance,'now').mockImplementation(()=>now);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it('manual recording uses audio API for text/tone and does not end at a short pause',async()=>{const cb=callbacks(),cancel=await handsFree({} as any,cb,{audioApi:api,manual:true});sample(.1);sample(0,2200);expect(recognizeUserRecording).not.toHaveBeenCalled();cancel.finish!();await settle();expect(startStt).not.toHaveBeenCalled();expect(cb.text).toHaveBeenCalledWith('我盖好被子了。','声音轻柔，稍有困意。');expect(stop).toHaveBeenCalledTimes(1);});
it('hands-free audio API mode ends on silence and returns separate tone',async()=>{const cb=callbacks();await handsFree({} as any,cb,{audioApi:api});for(let i=0;i<7;i++)sample(0,100);for(let i=0;i<8;i++)sample(.1,100);sample(0,4100);await settle();expect(recognizeUserRecording).toHaveBeenCalledTimes(1);expect(cb.text).toHaveBeenCalledWith(expect.any(String),expect.any(String));});
it('cancellation discards pending recognition and frees microphone',async()=>{let resolve:any;vi.mocked(recognizeUserRecording).mockImplementationOnce(()=>new Promise(r=>resolve=r));const cb=callbacks(),cancel=await handsFree({} as any,cb,{audioApi:api,manual:true});sample(.1);cancel.finish!();await settle();cancel();resolve({transcript:'迟到的结果',analysis:'语气'});await settle();expect(cb.text).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledTimes(1);});
it('tone reaches context without becoming user transcript',()=>{const turn={role:'user',text:'我盖好被子了。',voiceAnalysis:'语气轻柔。'} as any;expect(turnContext(turn)).toContain('[声音细节，非用户原话]');expect(turn.text).toBe('我盖好被子了。');});
