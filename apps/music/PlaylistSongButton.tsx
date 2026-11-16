import {readPersonalPlaylists, updatePersonalPlaylists, mergePlaylistSongs, type PersonalPlaylist} from '../../utils/personalMusicLibrary';
import ShareSongPanel from './ShareSongPanel';
import {useLocalBackHandler} from '../../hooks/useLocalBackHandler';
import React,{useRef,useEffect,useState} from 'react';
import type {Song} from '../../context/MusicContext';
import {C} from './MusicUI';
/** Long press/context menu opens removal; scrolling cancels and release never plays. */
export default function PlaylistSongButton({song,onPlay,onRemove}:{song:Song;onPlay:()=>void;onRemove:()=>void}){
 const timer=useRef<ReturnType<typeof setTimeout>>(),point=useRef({x:0,y:0}),held=useRef(false);const [menu,setMenu]=useState(false),[sharing,setSharing]=useState(false),[adding,setAdding]=useState(false),[lists,setLists]=useState<PersonalPlaylist[]>([]),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const saveLock=useRef(false);
 useEffect(()=>{if(!adding)return;let active=true;void readPersonalPlaylists().then(rows=>{if(active)setLists(rows);}).catch(()=>{if(active)setError("歌单读取失败，请重试");});return()=>{active=false;};},[adding]);
 useLocalBackHandler(()=>{if(saving)return true;if(sharing)setSharing(false);else if(adding)setAdding(false);else setMenu(false);return true;},60,menu||sharing||adding);
 const cancel=()=>{clearTimeout(timer.current);timer.current=undefined;};useEffect(()=>cancel,[]);
 return <div><button type="button" className="block w-full text-left py-3 select-none" style={{touchAction:'pan-y'}} aria-label={'播放 '+song.name}
 onPointerDown={e=>{if(e.button!==0)return;cancel();held.current=false;point.current={x:e.clientX,y:e.clientY};timer.current=setTimeout(()=>{held.current=true;setMenu(true);},600);}}
 onPointerMove={e=>{if(Math.hypot(e.clientX-point.current.x,e.clientY-point.current.y)>10)cancel();}}
 onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
 onContextMenu={e=>{e.preventDefault();cancel();held.current=true;setMenu(true);}}
 onClick={e=>{if(held.current){held.current=false;e.preventDefault();return;}onPlay();}}>
 <span className="block text-sm" style={{color:C.text}}>{song.name}</span><small className="text-xs" style={{color:C.muted}}>{song.artists}</small></button>
 {(menu||sharing||adding)&&<div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#292538]/30 backdrop-blur-sm p-3" onClick={()=>{if(!saving){setMenu(false);setSharing(false);setAdding(false);}}}>
 <section role="dialog" aria-modal="true" aria-label="歌曲操作" onClick={e=>e.stopPropagation()} className="w-full max-w-md rounded-[28px] p-5 shadow-2xl max-h-[80vh] overflow-y-auto" style={{background:C.bg,color:C.text,paddingBottom:'max(20px, env(safe-area-inset-bottom))'}}>
 <div className="w-9 h-1 rounded-full mx-auto mb-5" style={{background:C.soft}}/>
 <h3 className="font-semibold text-base truncate">{song.name}</h3><p className="text-xs mt-1 mb-4" style={{color:C.muted}}>{song.artists}</p>
 {sharing ? <ShareSongPanel song={song} onClose={()=>setSharing(false)}/> : adding ? <div className="space-y-2"><p className="text-sm mb-3">加入哪个歌单？</p>{lists.map(list=><button disabled={saving} key={list.id} className="block w-full text-left rounded-2xl px-4 py-3 bg-white" onClick={async()=>{
 if(saveLock.current)return;saveLock.current=true;setSaving(true);setError('');try{await updatePersonalPlaylists(current=>{if(!current.some(p=>p.id===list.id))throw Error('歌单已不存在');return current.map(p=>p.id===list.id?{...p,songs:mergePlaylistSongs(p.songs,[song]),updatedAt:Date.now()}:p);});setAdding(false);setMenu(false);}catch{setError('加入失败，请重试');}finally{saveLock.current=false;setSaving(false);}
 }}>{list.title}<small className="block mt-1" style={{color:C.muted}}>{list.songs.length} 首{list.songs.some(s=>s.id===song.id)?' · 已收录':''}</small></button>)}{!lists.length&&<p className="text-sm" style={{color:C.muted}}>还没有个人歌单，可先在音乐管理中新建。</p>}</div> : <div className="space-y-2">
 <button className="block w-full text-left rounded-2xl px-4 py-3 bg-white" onClick={()=>{setMenu(false);setSharing(true);}}>分享给角色<span className="float-right">›</span></button>
 <button className="block w-full text-left rounded-2xl px-4 py-3 bg-white" onClick={()=>{setError('');setMenu(false);setAdding(true);}}>加入歌单<span className="float-right">›</span></button>
 <button className="block w-full text-left rounded-2xl px-4 py-3 bg-white" style={{color:C.danger}} onClick={()=>{setMenu(false);onRemove();}}>删除歌曲</button>
 <p className="text-[11px] px-4" style={{color:C.muted}}>删除仅从当前歌单移除。</p>
 </div>}
 {error&&<p role="alert" className="text-xs my-3" style={{color:C.danger}}>{error}</p>}
 <button disabled={saving} className="w-full rounded-2xl py-3 mt-3 text-sm" style={{background:C.soft,color:C.primary}} onClick={()=>{setMenu(false);setSharing(false);setAdding(false);}}>取消</button>
 </section></div>}
 </div>;
}
