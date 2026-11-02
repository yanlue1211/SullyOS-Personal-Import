import {audioBlobToPayload,recognizeUserRecording} from '../../utils/audioApi';
import type {AudioApiConfig} from '../../types';
export type CaptureCancel=(()=>void)&{finish?:()=>void};
import type {APIConfig} from '../../types';
import {resolveSttProvider,startStt,transcribeAudioWithProvider,encodeWavFromFloat32} from '../../utils/speechToText';
/** Session-local endpointing. No recording while the character plays. Cancel discards audio. */
export async function handsFree(api:APIConfig,cb:{text:(text:string,analysis?:string)=>void;error:(error:unknown)=>void;end:()=>void;speech:(active:boolean)=>void},options:{audioApi?:AudioApiConfig;manual?:boolean;transcribing?:()=>void}={}):Promise<CaptureCancel>{
 let cancelled=false;
 if(!options.audioApi&&resolveSttProvider(api)==='browser'){
  const session=await startStt('zh-CN',{onPartial:t=>cb.speech(!!t.trim()),onFinal:t=>{if(!cancelled&&t.trim())cb.text(t);},onError:e=>{if(!cancelled)cb.error(e);},onEnd:()=>{if(!cancelled)cb.end();}},api);
  return()=>{cancelled=true;session.stop();};
 }
 if(!navigator.mediaDevices?.getUserMedia)throw Error('当前环境无法录音，请检查麦克风权限或使用支持录音的浏览器。');
 const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 let ctx:AudioContext;try{ctx=new AudioContext();await ctx.resume();}catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}const source=ctx.createMediaStreamSource(stream);const processor=ctx.createScriptProcessor(4096,1,1);const mute=ctx.createGain();mute.gain.value=0;
 let chunks:Float32Array[]=[],pre:Float32Array[]=[],started=0,lastVoice=0,voiced=0,finished=false;
 const cleanup=()=>{processor.disconnect();source.disconnect();mute.disconnect();stream.getTracks().forEach(t=>t.stop());void ctx.close();};
 const finish=async()=>{if(finished)return;finished=true;cleanup();if(cancelled)return;
  if(!options.manual&&voiced<(options.audioApi? .2 : .65)){cb.speech(false);cb.end();return;}cb.speech(true);options.transcribing?.();
  const count=chunks.reduce((n,c)=>n+c.length,0);if(!count){cb.error(Error('录音太短，请再说一次。'));cb.end();return;}const pcm=new Float32Array(count);let offset=0;for(const c of chunks){pcm.set(c,offset);offset+=c.length;}chunks=[];
  try{const wav=encodeWavFromFloat32(pcm,ctx.sampleRate,16000);const result=options.audioApi
   ?await recognizeUserRecording(await audioBlobToPayload(wav),options.audioApi)
   :{transcript:await transcribeAudioWithProvider(wav,resolveSttProvider(api) as 'minimax'|'fishaudio'|'elevenlabs','zh-CN',api),analysis:''};
   if(!cancelled){if(/[\p{L}\p{N}]/u.test(result.transcript))cb.text(result.transcript,result.analysis);else if(options.manual)cb.error(Error('没有识别到清楚的话语，请再说一次。'));}
  }catch(e){if(!cancelled)cb.error(e instanceof Error?Error(e.message.replace('录音已保留，请重试。','请重新录音。')):e);}finally{if(!cancelled)cb.end();}
 };
 processor.onaudioprocess=e=>{if(finished||cancelled)return;const samples=e.inputBuffer.getChannelData(0);const copy=new Float32Array(samples);const seconds=copy.length/ctx.sampleRate;const rms=Math.sqrt(copy.reduce((sum,x)=>sum+x*x,0)/copy.length);const now=performance.now();if(options.manual&&!started)started=now;
  if(rms>.018){if(!started){started=now;chunks=pre;pre=[];}voiced+=seconds;lastVoice=now;cb.speech(true);}
  if(started){chunks.push(copy);if((!options.manual&&now-lastVoice>1500)||now-started>30000)void finish();}else{pre.push(copy);if(pre.length>4)pre.shift();}
 };
 source.connect(processor);processor.connect(mute);mute.connect(ctx.destination);
 const cancel:CaptureCancel=()=>{cancelled=true;if(!finished){finished=true;cleanup();}cb.speech(false);};cancel.finish=()=>{void finish();};return cancel;
}
