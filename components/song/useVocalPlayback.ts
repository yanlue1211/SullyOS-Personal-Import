import {useEffect,useRef,useState} from 'react';
import type {SongSheet} from '../../types';
import {getMelody} from '../../features/songwriting/melody';
import {selectVocalRange,type VocalTarget} from '../../features/songwriting/vocalMelody';
import {renderMelodyAudio} from '../../features/songwriting/melodyAudio';
export type VocalPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused';
/** Pause/resume the existing WebAudio clock, keeping progress and cached synthesis. */
export function useVocalPlayback(song:SongSheet) {
 const serial=useRef(0),ctx=useRef<AudioContext|null>(null),cache=useRef(new Map<string,Blob>());
 const current=useRef({key:'',status:'idle' as VocalPlaybackStatus});
 const [state,setState]=useState(current.current),[error,setError]=useState('');
 const setStatus=(key:string,status:VocalPlaybackStatus)=>{current.current={key,status};setState(current.current);};
 const stop=()=>{serial.current++;void ctx.current?.close().catch(()=>{});ctx.current=null;setStatus('','idle');};
 useEffect(()=>()=>{serial.current++;void ctx.current?.close().catch(()=>{});},[]);
 useEffect(()=>{stop();cache.current.clear();},[song.id,getMelody(song)?.activeId]);
 const statusFor=(target:VocalTarget):VocalPlaybackStatus=>{
  try{const p=getMelody(song),v=p?.versions.find(v=>v.id===p.activeId);if(!v)return 'idle';return current.current.key===selectVocalRange(song,v,target).key?current.current.status:'idle';}catch{return 'idle';}
 };
 const play=async(target:VocalTarget)=>{
  const project=getMelody(song),version=project?.versions.find(v=>v.id===project.activeId);
  if(!version){setError('这句还没有对应的人声旋律');return;}
  let audio:AudioContext|undefined,token=serial.current;
  try{
   const range=selectVocalRange(song,version,target),key=version.id+':'+range.key;
   if(ctx.current&&current.current.key===range.key){
    if(current.current.status==='loading')return;
    const next=current.current.status==='paused'?'playing':'paused';
    const live=ctx.current;
    if(next==='paused')await live.suspend();else await live.resume();
    if(token===serial.current&&ctx.current===live)setStatus(range.key,next);
    return;
   }
   stop();token=serial.current;setError('');
   const AudioCtx=window.AudioContext||(window as any).webkitAudioContext;
   if(!AudioCtx)throw Error('当前浏览器不支持旋律播放');
   audio=new AudioCtx();ctx.current=audio!;setStatus(range.key,'loading');await audio!.resume();
   let wav=cache.current.get(key);
   if(!wav){wav=(await renderMelodyAudio(range.version,song.title,audio)).wav;cache.current.set(key,wav);}
   if(token!==serial.current)return;
   const buffer=await audio!.decodeAudioData(await wav.arrayBuffer());if(token!==serial.current)return;
   const source=audio!.createBufferSource();source.buffer=buffer;source.connect(audio!.destination);
   source.onended=()=>{if(token===serial.current)stop();};source.start();setStatus(range.key,'playing');
  }catch(e:any){if(token===serial.current){setError(e.message||'旋律试听失败');stop();}}
  finally{if(token!==serial.current)await audio?.close().catch(()=>{});}
 };
 return {play,stop,statusFor,playing:state.status==='playing'?state.key:'',paused:state.status==='paused'?state.key:'',loading:state.status==='loading'?state.key:'',error};
}
