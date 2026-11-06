import React,{useEffect,useState} from 'react';
import {useLocalBackHandler} from '../hooks/useLocalBackHandler';
import {MONITOR_KEY,MONITOR_EVENT,readMonitor,controlMonitor,type MonitorState} from '../features/moments/apiMonitor';
export default function MomentsApiMonitor({onClose}:{onClose:()=>void}){
 const [state,setState]=useState<MonitorState|null>(()=>readMonitor());
 useLocalBackHandler(()=>{onClose();return true;},60);
 useEffect(()=>{const refresh=()=>setState(readMonitor());const cross=(e:StorageEvent)=>{if(e.key===MONITOR_KEY)refresh();};window.addEventListener(MONITOR_EVENT,refresh);window.addEventListener('storage',cross);return()=>{window.removeEventListener(MONITOR_EVENT,refresh);window.removeEventListener('storage',cross);};},[]);
 useEffect(()=>{if(!state?.enabled||state.expires<=Date.now())return;const timer=setTimeout(()=>setState(readMonitor()),state.expires-Date.now()+5);return()=>clearTimeout(timer);},[state?.enabled,state?.expires]);
 const active=state?.enabled&&state.expires>Date.now(),rows=state?.entries||[];
 const known=rows.filter(r=>r.input!==undefined||r.output!==undefined);
 const labels={pending:'请求中',ok:'完成',error:'请求失败',aborted:'已取消',truncated:'输出截断'};
 return <div className="mm-overlay"><section role="dialog" aria-modal="true" aria-label="朋友圈 API 调用监控" style={{maxHeight:'90%',overflow:'auto',width:'100%'}}>
 <h3>朋友圈 API 调用监控</h3><p className="mm-hint">临时记录两天，仅含朋友圈活动、习惯评估、媒体识别。普通聊天不计入。不保存 Key、请求正文或回复原文。</p>
 <p>{!state?'首次朋友圈请求起自动记录两天':active?'记录至 '+new Date(state.expires).toLocaleString():state.enabled?'两天已到，已停止记录':'监控已关闭'}</p>
 <p>共 {rows.length} 次 · 完成 {rows.filter(r=>r.state==='ok').length} · 失败/截断 {rows.filter(r=>['error','truncated'].includes(r.state)).length}</p>
 <p>已返回用量合计：输入 {known.reduce((n,r)=>n+(r.input??0),0)} · 输出 {known.reduce((n,r)=>n+(r.output??0),0)}（{known.length} 次有用量数据）</p>
 <p className="mm-hint">仅保留最近200次。Token 取自接口返回，未返回时显示“—”，不自行估算。统计的是请求结果，活动最终是否落库请看活动记录。</p>
 <div className="mm-dialog-actions" style={{flexWrap:'wrap'}}>
 <button onClick={onClose}>返回</button>
 {!active&&<button onClick={()=>controlMonitor('start')}>开始记录两天</button>}
 <button disabled={!rows.length} onClick={()=>controlMonitor('clear')}>清空记录</button>
 <button onClick={()=>controlMonitor('remove')}>关闭并清除</button></div>
 {rows.map(row=><details key={row.id} style={{borderTop:'1px solid #eee',padding:'12px 0'}}><summary style={{cursor:'pointer',overflowWrap:'anywhere'}}>{new Date(row.at).toLocaleString()} · {row.role} · {row.purpose} · {labels[row.state]}</summary>
 <p style={{overflowWrap:'anywhere'}}>模型：{row.model} · {row.host}</p><p>耗时 {row.durationMs===undefined?'—':(row.durationMs/1000).toFixed(2)+'秒'} · 输入 {row.input??'—'} · 输出 {row.output??'—'} · 总计 {row.total??'—'} · 缓存读取 {row.cached??'—'} · 缓存写入 {row.cacheWrite??'—'}</p>
 {!!row.blocks?.length&&<details><summary>输入构成（字符数）</summary>{row.blocks.map((block,i)=><p key={i}>{block.label}：{block.chars}</p>)}</details>}
 </details>)}
 {!rows.length&&<p className="mm-hint">暂无朋友圈请求记录。</p>}
 </section></div>;
}
