import React,{useEffect,useRef,useState} from 'react';
import {Microphone} from '@phosphor-icons/react';
import type {APIConfig} from '../../../types';
import {resolveSttProvider} from '../../../utils/speechToText';
import {captureBrowserSpeech,captureSpeechTurn,abortError} from './handsFree';
export interface HandsFreeUtterance {audio?:Blob;duration?:number;text?:string;}
export default function HandsFreeCallControl({enabled,onEnabledChange,ready,sessionId,inputMode,apiConfig,language='zh-CN',onUtterance,onStart}:{enabled:boolean;onEnabledChange:(value:boolean)=>void;ready:boolean;sessionId:string;inputMode:'real'|'native';apiConfig:Partial<APIConfig>;language?:string;onUtterance:(value:HandsFreeUtterance,signal:AbortSignal)=>Promise<void>;onStart:()=>void}){
 const [error,setError]=useState('');
 const [phase,setPhase]=useState('已关闭'),[nonce,setNonce]=useState(0);const context=useRef<AudioContext>();
 const handlers=useRef({onUtterance,onEnabledChange,apiConfig,language,inputMode});handlers.current={onUtterance,onEnabledChange,apiConfig,language,inputMode};
 const toggle=()=>{if(enabled){onEnabledChange(false);return;}try{setError('');onStart();if(inputMode==='real'||resolveSttProvider(apiConfig)!=='browser'){context.current=new AudioContext();void context.current.resume();}onEnabledChange(true);}catch(error){setError(error instanceof Error?error.message:'麦克风无法开启');}};
 useEffect(()=>()=>{void context.current?.close().catch(()=>{});context.current=undefined;},[]);
 useEffect(()=>{if(!enabled){setPhase('已关闭');void context.current?.close().catch(()=>{});context.current=undefined;}},[enabled]);
 useEffect(()=>{
  if(!enabled||!ready){if(enabled)setPhase('等待对方说完或输入结束');return;}
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  setPhase('正在听你说');
  void (async()=>{
   try{
    // Leave a short tail after speaker playback to avoid feeding echoes back.
    await new Promise<void>((resolve,reject)=>{ const stop=()=>{clearTimeout(timer);reject(abortError());};controller.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{controller.signal.removeEventListener('abort',stop);resolve();},600);});controller.signal.throwIfAborted();
    const options=handlers.current;
    const utterance:HandsFreeUtterance=options.inputMode==='native'&&resolveSttProvider(options.apiConfig)==='browser'
      ? {text:await captureBrowserSpeech(options.apiConfig,options.language,controller.signal)}
      : await captureSpeechTurn(context.current||(context.current=new AudioContext()),controller.signal);
    controller.signal.throwIfAborted();
    if(utterance.text||utterance.audio){setPhase('识别并发送中');await handlers.current.onUtterance(utterance,controller.signal);}
    if(!controller.signal.aborted)timer=setTimeout(()=>setNonce(value=>value+1),600);
   }catch(error){if(controller.signal.aborted)return;setError(error instanceof Error?error.message:'免手持已暂停');handlers.current.onEnabledChange(false);}
  })();
  return()=>{controller.abort();clearTimeout(timer);};
 },[enabled,ready,sessionId,inputMode,nonce]);
 return <div className="mx-3 my-1 flex items-center justify-between gap-3 rounded-2xl border border-emerald-200/20 bg-emerald-950/30 px-3 py-2 text-white"><span className="min-w-0"><span className="block text-xs text-emerald-100">免手持通话</span><span role="status" className="block text-[10px] text-white/55 truncate max-w-[220px]" title={error || phase}>{error || phase}</span></span><button type="button" aria-pressed={enabled} aria-label={enabled?'关闭免手持':'开启免手持'} onClick={toggle} className={`rounded-full px-3 py-2 text-xs flex items-center gap-1 ${enabled?'bg-emerald-400 text-emerald-950':'bg-white/10 text-white/80'}`}><Microphone size={15}/>{enabled?'已开启':'开启'}</button></div>;
}
