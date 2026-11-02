import {useLocalBackHandler} from '../../hooks/useLocalBackHandler';
import React,{useRef,useState} from 'react';
import {identifyMusicLinks,type ImportCandidate} from '../../utils/bulkMusicImport';
import type {Song} from '../../context/MusicContext';
export default function BulkSongImport({readDetail,onConfirm}:{readDetail:(id:number)=>Promise<any>;onConfirm:(songs:Song[])=>Promise<void>}){
 const [links,setLinks]=useState(''),[draft,setDraft]=useState<ImportCandidate[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 const perform=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);lock.current=false;}};
 useLocalBackHandler(()=>{if(busy)return true;setDraft(null);return true;},60,draft!==null);
 const input='w-full min-w-0 rounded-xl border p-2 text-sm bg-white';
 return <section className="rounded-2xl bg-white/60 p-3 space-y-2"><h2 className="text-sm font-bold">一键加歌</h2><p className="text-xs opacity-60">多个 HTTPS 音频直链或网易云歌曲链接，每行一条。先确认歌名与歌手，歌词可之后单独导入。</p>
 <textarea aria-label="批量歌曲链接" className={input} value={links} disabled={busy} onChange={e=>setLinks(e.target.value)} placeholder="https://…/歌曲.mp3"/>
 <button className="rounded-xl border px-3 py-2 text-sm bg-white" disabled={busy||!links.trim()} onClick={()=>void perform(async()=>setDraft(await identifyMusicLinks(links,readDetail)))}>{busy?'识别中…':'识别链接'}</button>
 {error&&<p role="alert" className="text-xs">{error}</p>}
 {draft!==null&&<div className="absolute inset-0 z-[70] bg-white/95 flex flex-col p-4" role="dialog" aria-modal="true" aria-label="确认批量歌曲"><h2 className="text-lg">确认歌曲 · {draft.length} 首</h2><div className="flex-1 overflow-y-auto space-y-4 py-3">
 {draft.map((row,i)=><article className="rounded-xl border p-3 space-y-2" key={row.key}><p className="text-xs break-all">{row.url}</p>{row.error&&<small>{row.error}</small>}
 <input aria-label={'第'+(i+1)+'首歌名'} className={input} value={row.song.name} disabled={busy} onChange={e=>{const name=e.target.value;setDraft(old=>old!.map(r=>r.key===row.key?{...r,song:{...r.song,name}}:r));}} placeholder="歌名"/>
 <input aria-label={'第'+(i+1)+'首歌手'} className={input} value={row.song.artists} disabled={busy} onChange={e=>{const artists=e.target.value;setDraft(old=>old!.map(r=>r.key===row.key?{...r,song:{...r.song,artists}}:r));}} placeholder="歌手"/>
 <button aria-label={'移除待导入歌曲 '+(i+1)} disabled={busy} onClick={()=>setDraft(old=>old!.filter(r=>r.key!==row.key))}>删除此首</button></article>)}
 </div><div className="flex gap-4 py-3"><button disabled={busy} onClick={()=>setDraft(null)}>取消</button><button disabled={busy||!draft.length||draft.some(r=>!r.song.name.trim()||!r.song.artists.trim()||!r.url.startsWith('https:'))} onClick={()=>void perform(async()=>{await onConfirm(draft.map(r=>({...r.song,name:r.song.name.trim(),artists:r.song.artists.trim()})));setDraft(null);setLinks('');})}>确认导入</button></div>{error&&<p role="alert">{error}</p>}</div>}
 </section>;
}
