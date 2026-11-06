import {captureProgressLabel,type CaptureProgress} from '../audio/speechTurn';
import React,{useEffect,useRef,useState} from 'react';
import {Microphone} from '@phosphor-icons/react';
import type {APIConfig} from '../../../types';
import {resolveSttProvider} from '../../../utils/speechToText';
import {captureBrowserSpeech,captureSpeechTurn,abortError} from './handsFree';
export interface HandsFreeUtterance {audio?:Blob;duration?:number;text?:string;}
export default function HandsFreeCallControl({enabled,onEnabledChange,ready,waitReason,sessionId,inputMode,apiConfig,language='zh-CN',onUtterance,onStart}:{enabled:boolean;onEnabledChange:(value:boolean)=>void;ready:boolean;waitReason?:string;sessionId:string;inputMode:'real'|'native';apiConfig:Partial<APIConfig>;language?:string;onUtterance:(value:HandsFreeUtterance,signal:AbortSignal)=>Promise<void>;onStart:()=>void}){
 const [error,setError]=useState('');
 const [phase,setPhase]=useState('已关闭'),[nonce,setNonce]=useState(0);const context=useRef<AudioContext>();
 const finishTurn=useRef<(()=>void)|undefined>();
 const [progress,setProgress]=useState<CaptureProgress>();
 const handlers=useRef({onUtterance,onEnabledChange,apiConfig,language,inputMode});handlers.current={onUtterance,onEnabledChange,apiConfig,language,inputMode};
 const toggle=()=>{if(enabled){onEnabledChange(false);return;}try{setError('');onStart();if(inputMode==='real'||resolveSttProvider(apiConfig)!=='browser'){context.current=new AudioContext();void context.current.resume();}onEnabledChange(true);}catch(error){setError(error instanceof Error?error.message:'麦克风无法开启');}};
 useEffect(()=>()=>{void context.current?.close().catch(()=>{});context.current=undefined;},[]);
 useEffect(()=>{if(!enabled){setPhase('已关闭');void context.current?.close().catch(()=>{});context.current=undefined;}},[enabled]);
 useEffect(()=>{
  if(!enabled||!ready){if(enabled)setPhase(waitReason||'等待对方说完或输入结束');return;}
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  finishTurn.current=undefined;setProgress(undefined);setPhase('正在打开麦克风');
  void (async()=>{
   try{
    // Leave a short tail after speaker playback to avoid feeding echoes back.
    await new Promise<void>((resolve,reject)=>{ const stop=()=>{clearTimeout(timer);reject(abortError());};controller.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{controller.signal.removeEventListener('abort',stop);resolve();},600);});controller.signal.throwIfAborted();
    const options=handlers.current;
    const captureOptions={onStarted:(stop:()=>void)=>{if(!controller.signal.aborted){finishTurn.current=stop;setPhase('正在听你说');}},onProgress:(value:CaptureProgress)=>{if(!controller.signal.aborted)setProgress(value);}};
    const utterance:HandsFreeUtterance=options.inputMode==='native'&&resolveSttProvider(options.apiConfig)==='browser'
      ? (setPhase('正在听你说'),{text:await captureBrowserSpeech(options.apiConfig,options.language,controller.signal,captureOptions)})
      : await captureSpeechTurn(context.current||(context.current=new AudioContext()),controller.signal,captureOptions);
    controller.signal.throwIfAborted();finishTurn.current=undefined;setProgress(undefined);
    if(utterance.text||utterance.audio){setPhase('识别并发送中');await handlers.current.onUtterance(utterance,controller.signal);}
    if(!controller.signal.aborted)timer=setTimeout(()=>setNonce(value=>value+1),600);
   }catch(error){if(controller.signal.aborted)return;setError(error instanceof Error?error.message:'免手持已暂停');handlers.current.onEnabledChange(false);}
  })();
  return()=>{finishTurn.current=undefined;controller.abort();clearTimeout(timer);};
 },[enabled,ready,waitReason,sessionId,inputMode,nonce]);
 const recording=enabled&&ready&&phase==='正在听你说';
 const status=error||(recording&&progress?captureProgressLabel(progress):phase);
 return <div className="sully-call-handsfree flex min-w-0 flex-1 flex-col items-end gap-1.5">
  <div className="flex items-center gap-1.5">
   <button type="button" aria-pressed={enabled} aria-label={enabled?'关闭免手持':'开启免手持'} onClick={toggle} className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-2 text-[11px] transition active:scale-95 ${enabled?'border-emerald-300/35 bg-emerald-400/15 text-emerald-200':'border-white/10 bg-white/5 text-white/55'}`}><Microphone size={14}/><span>免手持{enabled?' · 开':''}</span><span className={`h-1.5 w-1.5 rounded-full ${recording?'bg-emerald-300 animate-pulse':enabled?'bg-emerald-300':'bg-white/25'}`}/></button>
   {recording&&<button type="button" onClick={()=>{const finish=finishTurn.current;finishTurn.current=undefined;setPhase('正在结束录音…');setProgress(undefined);finish?.();}} className="shrink-0 rounded-full bg-emerald-200 px-2.5 py-2 text-[11px] font-medium text-emerald-950">说完了</button>}
  </div>
  {(enabled||error)&&<div className="max-w-full text-right">
   <span role="status" className={`block text-[10px] leading-relaxed ${error?'text-rose-200':'text-emerald-100/80'}`}>{status}</span>
   {recording&&<span className="block text-[9px] text-white/40">停顿约 4 秒自动发送 · 继续说会重计时</span>}
  </div>}
 </div>;
}
