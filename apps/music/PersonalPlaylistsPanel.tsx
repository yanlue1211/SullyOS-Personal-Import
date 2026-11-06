import MusicCover from '../../components/os/MusicCover';
import PlaylistSongButton from './PlaylistSongButton';
import React,{useRef,useState} from 'react';
import {useMusic,type Song} from '../../context/MusicContext';
import {useOS} from '../../context/OSContext';
import {usePersonalPlaylists} from '../../hooks/usePersonalPlaylists';
import {importNeteasePlaylist,updatePersonalPlaylists} from '../../utils/personalMusicLibrary';
import {C} from './MusicUI';
export interface SourcePlaylist{id:number;name:string;coverImgUrl?:string;trackCount:number}
export default function PersonalPlaylistsPanel({sources=[],loadTracks,onManage,onOpenPlayer,onSync}:{sources?:SourcePlaylist[];loadTracks?:(source:SourcePlaylist)=>Promise<Song[]>;onManage?:(id?:string)=>void;onOpenPlayer:()=>void;onSync?:()=>Promise<void>}){
 const {playlists,ready,error}=usePersonalPlaylists();const {playSong}=useMusic();const {addToast}=useOS();
 const [visibleCount,setVisibleCount]=useState(50);
 const [expanded,setExpanded]=useState<string|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState('');const locked=useRef(false);
 const rows=[...sources.map(source=>({source,local:playlists.find(p=>p.neteaseSourceId===source.id||p.id==='netease-'+source.id)})),...playlists.filter(p=>!sources.some(s=>p.neteaseSourceId===s.id||p.id==='netease-'+s.id)).map(local=>({source:undefined,local}))];
 const ensureLocal=async(source:SourcePlaylist)=>{const existing=playlists.find(p=>p.neteaseSourceId===source.id||p.id==='netease-'+source.id);if(existing)return existing;if(!loadTracks)throw Error('请先连接网易云读取此歌单');const result=await importNeteasePlaylist(source,await loadTracks(source));return result.lists.find(p=>p.neteaseSourceId===source.id)!;};
 const perform=async(task:()=>Promise<void>)=>{if(locked.current)return;locked.current=true;setBusy(true);try{await task();}catch(e){addToast(String(e),'error');}finally{locked.current=false;setBusy(false);setProgress('');}};

 return <section aria-label="我的歌单" className="px-3 mt-3 space-y-3">

  {(progress||busy)&&<p role="status" className="text-[11px]" style={{color:C.muted}}>{progress||'正在读取歌单…'}</p>}
  {error&&<p role="alert" className="text-xs">{error}</p>}
  {!ready&&!error&&<p className="text-xs">正在读取歌单…</p>}
  {ready&&!rows.length&&<p className="text-[11px] py-4 text-center" style={{color:C.muted}}>还没有歌单，可以在音乐管理中新建，或登录网易云同步。</p>}
  {rows.map(({source,local})=>{const id=local?.id||'netease-'+source!.id,title=local?.title||source!.name,songs=local?.songs||[],cover=local?.songs[0]?.albumPic||source?.coverImgUrl;return <article key={id} className="rounded-2xl shizuku-glass overflow-hidden">
   <div className="flex items-center p-3 gap-2"><button type="button" className="flex items-center gap-3 flex-1 min-w-0 text-left" aria-label={'展开歌单 '+title} aria-expanded={expanded===id} disabled={busy} onClick={()=>void perform(async()=>{if(expanded===id){setExpanded(null);return;}if(!local&&source)await ensureLocal(source);setVisibleCount(50);setExpanded(id);})}>
    {cover?<MusicCover value={cover} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0"/>:<span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{background:`${C.primary}18`,color:C.primary}}>♫</span>}
    <span className="min-w-0"><span className="block text-sm break-words" style={{color:C.text}}>{title}</span><small style={{color:C.muted}}>{local?songs.length:source!.trackCount} 首{local?' · 已保存':''}</small></span>
   </button></div>
   {expanded===id&&<div className="px-3 pb-3 space-y-1">{songs.slice(0,visibleCount).map((s,index)=><PlaylistSongButton key={s.id} song={s} onPlay={()=>{playSong(s,{replaceQueue:songs,startIdx:index});onOpenPlayer();}} onRemove={()=>void perform(async()=>{await updatePersonalPlaylists(lists=>lists.map(p=>p.id===id?{...p,songs:p.songs.filter(song=>song.id!==s.id),updatedAt:Date.now()}:p));})}/>)}{songs.length>visibleCount&&<button type="button" className="w-full py-3 text-xs" style={{color:C.muted}} onClick={()=>setVisibleCount(n=>n+50)}>继续显示（已显示 {Math.min(visibleCount,songs.length)} / {songs.length} 首）</button>}{!songs.length&&<p className="text-xs py-2" style={{color:C.muted}}>可在音乐管理中添加歌曲。</p>}</div>}
  </article>;})}
 </section>;
}
