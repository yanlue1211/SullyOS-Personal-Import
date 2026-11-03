import React,{useEffect,useRef,useState} from 'react';
import {Microphone} from '@phosphor-icons/react';
import type {APIConfig} from '../../../types';
import {resolveSttProvider} from '../../../utils/speechToText';
import {captureBrowserSpeech,captureSpeechTurn,abortError} from './handsFree';
export interface HandsFreeUtterance {audio?:Blob;duration?:number;text?:string;}
export default function HandsFreeCallControl({enabled,onEnabledChange,ready,waitReason,sessionId,inputMode,apiConfig,language='zh-CN',onUtterance,onStart}:{enabled:boolean;onEnabledChange:(value:boolean)=>void;ready:boolean;waitReason?:string;sessionId:string;inputMode:'real'|'native';apiConfig:Partial<APIConfig>;language?:string;onUtterance:(value:HandsFreeUtterance,signal:AbortSignal)=>Promise<void>;onStart:()=>void}){
 const [error,setError]=useState('');
 const [phase,setPhase]=useState('已关闭'),[nonce,setNonce]=useState(0);const context=useRef<AudioContext>();
 const handlers=useRef({onUtterance,onEnabledChange,apiConfig,language,inputMode});handlers.current={onUtterance,onEnabledChange,apiConfig,language,inputMode};
 const toggle=()=>{if(enabled){onEnabledChange(false);return;}try{setError('');onStart();if(inputMode==='real'||resolveSttProvider(apiConfig)!=='browser'){context.current=new AudioContext();void context.current.resume();}onEnabledChange(true);}catch(error){setError(error instanceof Error?error.message:'麦克风无法开启');}};
 useEffect(()=>()=>{void context.current?.close().catch(()=>{});context.current=undefined;},[]);
 useEffect(()=>{if(!enabled){setPhase('已关闭');void context.current?.close().catch(()=>{});context.current=undefined;}},[enabled]);
 useEffect(()=>{
  if(!enabled||!ready){if(enabled)setPhase(waitReason||'等待对方说完或输入结束');return;}
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  setPhase('正在打开麦克风');
  void (async()=>{
   try{
    // Leave a short tail after speaker playback to avoid feeding echoes back.
    await new Promise<void>((resolve,reject)=>{ const stop=()=>{clearTimeout(timer);reject(abortError());};controller.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{controller.signal.removeEventListener('abort',stop);resolve();},600);});controller.signal.throwIfAborted();
    const options=handlers.current;
    const utterance:HandsFreeUtterance=options.inputMode==='native'&&resolveSttProvider(options.apiConfig)==='browser'
      ? (setPhase('正在听你说'),{text:await captureBrowserSpeech(options.apiConfig,options.language,controller.signal)})
      : await captureSpeechTurn(context.current||(context.current=new AudioContext()),controller.signal,{onStarted:()=>{if(!controller.signal.aborted)setPhase('正在听你说');}});
    controller.signal.throwIfAborted();
    if(utterance.text||utterance.audio){setPhase('识别并发送中');await handlers.current.onUtterance(utterance,controller.signal);}
    if(!controller.signal.aborted)timer=setTimeout(()=>setNonce(value=>value+1),600);
   }catch(error){if(controller.signal.aborted)return;setError(error instanceof Error?error.message:'免手持已暂停');handlers.current.onEnabledChange(false);}
  })();
  return()=>{controller.abort();clearTimeout(timer);};
 },[enabled,ready,waitReason,sessionId,inputMode,nonce]);
 return <div className="sully-call-handsfree flex min-w-0 items-center justify-end gap-2">
  <span role="status" className={error?'max-w-[140px] text-[10px] text-rose-200':'sr-only'}>{error || phase}</span>
  <button type="button" aria-pressed={enabled} aria-label={enabled?'关闭免手持':'开启免手持'} title={error||phase} onClick={toggle} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] transition active:scale-95 ${enabled?'border-emerald-300/35 bg-emerald-400/15 text-emerald-200':'border-white/10 bg-white/5 text-white/55'}`}><Microphone size={14}/><span>{enabled?(phase==='正在听你说'?'正在收音':phase==='识别并发送中'?'识别发送中':phase==='正在打开麦克风'?'开启麦克风…':(waitReason||'免手持')):'免手持'}</span><span className={`h-1.5 w-1.5 rounded-full ${enabled?(phase==='正在听你说'?'bg-emerald-300 animate-pulse':'bg-emerald-300'):'bg-white/25'}`}/></button>
 </div>;
}
