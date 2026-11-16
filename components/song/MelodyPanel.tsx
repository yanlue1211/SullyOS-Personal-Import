import React,{useEffect,useRef,useState} from 'react';
import type {SongSheet} from '../../types';
import {getMelody,melodyToAbc,type SongWithMelody} from '../../features/songwriting/melody';
import {vocalTarget,vocalPhrases,selectVocalRange,type VocalTarget} from '../../features/songwriting/vocalMelody';
import {loadAbcjs,renderMelodyAudio} from '../../features/songwriting/melodyAudio';
import {mutateSong} from '../../features/songwriting/storage';
import {finalLines,sectionNames} from '../../features/songwriting/model';
import {useVocalPlayback} from './useVocalPlayback';
import './MelodyPanel.css';
interface Props {song:SongSheet;onUpdate:(s:SongSheet)=>void;onCompose:(text:string,target?:VocalTarget,listen?:boolean)=>void;composing:boolean}
export default function MelodyPanel({song,onUpdate,onCompose,composing}:Props){
 const project=getMelody(song),lines=finalLines(song),paper=useRef<HTMLDivElement>(null);
 const [selected,setSelected]=useState(''),[scope,setScope]=useState<VocalTarget['scope']>('song'),[position,setPosition]=useState(0),[phraseId,setPhraseId]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[file,setFile]=useState<{key:string;wav:string;midi?:string}|null>(null);
 const lock=useRef(false),mounted=useRef(true);const playback=useVocalPlayback(song);
 const current=project?.versions.find(v=>v.id===selected)||project?.versions.find(v=>v.id===project.activeId);
 useEffect(()=>setSelected(project?.activeId||''),[project?.activeId]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>()=>{if(file){URL.revokeObjectURL(file.wav);if(file.midi)URL.revokeObjectURL(file.midi);}},[file]);
 const target:VocalTarget=lines.length?vocalTarget(song,scope,position):{scope,lineIds:[],phraseIds:scope==='song'?undefined:[phraseId||vocalPhrases(current||{id:'',bars:[]} as any)[0]?.id].filter(Boolean)};
 let range:ReturnType<typeof selectVocalRange>|undefined;
 try{if(current)range=selectVocalRange(song,current,target);}catch{}
 const rangeKey=current?.id+':'+range?.key;
 useEffect(()=>{let alive=true;if(!paper.current||!range)return;loadAbcjs().then(abc=>{if(alive&&paper.current)abc.renderAbc(paper.current,melodyToAbc(range!.version,song.title),{responsive:'resize',staffwidth:540});}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[rangeKey,song.title]);
 const run=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e:any){if(mounted.current)setError(e.message||'操作失败');}finally{lock.current=false;if(mounted.current)setBusy(false);}};
 const activate=()=>void run(async()=>{if(!current)return;const saved=await mutateSong(song.id,s=>{const p=getMelody(s);if(!p?.versions.some(v=>v.id===current.id))throw Error('版本已变化');return {song:{...s,melody:{...p,activeId:current.id}} as SongWithMelody};});onUpdate(saved);});
 const bind=(id:string,lineId:string)=>void run(async()=>{const saved=await mutateSong(song.id,s=>{const p=getMelody(s),version=p?.versions.find(v=>v.id===current?.id),line=finalLines(s).find(l=>l.id===lineId);if(!p||!version)throw Error('版本已变化');const phrases=vocalPhrases(version).map(part=>part.id===id?{...part,lineId:line?.id,lyricText:line?.content,section:line?.section||part.section}:part.lineId===lineId&&lineId?{...part,lineId:undefined,lyricText:undefined}:part);const next={...version,id:crypto.randomUUID(),createdAt:Date.now(),sourceId:version.id,phrases};return {song:{...s,melody:{activeId:next.id,versions:[...p.versions,next]}} as SongWithMelody};});onUpdate(saved);});
 const prepare=()=>void run(async()=>{if(!range)return;const result=await renderMelodyAudio(range.version,song.title);const next={key:rangeKey,wav:URL.createObjectURL(result.wav),midi:result.midi?URL.createObjectURL(result.midi):undefined};if(mounted.current)setFile(next);else{URL.revokeObjectURL(next.wav);if(next.midi)URL.revokeObjectURL(next.midi);}});
 return <section className="sw-melody" aria-label="人声曲谱">
  <h3>♫ 人声曲谱</h3><p className="sw-note">选一句、一段或整首来写、听和调整。所有交流都在「创作对话」。一个字可以对应多个音符、转音和延长音。</p>
  <div className="sw-vocal-range"><label>范围<select aria-label="旋律范围" value={scope} onChange={e=>setScope(e.target.value as any)}><option value="line">逐句</option><option value="section">逐段</option><option value="song">整首</option></select></label>
  {scope!=='song'&&(lines.length?<label>从哪句<select aria-label="旋律歌词句子" value={position} onChange={e=>setPosition(Number(e.target.value))}>{lines.map((l,i)=><option key={l.id} value={i}>{i+1}. {l.content}</option>)}</select></label>:current?<label>未填词乐句<select aria-label="旋律片段" value={phraseId||vocalPhrases(current)[0]?.id} onChange={e=>setPhraseId(e.target.value)}>{vocalPhrases(current).map((p,i)=><option key={p.id} value={p.id}>第{i+1}乐句 · {p.count}小节</option>)}</select></label>:<p className="sw-note">还没有歌词，可以先写一个人声乐句。</p>)}</div>
  <div className="sw-melody-actions"><button className="sw-primary" disabled={busy||composing} onClick={()=>onCompose(`请为${scope==='song'?'整首歌曲':scope==='line'?'所选这一句':'所选这一段'}谱写或调整人声旋律，其他已有片段保持不变。`,target)}>为所选范围谱曲</button><button disabled={busy||composing} onClick={()=>onCompose('我想和你聊聊这首歌的人声曲调。',target)}>去创作对话</button></div>
  {!!project?.versions.length&&<label className="sw-melody-select">旋律版本<select aria-label="旋律版本" value={current?.id} disabled={busy||composing} onChange={e=>{playback.stop();setSelected(e.target.value);}}>{project.versions.map((v,i)=><option key={v.id} value={v.id}>第{i+1}版 · {v.bars.length}小节 · {v.bpm} BPM{project.activeId===v.id?' · 当前':''}</option>)}</select>{current?.id!==project.activeId&&<button onClick={activate}>使用这一版继续创作</button>}</label>}
  {current&&<>
   {range?<><div className="sw-melody-paper" ref={paper} aria-label="人声主旋律五线谱"/><div className="sw-melody-actions"><button disabled={busy||composing||current.id!==project?.activeId} onClick={()=>void playback.play(target)}>🔊 试听所选曲调</button>{playback.playing&&<button onClick={playback.stop}>停止</button>}<button disabled={busy||composing} onClick={prepare}>准备 WAV / MIDI</button><button disabled={busy||composing||current.id!==project?.activeId} onClick={()=>onCompose('你听听所选范围的人声旋律，结合歌词按自己的想法聊聊，需要时只修改这个范围。',target,true)}>让 Char 听所选范围</button></div><details className="sw-melody-source"><summary>ABC 乐谱</summary><pre>{melodyToAbc(range.version,song.title)}</pre></details></>:<p className="sw-note">所选歌词还没有关联曲调；可以先谱这一句，或在下方关联已有乐句。</p>}
   {file?.key===rangeKey&&<div className="sw-melody-player"><audio controls src={file.wav}/><a href={file.wav} download={song.title+'-人声旋律.wav'}>下载 WAV</a>{file.midi&&<a href={file.midi} download={song.title+'-人声旋律.mid'}>下载 MIDI</a>}</div>}
   <details className="sw-melody-source"><summary>歌词与乐句对应 · 先曲后词也可在这里关联</summary><p className="sw-note">整句对应完整乐句，不按字数强行分音。改词后可重新关联或让 Char 调整。</p>{vocalPhrases(current).map((p,i)=><label className="sw-vocal-binding" key={p.id}>乐句 {i+1} · {p.count} 小节<select aria-label={`乐句${i+1}关联歌词`} disabled={busy||composing} value={lines.some(l=>l.id===p.lineId)?p.lineId:''} onChange={e=>bind(p.id,e.target.value)}><option value="">未填词 / 保留纯曲调</option>{lines.map((l,n)=><option key={l.id} value={l.id}>{n+1}. {l.content}</option>)}</select>{p.lyricText&&!lines.some(l=>l.id===p.lineId&&l.content===p.lyricText)&&<small>原词：{p.lyricText} · 词已变化，待重新对应</small>}</label>)}</details>
   {(current.listening||current.listeningReports?.length)&&<details className="sw-melody-source"><summary>已保存的客观试听描述</summary>{current.listening&&<pre>整首：{current.listening}</pre>}{current.listeningReports?.map(r=><pre key={r.key}>{r.label}：{r.description}</pre>)}</details>}
   <p className="sw-note">给 Char 试听使用独立音频 API，同版同范围复用已保存描述；钢琴只演奏人声曲调，不是演唱成品或伴奏。</p>
  </>}
  {(error||playback.error)&&<p role="alert" className="sw-error">{error||playback.error}</p>}{busy&&<p role="status">正在准备…</p>}
 </section>;
}
