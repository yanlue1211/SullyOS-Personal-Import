/** Temporary two-day observer. Removal: delete this file/panel and undo the two import aliases. */
import {safeFetchJson} from '../../utils/safeApi';
import {extractApiTokenUsage,buildPromptBreakdown} from '../../utils/apiCallLog';
export const MONITOR_KEY='moments-api-monitor-v1';
export const MONITOR_EVENT='moments-api-monitor-changed';
const WINDOW=2*86400000,MAX_ROWS=200;
export interface MonitorEntry {
 id:string;at:number;endedAt?:number;durationMs?:number;role:string;purpose:string;model:string;host:string;
 state:'pending'|'ok'|'error'|'aborted'|'truncated';input?:number;output?:number;total?:number;cached?:number;cacheWrite?:number;
 blocks?:{label:string;chars:number}[];
}
export interface MonitorState {generation:string;enabled:boolean;expires:number;entries:MonitorEntry[]}
export function readMonitor():MonitorState|null {
 try{const state=JSON.parse(localStorage.getItem(MONITOR_KEY)||'null');
  return state&&typeof state.generation==='string'&&typeof state.enabled==='boolean'&&Number.isFinite(state.expires)&&Array.isArray(state.entries)?state:null;
 }catch{return null;}
}
function save(state:MonitorState){try{localStorage.setItem(MONITOR_KEY,JSON.stringify(state));if(typeof window!=='undefined')window.dispatchEvent(new Event(MONITOR_EVENT));}catch{/* An observer must never fail a real request. */}}
export function controlMonitor(action:'start'|'clear'|'remove'){
 const old=readMonitor();
 save({generation:crypto.randomUUID(),enabled:action==='start'?true:action==='remove'?false:old?.enabled??false,expires:action==='start'?Date.now()+WINDOW:old?.expires??0,entries:[]});
}
function begin(args:Parameters<typeof safeFetchJson>):{id:string;generation:string}|null {
 if(args[4]?.appName!=='朋友圈')return null;
 let state=readMonitor();if(!state){state={generation:crypto.randomUUID(),enabled:true,expires:Date.now()+WINDOW,entries:[]};}
 if(!state.enabled||Date.now()>=state.expires)return null;
 let body:any;try{body=typeof args[1].body==='string'?JSON.parse(args[1].body):undefined;}catch{}
 let host='';try{host=new URL(args[0]).host;}catch{}
 const id=crypto.randomUUID();
 const row:MonitorEntry={id,at:Date.now(),role:args[4]?.charName||'user 媒体',purpose:args[4]?.purpose||'朋友圈请求',model:typeof body?.model==='string'?body.model:'未提供',host,state:'pending',blocks:buildPromptBreakdown(body)?.slice(0,24).map((x,i)=>({label:'输入块 '+(i+1),chars:x.chars}))};
 state.entries=[row,...state.entries].slice(0,MAX_ROWS);save(state);return{id,generation:state.generation};
}
function finish(ticket:{id:string;generation:string}|null,response?:any,error?:unknown){
 if(!ticket)return;const state=readMonitor();if(!state||!state.enabled||state.generation!==ticket.generation)return;
 const row=state.entries.find(x=>x.id===ticket.id);if(!row)return;
 const usage=extractApiTokenUsage(response),aborted=error instanceof Error&&error.name==='AbortError';
 Object.assign(row,{endedAt:Date.now(),durationMs:Math.max(0,Date.now()-row.at),state:error?(aborted?'aborted':'error'):response?.choices?.[0]?.finish_reason==='length'?'truncated':'ok',input:usage.prompt,output:usage.completion,total:usage.total,cached:usage.cached,cacheWrite:usage.cacheWrite});
 save(state);
}
export async function momentsFetchJson(...args:Parameters<typeof safeFetchJson>):Promise<any>{
 let ticket:ReturnType<typeof begin>=null;try{ticket=begin(args);}catch{}
 try{const data=await safeFetchJson(...args);try{finish(ticket,data);}catch{}return data;}
 catch(error){try{finish(ticket,undefined,error);}catch{}throw error;}
}
