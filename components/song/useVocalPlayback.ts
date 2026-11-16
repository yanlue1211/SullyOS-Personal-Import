import {useEffect,useRef,useState} from 'react';
import type {SongSheet} from '../../types';
import {getMelody} from '../../features/songwriting/melody';
import {selectVocalRange,type VocalTarget} from '../../features/songwriting/vocalMelody';
import {renderMelodyAudio} from '../../features/songwriting/melodyAudio';
/** One active local melody at a time; late synth results cannot play after leaving the page. */
export function useVocalPlayback(song:SongSheet) {
 const serial=useRef(0),ctx=useRef<AudioContext|null>(null),cache=useRef(new Map<string,Blob>());
 const [playing,setPlaying]=useState(''),[error,setError]=useState('');
 const stop=()=>{serial.current++;void ctx.current?.close().catch(()=>{});ctx.current=null;setPlaying('');};
 useEffect(()=>()=>{serial.current++;void ctx.current?.close().catch(()=>{});},[]);
 useEffect(()=>{stop();cache.current.clear();},[song.id,getMelody(song)?.activeId]);
 const play=async(target:VocalTarget)=>{
  stop();const token=serial.current;setError('');
  const project=getMelody(song),version=project?.versions.find(v=>v.id===project.activeId);
  if(!version){setError('这句还没有对应的人声旋律');return;}
  let audio:AudioContext|undefined;
  try{
   const range=selectVocalRange(song,version,target),key=version.id+':'+range.key;
   const AudioCtx=window.AudioContext||(window as any).webkitAudioContext;
   audio=new AudioCtx();ctx.current=audio!;await audio!.resume();setPlaying(range.key);
   let wav=cache.current.get(key);if(!wav){wav=(await renderMelodyAudio(range.version,song.title,audio)).wav;cache.current.set(key,wav);}
   if(token!==serial.current)return;
   const buffer=await audio!.decodeAudioData(await wav.arrayBuffer());if(token!==serial.current)return;
   const source=audio!.createBufferSource();source.buffer=buffer;source.connect(audio!.destination);
   source.onended=()=>{if(token===serial.current)stop();};source.start();
  }catch(e:any){if(token===serial.current){setError(e.message||'旋律试听失败');stop();}}finally{if(token!==serial.current)await audio?.close().catch(()=>{});}
 };
 return {play,stop,playing,error};
}
