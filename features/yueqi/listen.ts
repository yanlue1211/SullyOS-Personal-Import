import type {APIConfig} from '../../types';
import {resolveSttProvider,startStt,transcribeAudioWithProvider,encodeWavFromFloat32} from '../../utils/speechToText';
/** Session-local endpointing. No recording while the character plays. Cancel discards audio. */
export async function handsFree(api:APIConfig,cb:{text:(text:string)=>void;error:(error:unknown)=>void;end:()=>void;speech:(active:boolean)=>void}):Promise<()=>void>{
 let cancelled=false;
 if(resolveSttProvider(api)==='browser'){
  const session=await startStt('zh-CN',{onPartial:t=>cb.speech(!!t.trim()),onFinal:t=>{if(!cancelled&&t.trim())cb.text(t);},onError:e=>{if(!cancelled)cb.error(e);},onEnd:()=>{if(!cancelled)cb.end();}},api);
  return()=>{cancelled=true;session.stop();};
 }
 const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 let ctx:AudioContext;try{ctx=new AudioContext();await ctx.resume();}catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}const source=ctx.createMediaStreamSource(stream);const processor=ctx.createScriptProcessor(4096,1,1);const mute=ctx.createGain();mute.gain.value=0;
 let chunks:Float32Array[]=[],pre:Float32Array[]=[],started=0,lastVoice=0,voiced=0,finished=false;
 const cleanup=()=>{processor.disconnect();source.disconnect();mute.disconnect();stream.getTracks().forEach(t=>t.stop());void ctx.close();};
 const finish=async()=>{if(finished)return;finished=true;cleanup();if(cancelled)return;
  if(voiced<.65){cb.speech(false);cb.end();return;}cb.speech(true);
  const count=chunks.reduce((n,c)=>n+c.length,0);const pcm=new Float32Array(count);let offset=0;for(const c of chunks){pcm.set(c,offset);offset+=c.length;}chunks=[];
  try{const text=await transcribeAudioWithProvider(encodeWavFromFloat32(pcm,ctx.sampleRate,16000),resolveSttProvider(api) as 'minimax'|'fishaudio'|'elevenlabs','zh-CN',api);if(!cancelled&&/[\p{L}\p{N}]/u.test(text))cb.text(text);}catch(e){if(!cancelled)cb.error(e);}finally{if(!cancelled)cb.end();}
 };
 processor.onaudioprocess=e=>{if(finished||cancelled)return;const samples=e.inputBuffer.getChannelData(0);const copy=new Float32Array(samples);const seconds=copy.length/ctx.sampleRate;const rms=Math.sqrt(copy.reduce((sum,x)=>sum+x*x,0)/copy.length);const now=performance.now();
  if(rms>.018){if(!started){started=now;chunks=pre;pre=[];}voiced+=seconds;lastVoice=now;cb.speech(true);}
  if(started){chunks.push(copy);if(now-lastVoice>1500||now-started>30000)void finish();}else{pre.push(copy);if(pre.length>4)pre.shift();}
 };
 source.connect(processor);processor.connect(mute);mute.connect(ctx.destination);
 return()=>{cancelled=true;if(!finished){finished=true;cleanup();}cb.speech(false);};
}
