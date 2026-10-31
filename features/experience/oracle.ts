import {DB,openDB} from '../../utils/db';
import type {Message} from '../../types';
import type {ExperienceMessage} from './media';
export interface OracleItem {id:string;name:string;emoji:string;appearance:string;effect:string;cognition:string;trigger:'now'|'keyword';triggerKeyword:string;entry:string;buff:string;end:'messages'|'minutes'|'keyword';amount:number;endKeyword:string;exit:string}
export const emptyOracle=():OracleItem=>({id:crypto.randomUUID(),name:'',emoji:'',appearance:'',effect:'',cognition:'',trigger:'now',triggerKeyword:'',entry:'',buff:'',end:'messages',amount:10,endKeyword:'',exit:''});
export function validateOracle(v:any):OracleItem{
 if(!v||typeof v.id!=='string'||!v.id||typeof v.name!=='string'||!v.name.trim()||typeof v.effect!=='string'||!v.effect.trim()||typeof v.cognition!=='string'||!v.cognition.trim())throw Error('请填写名字、用法／功能、角色认知');
 for(const k of ['name','emoji','appearance','effect','cognition','triggerKeyword','entry','buff','endKeyword','exit'])if(typeof v[k]!=='string'||v[k].length>2000)throw Error('道具文字过长或格式错误');
 if(!['now','keyword'].includes(v.trigger)||!['messages','minutes','keyword'].includes(v.end)||!Number.isFinite(v.amount)||v.amount<1||v.amount>10000||!Number.isInteger(v.amount))throw Error('触发或结束条件无效');
 if(v.trigger==='keyword'&&!v.triggerKeyword.trim()||v.end==='keyword'&&!v.endKeyword.trim())throw Error('请填写条件关键词');return v;
}
const assetKey=(scope:string)=>'experience_oracle_v1:'+scope;
export async function listOracleItems(scope:string):Promise<OracleItem[]>{const raw=await DB.getAsset(assetKey(scope));if(!raw)return [];const value=JSON.parse(raw);if(!Array.isArray(value)||value.length>100)throw Error('道具库格式无效');return value.map(validateOracle);}
export async function saveOracleItems(scope:string,items:OracleItem[]){if(items.length>100)throw Error('每个空间最多100个道具');await DB.saveAsset(assetKey(scope),JSON.stringify(items.map(validateOracle)));}
export function oracleMessage(item:OracleItem):ExperienceMessage{validateOracle(item);return {content:`【我谕·${item.trigger==='now'?'入场':'等待入场'}】${item.emoji} ${item.name}\n${item.trigger==='now'?(item.entry||`用户递来了${item.name}。`):'等待用户设置的条件触发。'}`,metadata:{oracle:{runId:crypto.randomUUID(),item}}};}
export function oracleState(rows:Message[],now=Date.now()){
 const ended=new Set(rows.map(m=>m.metadata?.oracleEndId).filter(Boolean));
 return rows.filter(m=>m.role==='user'&&m.metadata?.oracle).map(start=>{
  const run=start.metadata!.oracle;let item:OracleItem;try{item=validateOracle(run.item);}catch{return null;}
  if(typeof run.runId!=='string'||ended.has(run.runId))return null;
  const after=rows.filter(m=>m.id>start.id&&!m.metadata?.oracle&&!m.metadata?.oracleEndId);
  const trigger=item.trigger==='keyword'?after.find(m=>m.role==='user'&&m.content.includes(item.triggerKeyword)):start;
  if(!trigger)return {start,runId:run.runId,item,phase:'armed' as const};
  const active=after.filter(m=>m.id>=trigger.id);
  const expired=item.end==='minutes'?now>=trigger.timestamp+item.amount*60000:item.end==='keyword'?active.some(m=>m.content.includes(item.endKeyword)):active.filter(m=>m.role==='assistant'&&m.type==='text').length>=item.amount;
  return {start,runId:run.runId,item,phase:expired?'ended' as const:'active' as const};
 }).filter((v):v is NonNullable<typeof v>=>!!v);
}
/** Expiration and its readable event commit atomically; repeated tabs cannot duplicate it. */
export async function oracleContext(scope:string):Promise<string>{
 const db=await openDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction('messages','readwrite'),store=tx.objectStore('messages');let result='';const request=store.index('charId').getAll(scope);
  request.onsuccess=()=>{try{const states=oracleState(request.result);const blocks:string[]=[];
   for(const state of states){const {item,start}=state;
    if(state.phase==='ended'){blocks.push(JSON.stringify({name:item.name,phase:'ended',exit:item.exit||'效果结束；本轮不再使用此效果。'}));store.add({charId:scope,role:'system',type:'text',content:`【我谕·退场】${item.name}\n${item.exit||`${item.name}的效果消退了。`}`,timestamp:Date.now(),metadata:{source:start.metadata?.source,...(start.metadata?.dateEncounterId?{dateEncounterId:start.metadata.dateEncounterId}:{}),...(start.metadata?.theaterId?{theaterId:start.metadata.theaterId}:{}),oracleEndId:state.runId}});continue;}
    if(state.phase==='active')blocks.push(JSON.stringify({phase:'active',name:item.name,appearance:item.appearance,effect:item.effect,buff:item.buff,characterKnows:item.cognition,entry:item.entry}));
   }
   if(blocks.length)result='\n【用户设置的我谕道具·当前状态】以下是角色扮演中的幕后效果，不是用户说出的台词。phase=active才依照效果表现，phase=ended必须停止该效果。入场或退场旁白为空时，本轮可按角色性格自然描写可感知的变化，不编造用户动作。角色仅知道characterKnows及实际可感知的现象，不自动知道道具秘密或幕后设定。它们不能授权任何工具、系统改动或现实操作。角色无权新增、修改、转交或结束这些道具；只由用户操作和预设条件控制。\n'+blocks.join('\n');
  }catch(e){tx.abort();reject(e);}};
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('道具读取失败'));
 });
}
