import {useLocalBackHandler} from '../../hooks/useLocalBackHandler';
import React,{useRef,useEffect,useState} from 'react';
import type {Song} from '../../context/MusicContext';
import {C} from './MusicUI';
/** Long press/context menu opens removal; scrolling cancels and release never plays. */
export default function PlaylistSongButton({song,onPlay,onRemove}:{song:Song;onPlay:()=>void;onRemove:()=>void}){
 const timer=useRef<ReturnType<typeof setTimeout>>(),point=useRef({x:0,y:0}),held=useRef(false);const [menu,setMenu]=useState(false);
 useLocalBackHandler(()=>{setMenu(false);return true;},60,menu);
 const cancel=()=>{clearTimeout(timer.current);timer.current=undefined;};useEffect(()=>cancel,[]);
 return <div><button type="button" className="block w-full text-left py-2 select-none" style={{touchAction:'pan-y'}} aria-label={'播放 '+song.name}
 onPointerDown={e=>{if(e.button!==0)return;cancel();held.current=false;point.current={x:e.clientX,y:e.clientY};timer.current=setTimeout(()=>{held.current=true;setMenu(true);},600);}}
 onPointerMove={e=>{if(Math.hypot(e.clientX-point.current.x,e.clientY-point.current.y)>10)cancel();}}
 onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
 onContextMenu={e=>{e.preventDefault();cancel();held.current=true;setMenu(true);}}
 onClick={e=>{if(held.current){held.current=false;e.preventDefault();return;}onPlay();}}>
 <span className="block text-xs" style={{color:C.text}}>{song.name}</span><small className="text-[10px]" style={{color:C.muted}}>{song.artists}</small></button>
 {menu&&<div role="dialog" aria-label="歌曲操作" className="rounded-xl p-3 bg-white border text-xs"><p>从此歌单移除「{song.name}」？</p><div className="flex gap-4 mt-2"><button onClick={()=>setMenu(false)}>取消</button><button onClick={()=>{setMenu(false);onRemove();}}>删除歌曲</button></div></div>}
 </div>;
}
