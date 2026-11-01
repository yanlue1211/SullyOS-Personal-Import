import React,{useRef,useState} from 'react';
import {useMusic,type Song} from '../../context/MusicContext';
import {useOS} from '../../context/OSContext';
import {usePersonalPlaylists} from '../../hooks/usePersonalPlaylists';
import {importNeteasePlaylist} from '../../utils/personalMusicLibrary';
import TokenImg from '../../components/os/TokenImg';
import {C} from './MusicUI';
export interface SourcePlaylist{id:number;name:string;coverImgUrl?:string;trackCount:number}
export default function PersonalPlaylistsPanel({sources=[],loadTracks,onManage,onOpenPlayer,onSync}:{sources?:SourcePlaylist[];loadTracks?:(source:SourcePlaylist)=>Promise<Song[]>;onManage?:(id?:string)=>void;onOpenPlayer:()=>void;onSync?:()=>Promise<void>}){
 const {playlists,ready,error}=usePersonalPlaylists();const {playSong}=useMusic();const {addToast}=useOS();
 const [expanded,setExpanded]=useState<string|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState('');const locked=useRef(false);
 const button='rounded-xl px-3 py-2 text-[11px] shizuku-glass whitespace-nowrap disabled:opacity-40';
 const rows=[...sources.map(source=>({source,local:playlists.find(p=>p.neteaseSourceId===source.id||p.id==='netease-'+source.id)})),...playlists.filter(p=>!sources.some(s=>p.neteaseSourceId===s.id||p.id==='netease-'+s.id)).map(local=>({source:undefined,local}))];
 const ensureLocal=async(source:SourcePlaylist)=>{const existing=playlists.find(p=>p.neteaseSourceId===source.id||p.id==='netease-'+source.id);if(existing)return existing;if(!loadTracks)throw Error('请先连接网易云读取此歌单');const result=await importNeteasePlaylist(source,await loadTracks(source));return result.lists.find(p=>p.neteaseSourceId===source.id)!;};
 const perform=async(task:()=>Promise<void>)=>{if(locked.current)return;locked.current=true;setBusy(true);try{await task();}catch(e){addToast(String(e),'error');}finally{locked.current=false;setBusy(false);setProgress('');}};
 const saveAll=()=>perform(async()=>{if(!loadTracks)return;let added=0,failed=0;for(const [i,p]of sources.entries()){setProgress(`正在保存 ${i+1}/${sources.length} · ${p.name}`);try{added+=(await importNeteasePlaylist(p,await loadTracks(p))).added;}catch{failed++;}}addToast(`保存完成，新增 ${added} 首${failed?`，${failed} 个歌单未完成，可重试`:''}`,failed?'info':'success');});
 return <section aria-label="我的歌单" className="px-3 mt-3 space-y-3">
  <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>onManage?.()}>新建歌单</button>{!!sources.length&&<button type="button" className={button} disabled={busy} onClick={()=>void saveAll()}>一键保存已有歌单</button>}{onSync&&<button type="button" className={button} disabled={busy} onClick={()=>void perform(onSync)}>同步网易云</button>}</div>
  {(progress||busy)&&<p role="status" className="text-[11px]" style={{color:C.muted}}>{progress||'正在读取歌单…'}</p>}
  {error&&<p role="alert" className="text-xs">{error}</p>}
  {!ready&&!error&&<p className="text-xs">正在读取歌单…</p>}
  {ready&&!rows.length&&<p className="text-[11px] py-4 text-center" style={{color:C.muted}}>还没有歌单，新建一份或登录网易云读取已有歌单吧。</p>}
  {rows.map(({source,local})=>{const id=local?.id||'netease-'+source!.id,title=local?.title||source!.name,songs=local?.songs||[],cover=local?.songs[0]?.albumPic||source?.coverImgUrl;return <article key={id} className="rounded-2xl shizuku-glass overflow-hidden">
   <div className="flex items-center p-3 gap-2"><button type="button" className="flex items-center gap-3 flex-1 min-w-0 text-left" aria-label={'展开歌单 '+title} aria-expanded={expanded===id} disabled={busy} onClick={()=>void perform(async()=>{if(expanded===id){setExpanded(null);return;}if(!local&&source)await ensureLocal(source);setExpanded(id);})}>
    {cover?<TokenImg value={cover} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0"/>:<span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{background:`${C.primary}18`,color:C.primary}}>♫</span>}
    <span className="min-w-0"><span className="block text-sm break-words" style={{color:C.text}}>{title}</span><small style={{color:C.muted}}>{local?songs.length:source!.trackCount} 首{local?' · 已保存':''}</small></span>
   </button><button type="button" className={button} disabled={busy} onClick={()=>void perform(async()=>{const target=local||await ensureLocal(source!);onManage?.(target.id);})}>加歌</button></div>
   {expanded===id&&<div className="px-3 pb-3 space-y-1">{songs.map((s,index)=><button type="button" key={s.id} aria-label={'播放 '+s.name} className="block w-full text-left py-2" onClick={()=>{playSong(s,{replaceQueue:songs,startIdx:index});onOpenPlayer();}}><span className="block text-xs" style={{color:C.text}}>{s.name}</span><small className="text-[10px]" style={{color:C.muted}}>{s.artists}</small></button>)}{!songs.length&&<p className="text-xs py-2" style={{color:C.muted}}>点「加歌」搜索歌曲，或选择已导入的音乐。</p>}</div>}
  </article>;})}
 </section>;
}
