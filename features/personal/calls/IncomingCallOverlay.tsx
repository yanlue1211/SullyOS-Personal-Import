import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Phone,PhoneDisconnect,VideoCamera} from '@phosphor-icons/react';
import {useOS} from '../../../context/OSContext';
import {AppID} from '../../../types';
import {DB} from '../../../utils/db';
import {isLocalCallActive,allowsIncomingCall,INCOMING_CALL_CHANGED,readIncomingCall,settleIncomingCall,queueIncomingCallLaunch} from './incoming';
export default function IncomingCallOverlay(){
 const {characters,activeApp,suspendedCall,openApp,setActiveCharacterId,addToast}=useOS();
 const [call,setCall]=useState(readIncomingCall),[busy,setBusy]=useState(false),[visible,setVisible]=useState(()=>document.visibilityState!=='hidden');
 useEffect(()=>{const sync=()=>{setCall(readIncomingCall());setVisible(document.visibilityState!=='hidden');};window.addEventListener(INCOMING_CALL_CHANGED,sync);window.addEventListener('storage',sync);document.addEventListener('visibilitychange',sync);return()=>{window.removeEventListener(INCOMING_CALL_CHANGED,sync);window.removeEventListener('storage',sync);document.removeEventListener('visibilitychange',sync);};},[]);
 const char=characters.find(char=>char.id===call?.charId);
 useEffect(()=>{
  if(!call)return;
  if(!char||!allowsIncomingCall(char,call.mode)){void settleIncomingCall(call,'permission-revoked');return;}
  if(isLocalCallActive()||suspendedCall){void settleIncomingCall(call,'busy');return;}
  if(call.expiresAt<=Date.now()){void settleIncomingCall(call,'missed');return;}
  const timer=window.setTimeout(()=>{void settleIncomingCall(call,'missed');},call.expiresAt-Date.now());return()=>window.clearTimeout(timer);
 },[call,char?.allowIncomingVoiceCalls,char?.allowIncomingVideoCalls,char?.id,activeApp,suspendedCall]);
 useEffect(()=>{
  if(!call||!visible||!char||!allowsIncomingCall(char,call.mode)||isLocalCallActive()||suspendedCall)return;
  // Browser autoplay restrictions may silence the tone; the visual invitation remains usable.
  let audio:AudioContext|undefined;try{audio=new AudioContext();}catch{}
  const ring=()=>{if(audio?.state!=='running')return;const at=audio.currentTime;for(const frequency of [440,480]){const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.025,at);gain.gain.setTargetAtTime(0,at+.6,.06);oscillator.connect(gain).connect(audio.destination);oscillator.start(at);oscillator.stop(at+.9);}};
  void audio?.resume().then(ring).catch(()=>{});const timer=window.setInterval(ring,3500);return()=>{window.clearInterval(timer);void audio?.close().catch(()=>{});};
 },[call?.id,visible,activeApp,suspendedCall]);
 if(!call||!char||!visible||!allowsIncomingCall(char,call.mode)||call.expiresAt<=Date.now()||isLocalCallActive()||suspendedCall)return null;
 const answer=async(accepted:boolean)=>{if(busy)return;setBusy(true);try{const live=await DB.getCharacter(call.charId);if(!allowsIncomingCall(live,call.mode)){await settleIncomingCall(call,'permission-revoked');return;}if(accepted){if(isLocalCallActive()||suspendedCall){await settleIncomingCall(call,'busy');return;}if(await settleIncomingCall(call,'accepted')){queueIncomingCallLaunch(call);setActiveCharacterId(call.charId);openApp(AppID.Call);}}else await settleIncomingCall(call,'declined');}catch{addToast('来电处理失败，请重试','error');}finally{setBusy(false);}};
 const video=call.mode==='video';
 return createPortal(
  <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/50 backdrop-blur-xl p-6" role="dialog" aria-modal="true" aria-label={`${char.name}的${video?'视频':'语音'}来电`}>
   <section className="relative isolate w-full max-w-sm overflow-hidden rounded-[2.5rem] border border-white/80 bg-gradient-to-b from-emerald-50 via-white to-teal-50 px-8 pb-9 pt-7 text-center text-emerald-950 shadow-[0_30px_100px_rgba(0,40,30,0.35)]">
    <div className="pointer-events-none absolute -top-24 -right-20 -z-10 h-64 w-64 rounded-full bg-emerald-200/40 blur-3xl"/>
    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/60 bg-white/70 px-4 py-2 text-xs tracking-widest text-emerald-700">{video?<VideoCamera size={15}/>:<Phone size={15}/>}<span>{video?'视频来电':'语音来电'}</span><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"/></div>
    <div className="relative mx-auto mt-10 mb-7 h-28 w-28">
     <div className="absolute -inset-4 rounded-full border border-emerald-200/50"/>
     <div className="absolute -inset-2 rounded-full border border-emerald-200 bg-white/60 shadow-lg shadow-emerald-100"/>
     {char.avatar?<img src={char.avatar} alt="" className="relative h-28 w-28 rounded-full border-4 border-white object-cover"/>:<div className="relative flex h-28 w-28 items-center justify-center rounded-full border-4 border-white bg-emerald-100 text-4xl">{char.name.slice(0,1)}</div>}
    </div>
    <h2 className="break-words text-2xl font-medium tracking-wide">{char.name}</h2>
    <p className="mt-3 text-sm text-emerald-800/55">正在等你接听</p>
    <div className="mt-12 flex justify-between px-5">
     <button disabled={busy} onClick={()=>void answer(false)} className="group flex flex-col items-center gap-3 rounded-2xl px-2 py-1 transition active:scale-95 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500 ring-1 ring-rose-200/80 transition group-hover:bg-rose-100"><PhoneDisconnect size={29} weight="fill"/></span><span className="text-xs tracking-widest text-slate-500">拒接</span></button>
     <button disabled={busy} onClick={()=>void answer(true)} className="group flex flex-col items-center gap-3 rounded-2xl px-2 py-1 transition active:scale-95 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-200/70 transition group-hover:bg-emerald-600">{video?<VideoCamera size={29} weight="fill"/>:<Phone size={29} weight="fill"/>}</span><span className="text-xs tracking-widest text-emerald-700">接听</span></button>
    </div>
   </section>
  </div>,document.body);
}
