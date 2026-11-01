import React, {useState} from 'react';
import {useOS} from '../../context/OSContext';
import {useMusic, musicApi, parseLyric, type Song} from '../../context/MusicContext';
import {putImageBlob} from '../../utils/blobRef';
import {usePersonalPlaylists} from '../../hooks/usePersonalPlaylists';
import {savePersonalPlaylists,mergePlaylistSongs} from '../../utils/personalMusicLibrary';
import {DB} from '../../utils/db';
import type {CharMusicProfile, CharPlaylist} from '../../types';
import {C, MizuHeader} from './MusicUI';

export default function MusicLibraryManager({onClose, initialOwner='',initialPlaylist=''}:{onClose:()=>void;initialOwner?:string;initialPlaylist?:string}) {
 const {characters,updateCharacter,addToast}=useOS();
 const {localAlbumSongs,addLocalSong,current,cfg,playSong}=useMusic();
 const [owner,setOwner]=useState(initialOwner),[playlist,setPlaylist]=useState(initialPlaylist);
 const [title,setTitle]=useState(''),[artist,setArtist]=useState(''),[cover,setCover]=useState(''),[lyrics,setLyrics]=useState('');
 const [source,setSource]=useState<'file'|'url'>('url'),[audioUrl,setAudioUrl]=useState('');
 const [coverFile,setCoverFile]=useState<File|null>(null);
 const [audio,setAudio]=useState<File|null>(null),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[found,setFound]=useState<Song[]>([]);
 const [playlistName,setPlaylistName]=useState('');
 const {playlists:userPlaylists,ready,error:playlistError}=usePersonalPlaylists();
 const character=characters.find(c=>c.id===owner);
 const profile:CharMusicProfile=character?.musicProfile||{bio:'',genreTags:[],signatureArtists:[],playlists:character?[]:userPlaylists,likedSongIds:[],recentPlays:[],initializedAt:Date.now(),updatedAt:Date.now()};
 const selected=profile.playlists.find(p=>p.id===playlist);
 const save=(next:CharMusicProfile)=>{if(character)updateCharacter(character.id,{musicProfile:{...next,updatedAt:Date.now()}});else void savePersonalPlaylists(next.playlists).catch(()=>addToast('歌单保存失败','error'));};
 const add=(song:Song)=>{
  if(!selected)return;
  if(mergePlaylistSongs(selected.songs,[song]).length===selected.songs.length){addToast('这首歌已经在歌单里','info');return;}
  save({...profile,playlists:profile.playlists.map(p=>p.id===selected.id?{...p,songs:mergePlaylistSongs(p.songs,[{...song,source:'user' as const,addedAt:Date.now()}]),updatedAt:Date.now()}:p)});
  addToast('已加入歌单','success');
 };
 const importSong=async()=>{
  if((source==='file'?!audio:!audioUrl.trim())||!title.trim()||busy)return;setBusy(true);
  const key='music-import-'+crypto.randomUUID();
  try{
   const timed=parseLyric(lyrics);
   let remote='';
   if(source==='url'){const url=new URL(audioUrl.trim());if(url.protocol!=='https:')throw Error('请输入 HTTPS 音频直链');remote=url.href;}
   else await DB.saveAssetRaw(key,{blob:audio,mimeType:audio?.type||'audio/mpeg'});
   const albumPic=coverFile?await putImageBlob(coverFile):cover.trim();
   const song:Song={id:-(Date.now()*1000+Math.floor(Math.random()*1000)),name:title.trim(),artists:artist.trim()||'未知歌手',album:'导入的歌曲',albumPic,duration:0,fee:0,local:true,localAssetKey:source==='file'?key:undefined,remoteAudioUrl:remote||undefined,localMimeType:audio?.type||'audio/mpeg',localLyrics:timed.length?timed.map(l=>l.text).join('\n'):lyrics.trim(),lyricLineTimings:timed.length?timed.map(l=>l.t):undefined,lyricTimingMode:timed.length?'synced':'plain'};
   addLocalSong(song);if(selected)add(song);setTitle('');setArtist('');setLyrics('');setCover('');setCoverFile(null);setAudio(null);setAudioUrl('');addToast('歌曲已保存','success');
  }catch(e){addToast('导入失败：'+String(e),'error');}finally{setBusy(false);}
 };
 const input='w-full min-w-0 rounded-xl border p-2 text-sm bg-white';
 const button='shrink-0 whitespace-nowrap rounded-xl border px-3 py-2 text-sm bg-white disabled:opacity-40';
 const choices=[...new Map([...localAlbumSongs,...(current?[current]:[]),...found].map(s=>[s.id,s])).values()];
 return <div role="dialog" aria-modal="true" aria-label="音乐管理" className="absolute inset-0 z-50 flex flex-col" style={{background:C.bg,color:C.text}}>
  <MizuHeader title="音乐管理" onBack={onClose}/>
  <main className="flex-1 overflow-y-auto p-4 space-y-4">
   {playlistError&&<p role="alert">{playlistError}</p>}
   {!ready&&!playlistError&&<p>正在读取歌单…</p>}
   <label className="block text-sm">管理账号<select aria-label="管理音乐账号" className={input} value={owner} disabled={busy} onChange={e=>{setOwner(e.target.value);setPlaylist('');setPlaylistName('');}}><option value="">我的歌单与歌曲</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   {ready&&<section className="space-y-2 rounded-2xl bg-white/60 p-3">
    <div className="flex gap-2"><input aria-label="歌单名称" className={input} value={playlistName} onChange={e=>setPlaylistName(e.target.value)} placeholder="歌单名称" maxLength={100}/><button className={button} disabled={!playlistName.trim()} onClick={()=>{const id=crypto.randomUUID();save({...profile,playlists:[...profile.playlists,{id,title:playlistName.trim(),description:'',coverStyle:'gradient-01',songs:[],createdAt:Date.now(),updatedAt:Date.now()}]});setPlaylist(id);setPlaylistName('');}}>新建</button></div>
    <select aria-label="选择歌单" className={input} value={playlist} onChange={e=>setPlaylist(e.target.value)}><option value="">选择歌单</option>{profile.playlists.map(p=><option key={p.id} value={p.id}>{p.title}（{p.songs.length}）</option>)}</select>
    {selected&&<><button className={button} disabled={!playlistName.trim()} onClick={()=>{save({...profile,playlists:profile.playlists.map(p=>p.id===playlist?{...p,title:playlistName.trim(),updatedAt:Date.now()}:p)});setPlaylistName('');}}>用上方名称改名</button>
    <button className={button} onClick={()=>{if(!window.confirm(`删除歌单「${selected.title}」？歌曲文件会保留。`))return;save({...profile,playlists:profile.playlists.filter(p=>p.id!==playlist)});setPlaylist('');}}>删除歌单</button>
    {selected.songs.map((s,index)=><div key={s.id} className="flex items-center gap-2 text-sm"><button className="flex-1 text-left" onClick={()=>playSong(s,{alsoSetQueue:true,replaceQueue:selected.songs,startIdx:index})}>{s.name} · {s.artists}</button><button className={button} onClick={()=>save({...profile,playlists:profile.playlists.map(p=>p.id===playlist?{...p,songs:p.songs.filter(x=>x.id!==s.id),updatedAt:Date.now()}:p)})}>移出</button></div>)}</>}
   </section>}
   <section className="rounded-2xl bg-white/60 p-3 space-y-2"><h2 className="text-sm font-bold">导入歌曲{selected?' · '+selected.title:''}</h2>
    <div className="flex gap-2"><button className={button} aria-pressed={source==='url'} onClick={()=>setSource('url')}>链接导入</button><button className={button} aria-pressed={source==='file'} onClick={()=>setSource('file')}>文件导入</button></div>
    {source==='url'?<><input aria-label="歌曲音频链接" className={input} value={audioUrl} onChange={e=>setAudioUrl(e.target.value)} placeholder="https://…/歌曲.mp3"/><p className="text-xs opacity-60">只保存链接，在线播放，不下载到本地歌曲缓存。</p></>:<input aria-label="歌曲文件" type="file" accept="audio/*,.mp3,.flac,.m4a,.wav,.ogg" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f){setAudio(f);if(!title)setTitle(f.name.replace(/\.[^.]+$/,''));}}}/>}{source==='file'&&audio&&<p className="text-xs">{audio.name}</p>}
    <input aria-label="歌名" className={input} value={title} onChange={e=>setTitle(e.target.value)} placeholder="歌名" maxLength={200}/>
    <input aria-label="歌手" className={input} value={artist} onChange={e=>setArtist(e.target.value)} placeholder="歌手" maxLength={200}/>
    <input aria-label="歌曲封面链接" className={input} value={cover} onChange={e=>setCover(e.target.value)} placeholder="封面图片链接"/>
    <label className="block text-xs">或上传封面<input aria-label="上传歌曲封面" type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>5*1024*1024){addToast('封面请小于5MB','error');return;}setCoverFile(file);}}/></label>
    {coverFile&&<p className="text-xs">封面：{coverFile.name}</p>}
    <textarea aria-label="歌曲歌词" className={input} rows={5} value={lyrics} onChange={e=>setLyrics(e.target.value)} placeholder="粘贴 LRC 时间轴歌词或纯文字歌词" maxLength={100000}/>
    <label className="block text-xs">导入歌词文件<input type="file" accept=".lrc,.txt,text/plain" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>200000){addToast('歌词文件过大','error');return;}try{setLyrics(await f.text());}catch{addToast('歌词读取失败','error');}}}/></label>
    <p className="text-xs opacity-60">LRC 按时间定位当前句。纯文字仅作全曲参考，可在播放页手动对轴。</p>
    <button className={button} disabled={!ready||busy||(source==='file'?!audio:!audioUrl.trim())||!title.trim()||!!character&&!selected} onClick={()=>void importSong()}>{busy?'保存中…':selected?'导入并加入此歌单':'导入到本地歌曲'}</button>
   </section>
   <section className="space-y-2"><h2 className="text-sm font-bold">{selected?'往歌单添加歌曲':'本地歌曲'}</h2>
    {selected&&<form className="flex gap-2" onSubmit={async e=>{e.preventDefault();if(busy||!query.trim())return;setBusy(true);try{const r=await musicApi.search(cfg,query.trim());setFound((r?.result?.songs||[]).map((s:any)=>({id:s.id,name:s.name,artists:(s.ar||s.artists||[]).map((a:any)=>a.name).join(' / '),album:s.al?.name||s.album?.name||'',albumPic:s.al?.picUrl||s.album?.picUrl||'',duration:(s.dt||s.duration||0)/1000,fee:s.fee||0})));}catch(e){addToast('搜索失败：'+String(e),'error');}finally{setBusy(false);}}}><input aria-label="搜索添加歌曲" className={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索歌曲"/><button className={button} disabled={busy}>搜索</button></form>}
    {choices.map(s=><div key={s.id} className="flex gap-2 items-center"><button className="flex-1 min-w-0 text-left text-sm" onClick={()=>playSong(s,{alsoSetQueue:true,replaceQueue:choices,startIdx:choices.findIndex(x=>x.id===s.id)})}>{s.name}<small className="block opacity-60">{s.artists}</small></button>{selected&&<button className={button} disabled={selected.songs.some(x=>x.id===s.id)} onClick={()=>add(s)}>加入</button>}</div>)}
   </section>
  </main>
 </div>;
}
