import {encodeMonoWav} from '../chatMedia/recording';
import {startStt,type SttSession} from '../../../utils/speechToText';
import type {APIConfig} from '../../../types';
/** Pure silence gate: short pauses/noise never create API requests. */
export class SpeechTurnGate {
 private lastVoice=0;private voicedMs=0;private previous=0;private started=0;
 update(rms:number,now:number):'waiting'|'speaking'|'complete'{
  const delta=this.previous?Math.min(100,Math.max(0,now-this.previous)):0;this.previous=now;
  if(rms>=.016){if(!this.started)this.started=now;this.lastVoice=now;this.voicedMs+=delta;}
  if(!this.started)return 'waiting';
  if(this.voicedMs>=180&&(now-this.lastVoice>=1400||now-this.started>=45_000))return 'complete';
  if(now-this.lastVoice>1600&&this.voicedMs<180){this.started=0;this.voicedMs=0;return 'waiting';}
  return 'speaking';
 }
}
export function abortError(){return new DOMException('已停止免手持','AbortError');}
export async function captureSpeechTurn(context:AudioContext,signal:AbortSignal):Promise<{audio:Blob;duration:number}>{
 signal.throwIfAborted();
 const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 if(signal.aborted){stream.getTracks().forEach(track=>track.stop());throw abortError();}
 try{await context.resume();}catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
 return new Promise((resolve,reject)=>{
  const source=context.createMediaStreamSource(stream),processor=context.createScriptProcessor(2048,1,1),silent=context.createGain();silent.gain.value=0;
  const gate=new SpeechTurnGate();let frames:Float32Array[]=[],pre:Float32Array[]=[],samples=0,closed=false;
  const cleanup=()=>{if(closed)return;closed=true;processor.onaudioprocess=null;source.disconnect();processor.disconnect();silent.disconnect();stream.getTracks().forEach(track=>track.stop());signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(abortError());};signal.addEventListener('abort',abort,{once:true});
  processor.onaudioprocess=event=>{
   if(closed)return;const frame=new Float32Array(event.inputBuffer.getChannelData(0));let sum=0;for(const sample of frame)sum+=sample*sample;
   const state=gate.update(Math.sqrt(sum/frame.length),performance.now());
   if(state==='waiting'){frames=[];samples=0;pre.push(frame);if(pre.length>8)pre.shift();return;}
   if(!frames.length){frames=pre;pre=[];samples=frames.reduce((count,item)=>count+item.length,0);}
   frames.push(frame);samples+=frame.length;
   if(state==='complete'){
    const merged=new Float32Array(samples);let offset=0;for(const item of frames){merged.set(item,offset);offset+=item.length;}
    cleanup();resolve({audio:encodeMonoWav(merged,context.sampleRate),duration:samples/context.sampleRate});
   }
  };
  source.connect(processor);processor.connect(silent);silent.connect(context.destination);
  if(signal.aborted)abort();
 });
}
export function captureBrowserSpeech(config:Partial<APIConfig>,language:string,signal:AbortSignal):Promise<string>{
 return new Promise((resolve,reject)=>{
  let text='',session:SttSession|undefined,closed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const finish=(error?:Error)=>{if(closed)return;closed=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(text.trim());};
  const abort=()=>{finish(abortError());session?.stop();};signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  void startStt(language,{
   onPartial:value=>{text=value;clearTimeout(timer);timer=setTimeout(()=>session?.stop(),1400);},
   onFinal:value=>{text=value;},onEnd:()=>finish(),onError:message=>{if(message==='没听清，再试一次？'){finish();session?.stop();}else if(message){finish(new Error(message));session?.stop();}},
  },{...config,sttProvider:'browser'} as any).then(value=>{session=value;if(closed)value.stop();}).catch(error=>finish(error));
 });
}
