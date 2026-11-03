import {recordingToWav} from '../chatMedia/recording';
import {startStt,type SttSession} from '../../../utils/speechToText';
import type {APIConfig} from '../../../types';
/** Pure silence gate: short pauses/noise never create API requests. */
export class SpeechTurnGate {
 private lastVoice=0;private voicedMs=0;private previous=0;private started=0;
 get hasSpeech(){return this.voicedMs>=180;}
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
/** Match Yueqi's fixed recorder: native encoded capture; the analyser only observes silence. */
export async function captureSpeechTurn(context:AudioContext|undefined,signal:AbortSignal,options:{manual?:boolean;onStarted?:(stop:()=>void)=>void}={}):Promise<{audio?:Blob;duration:number}>{
 signal.throwIfAborted();
 if(typeof MediaRecorder==='undefined')throw new Error('当前浏览器不支持稳定录音，请使用原生识别。');
 const stream=await navigator.mediaDevices.getUserMedia({audio:true});
 if(signal.aborted){stream.getTracks().forEach(track=>track.stop());throw abortError();}
 return new Promise((resolve,reject)=>{
  let recorder:MediaRecorder|undefined,source:MediaStreamAudioSourceNode|undefined,ownedContext:AudioContext|undefined;
  let timer:ReturnType<typeof setInterval>|undefined,closed=false,stopping=false,released=false,parts:Blob[]=[],voiced=false;
  const started=performance.now();let stoppedAt=started;
  const release=()=>{if(released)return;released=true;clearInterval(timer);source?.disconnect();stream.getTracks().forEach(track=>track.stop());void ownedContext?.close().catch(()=>{});};
  const done=(error?:unknown,result?:{audio?:Blob;duration:number})=>{if(closed)return;closed=true;signal.removeEventListener('abort',abort);release();parts=[];error?reject(error):resolve(result!);};
  const abort=()=>{done(abortError());if(recorder?.state==='recording')recorder.stop();};
  signal.addEventListener('abort',abort,{once:true});
  const stop=()=>{if(!closed&&!stopping&&recorder?.state==='recording'){stopping=true;stoppedAt=performance.now();recorder.stop();}};
  void (async()=>{
   try{
    const mimeType=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
    recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);
    recorder.ondataavailable=event=>{if(!closed&&event.data.size)parts.push(event.data);};
    recorder.onerror=()=>{done(new Error('录音中断，请重新录音。'));if(recorder?.state==='recording')recorder.stop();};
    recorder.onstop=async()=>{
     release();if(closed)return;
     if(!options.manual&&!voiced){done(undefined,{duration:0});return;}
     const blob=new Blob(parts,{type:recorder!.mimeType});parts=[];
     if(!blob.size){done(new Error('录音太短，请再说一次。'));return;}
     try{const audio=await recordingToWav(blob);signal.throwIfAborted();done(undefined,{audio,duration:(stoppedAt-started)/1000});}catch(error){done(error);}
    };
    let analyser:AnalyserNode|undefined,samples:Float32Array<ArrayBuffer>|undefined;
    if(!options.manual){
     const activeContext=context||(ownedContext=new AudioContext());await activeContext.resume();if(closed)return;
     source=activeContext.createMediaStreamSource(stream);analyser=activeContext.createAnalyser();analyser.fftSize=2048;source.connect(analyser);samples=new Float32Array(analyser.fftSize);
    }
    if(closed)return;
    const gate=new SpeechTurnGate();recorder.start();options.onStarted?.(stop);
    timer=setInterval(()=>{
     if(closed||stopping)return;const now=performance.now();
     if(analyser&&samples){analyser.getFloatTimeDomainData(samples);let sum=0;for(const sample of samples)sum+=sample*sample;const state=gate.update(Math.sqrt(sum/samples.length),now);if(state==='complete'){voiced=true;stoppedAt=now;stop();return;}}
     if(now-started>=(options.manual?120_000:30_000)){voiced=gate.hasSpeech;stop();}
    },100);
   }catch(error){done(error);}
  })();
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
