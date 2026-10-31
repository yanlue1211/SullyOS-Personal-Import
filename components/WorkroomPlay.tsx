import React,{useEffect,useRef,useState} from 'react';
import {useOS} from '../context/OSContext';
import WorkroomRunner from './WorkroomRunner';
import {WorkroomStorage as W} from '../features/workroom/storage';
import {generateRuntimeTurn} from '../features/workroom/runtime';
import type {WorkroomVersion,WorkroomTurn} from '../features/workroom/schema';
export default function WorkroomPlay({charId,version,onNotify,onError}:{charId:string;version:WorkroomVersion;onNotify:(s:string)=>void;onError:(s:string)=>void}){
 const os=useOS(),[expanded,setExpanded]=useState(false),[enabled,setEnabled]=useState(false),[permissionBusy,setPermissionBusy]=useState(true),[auto,setAuto]=useState(false),[turns,setTurns]=useState<WorkroomTurn[]>([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),allow=useRef(false),running=useRef(false),controller=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setTimeout>>(),events=useRef<string[]>([]);
 const refresh=async()=>{const rows=await W.playTurns(charId,version.workId);if(alive.current)setTurns(rows.slice(-12));};
 useEffect(()=>{alive.current=true;void W.getWork(charId,version.workId).then(s=>{if(alive.current){allow.current=s.runtimeAiEnabled===true;setEnabled(allow.current);}}).catch(e=>{if(alive.current)setError(String(e));}).finally(()=>{if(alive.current)setPermissionBusy(false);});void refresh().catch(e=>{if(alive.current)setError(String(e));});return()=>{alive.current=false;controller.current?.abort();clearTimeout(timer.current);};},[charId,version.id]);
 const generate=async(request:unknown,id:string,signal?:AbortSignal)=>{
  if(!allow.current)throw Error('请先开启运行时AI');if(running.current)throw Error('角色正在回应，请稍候');running.current=true;setBusy(true);setError('');const abort=new AbortController();controller.current=abort;const cancel=()=>abort.abort(signal?.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  try{const value=await generateRuntimeTurn({charId,workId:version.workId,versionId:version.id,request,requestId:id,api:os.apiConfig,user:os.userProfile,signal:abort.signal,context:{realtimeConfig:os.realtimeConfig,groups:os.groups,emojis:[],categories:[]}});if(alive.current)await refresh();return value;}
  catch(e){if(alive.current&&!abort.signal.aborted)setError(e instanceof Error?e.message:String(e));throw e;}
  finally{signal?.removeEventListener('abort',cancel);running.current=false;if(alive.current)setBusy(false);}
 };
 const speak=async(text:string)=>{try{await generate({instruction:'与用户一起体验当前作品，根据本轮互动及保存状态自然回应。需要采取动作时只提出建议，不谎称已执行；不泄露题目隐藏答案。',context:{userMessage:text},format:'text',publicEvent:text,shareReply:true},crypto.randomUUID());}catch{/* visible error retained */}};
 const toggle=async(value:boolean)=>{const previous=allow.current;setEnabled(value);setPermissionBusy(true);if(!value){allow.current=false;controller.current?.abort();clearTimeout(timer.current);events.current=[];}try{await W.setRuntimeAi(charId,version.workId,value);if(alive.current)allow.current=value;}catch(e){if(alive.current){allow.current=previous;setEnabled(previous);setError(String(e));}}finally{if(alive.current)setPermissionBusy(false);}};
 return <div className="wr-play"><div className="wr-play-stage"><WorkroomRunner charId={charId} version={version} onNotify={onNotify} onError={onError} onGenerate={generate} onEvent={text=>{if(!allow.current||!auto)return;events.current=[...events.current,text].slice(-20);clearTimeout(timer.current);const flush=()=>{if(!alive.current||!allow.current)return;if(running.current){timer.current=setTimeout(flush,2200);return;}const text=events.current.splice(0).slice(-5).join('；').slice(0,1500);if(text)void speak(text);};timer.current=setTimeout(flush,2200);}}/></div>
 <section className="wr-companion" aria-label="角色互动">
 <button type="button" className="wr-companion-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'收起 '+(os.characters.find(c=>c.id===charId)?.name||'TA')+' 互动 ▾':'💬 '+(os.characters.find(c=>c.id===charId)?.name||'TA')+' 互动与设置 ▴'}{busy?' · 回应中…':''}</button>
 {expanded && <div className="wr-companion-body">
 <label><input type="checkbox" disabled={permissionBusy} checked={enabled} onChange={e=>void toggle(e.target.checked)}/> 允许本游戏调用 API</label><small>{permissionBusy?'正在保存设置…':enabled?'游戏 API 已开启 · ':''}允许游戏按需使用当前角色的 API 生成内容，不会自动每次操作都调用。</small>
 {enabled&&<><label className="wr-auto"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/> 操作后让 {os.characters.find(c=>c.id===charId)?.name||'TA'} 回应</label><small>连续操作会合并，约 2.2 秒后回应一次。</small><div className="wr-play-history">{turns.map(t=><p key={t.id}><b>{t.role==='user'?'你':'TA'}</b> {t.text}</p>)}</div><form onSubmit={e=>{e.preventDefault();const text=input.trim();if(!text||busy)return;setInput('');void speak(text);}}><input aria-label="一起玩消息" value={input} maxLength={1500} onChange={e=>setInput(e.target.value)} placeholder="和 TA 讨论当前局面…"/><button disabled={busy||permissionBusy||!input.trim()}>发送</button><button type="button" disabled={busy||permissionBusy} onClick={()=>void speak('看看当前游戏状态，你有什么反应或想法？')}>让 TA 看看</button></form>{busy&&<p role="status">TA 正在参与… <button onClick={()=>controller.current?.abort()}>停止</button></p>}</>}{error&&<p role="alert">{error}</p>}
 </div>}
 </section></div>;
}
