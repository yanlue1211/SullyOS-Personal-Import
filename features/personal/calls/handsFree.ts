import {recordingToWav} from '../chatMedia/recording';
import {startStt,type SttSession} from '../../../utils/speechToText';
import type {APIConfig} from '../../../types';
import {SpeechTurnGate,SpeechAnalysisClock,waveformRms,TURN_PAUSE_MS,captureProgressReporter,type CaptureOptions} from '../audio/speechTurn';
export {SpeechTurnGate} from '../audio/speechTurn';
export function abortError(){return new DOMException('已停止免手持','AbortError');}
/** Match Yueqi's fixed recorder: native encoded capture; the analyser only observes silence. */
export async function captureSpeechTurn(context:AudioContext|undefined,signal:AbortSignal,options:CaptureOptions={}):Promise<{audio?:Blob;duration:number}>{
 const report=captureProgressReporter(options.onProgress);
 signal.throwIfAborted();
 if(typeof MediaRecorder==='undefined')throw new Error('当前浏览器不支持稳定录音，请使用原生识别。');
 const stream=await navigator.mediaDevices.getUserMedia({audio:true});
 if(signal.aborted){stream.getTracks().forEach(track=>track.stop());throw abortError();}
 return new Promise((resolve,reject)=>{
  let recorder:MediaRecorder|undefined,source:MediaStreamAudioSourceNode|undefined,ownedContext:AudioContext|undefined;
  let timer:ReturnType<typeof setInterval>|undefined,closed=false,stopping=false,released=false,parts:Blob[]=[],voiced=false;
  let analyser:AnalyserNode|undefined,muted:GainNode|undefined,activeContext:AudioContext|undefined;
  const started=performance.now();let stoppedAt=started;
  const release=()=>{if(released)return;released=true;clearInterval(timer);source?.disconnect();analyser?.disconnect();muted?.disconnect();stream.getTracks().forEach(track=>track.stop());void ownedContext?.close().catch(()=>{});};
  const done=(error?:unknown,result?:{audio?:Blob;duration:number})=>{if(closed)return;closed=true;signal.removeEventListener('abort',abort);release();parts=[];error?reject(error):resolve(result!);};
  const abort=()=>{done(abortError());if(recorder?.state==='recording')recorder.stop();};
  signal.addEventListener('abort',abort,{once:true});
  const stop=()=>{if(!closed&&!stopping&&recorder?.state==='recording'){if(options.manual)voiced=true;stopping=true;report({state:'complete'});stoppedAt=performance.now();recorder.stop();}};
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
    let samples:Float32Array<ArrayBuffer>|undefined;
    if(!options.manual){
     activeContext=context||(ownedContext=new AudioContext());await activeContext.resume();if(closed)return;
     source=activeContext.createMediaStreamSource(stream);analyser=activeContext.createAnalyser();analyser.fftSize=2048;source.connect(analyser);muted=activeContext.createGain();muted.gain.value=0;analyser.connect(muted);muted.connect(activeContext.destination);samples=new Float32Array(analyser.fftSize);
    }
    if(closed)return;
    const gate=new SpeechTurnGate(),clock=new SpeechAnalysisClock();
    let recoveryAt=-Infinity,recoveries=0,resuming=false,analysisProblem=false;
    recorder.start();options.onStarted?.(()=>{voiced=true;stop();});if(stopping||closed)return;report({state:options.manual?'speaking':'calibrating'});
    timer=setInterval(()=>{
     if(closed||stopping)return;const now=performance.now();
     if(analyser&&samples&&activeContext){
      if(!clock.healthy(activeContext.currentTime,activeContext.state,now)){
       analysisProblem=true;gate.hold(now);report({state:'interrupted'});
       if(!resuming&&recoveries<3&&now-recoveryAt>=1000){
        recoveryAt=now;recoveries++;resuming=true;
        void Promise.resolve().then(()=>{if(!closed)return activeContext!.resume();}).catch(()=>{}).finally(()=>{resuming=false;});
       }
      }else{
       analysisProblem=false;
       analyser.getFloatTimeDomainData(samples);const state=gate.update(waveformRms(samples),now);
       report({state,remainingMs:state==='pausing'?gate.remainingMs:undefined});
       if(state==='complete'){voiced=true;stop();return;}
      }
     }
     if(now-started>=(options.manual||gate.hasSpeech||analysisProblem?120_000:30_000)){voiced=gate.hasSpeech||analysisProblem;stop();}

    },100);
   }catch(error){done(error);}
  })();
  if(signal.aborted)abort();
 });
}
export function captureBrowserSpeech(config:Partial<APIConfig>,language:string,signal:AbortSignal,options:CaptureOptions={}):Promise<string>{
 const report=captureProgressReporter(options.onProgress);
 return new Promise((resolve,reject)=>{
  let text='',base='',session:SttSession|undefined,closed=false,stopping=false,lastResult=0,generation=0;
  let timer:ReturnType<typeof setInterval>|undefined,endTimer:ReturnType<typeof setTimeout>|undefined,restart:ReturnType<typeof setTimeout>|undefined;
  const started=performance.now();
  const finish=(error?:Error)=>{if(closed)return;closed=true;clearInterval(timer);clearTimeout(endTimer);clearTimeout(restart);signal.removeEventListener('abort',abort);error?reject(error):resolve(text.trim());};
  const abort=()=>{finish(abortError());session?.stop();};
  const stop=()=>{if(closed||stopping)return;stopping=true;clearInterval(timer);clearTimeout(restart);report({state:'complete'});endTimer=setTimeout(()=>finish(),1500);if(session)session.stop();else finish();};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  const open=()=>{
   if(closed||stopping)return;
   const token=++generation;
   const combine=(value:string)=>(base+' '+value).trim();
   void startStt(language,{
    onPartial:value=>{
     if(closed||stopping||token!==generation||!value.trim())return;
     const combined=combine(value),activity=(value:string)=>value.replace(/[\s\p{P}\p{S}]/gu,'');
     const changed=activity(combined)!==activity(text);text=combined;if(!changed)return;
     lastResult=performance.now();report({state:'speaking'});
    },
    onFinal:value=>{if(!closed&&token===generation&&value.trim())text=combine(value);},
    onEnd:()=>{
     if(closed||token!==generation)return;
     session=undefined;
     // Mobile browsers can end their own recognition session at a short pause.
     // Keep the same turn and countdown alive so resuming speech can extend it.
     if(!stopping&&text&&performance.now()-lastResult<TURN_PAUSE_MS){base=text;generation++;restart=setTimeout(open,100);}
     else finish();
    },
    onError:message=>{if(closed||token!==generation)return;if(message==='没听清，再试一次？'){if(!text){finish();session?.stop();}}else if(message){finish(new Error(message));session?.stop();}},
   },{...config,sttProvider:'browser'} as any).then(value=>{
    if(closed||stopping||token!==generation){value.stop();return;}
    session=value;
    if(timer)return;
    options.onStarted?.(stop);if(closed||stopping)return;report({state:'waiting'});
    timer=setInterval(()=>{
     if(closed||stopping)return;
     const now=performance.now(),silence=text?now-lastResult:0;
     if(text&&silence>=TURN_PAUSE_MS){stop();return;}
     if(text&&silence>=300)report({state:'pausing',remainingMs:TURN_PAUSE_MS-silence});
     if(now-started>=(text?120_000:30_000))stop();
    },100);
   }).catch(error=>{if(token===generation)finish(error);});
  };
  open();
 });
}
