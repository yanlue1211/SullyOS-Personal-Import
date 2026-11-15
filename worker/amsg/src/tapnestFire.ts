import {AMSG_CHAT_PRESENCE_KEY,parseAmsgChatPresence,isFreshChatPresence} from '../../../utils/amsgChatPresence';
import {amsgStateNamespace} from '../../../utils/amsgFirePack';
import type {FireKindHandler,KindWriteState} from './fireKinds';
import {PET_CLOUD_CONFIG,petCloudNamespace,parsePetRecords,petContextRecords,renderPetContext,type PetCloudConfig,type PetCloudRecord} from '../../../utils/tapnestCloud';
import {sanitizeForNotification} from '../../../utils/sanitize';
interface PetFireState {charId:string;eventId:string;formId:string;startedAt:number;committed?:boolean}
export const tapnestHandler:FireKindHandler={
 async beforeFire({ctx,charId,taskMeta}){
  if(!ctx.writeState)throw Error('Worker缺少桌宠写入能力');
  const id=String(taskMeta.petEventId||'');
  ctx.scratch.petCloudFire={charId,eventId:id,formId:'',startedAt:Date.now()};
  const ns=petCloudNamespace(charId),rows=await ctx.readState(ns);
  const config:PetCloudConfig=JSON.parse(rows.find(r=>r.key===PET_CLOUD_CONFIG)?.value||'null');
  const input=JSON.parse(rows.find(r=>r.key==='event:'+id)?.value||'null');
  if(!config?.enabled||config.revision!==taskMeta.petRevision||!input){await ctx.writeState(ns,[{key:'result:'+id,value:JSON.stringify({status:'failed',error:'桌宠设置已变更，本次未调用模型'})}]);return {skip:true,reason:'pet-config-changed'};}
  // Once claimed, an ambiguous failure is terminal for this event, including a task recreated
  // after an interrupted schedule acknowledgement. Never charge twice automatically.
  if(rows.some(r=>r.key==='result:'+id||r.key==='claim:'+id))return {skip:true,reason:'pet-already-claimed'};
  const mainRows=await ctx.readState(amsgStateNamespace(charId));
  if(isFreshChatPresence(parseAmsgChatPresence(mainRows.find(r=>r.key===AMSG_CHAT_PRESENCE_KEY)?.value),charId,ctx.now.getTime()))return {defer:{afterMs:45000}};
  const startedAt=Date.now();await ctx.writeState(ns,[{key:'claim:'+id,value:JSON.stringify({at:startedAt})}]);
  const records=petContextRecords(parsePetRecords(rows),config.coveredIds).filter(r=>r.role==='assistant'||r.at<=input.acceptedAt||r.eventId===id);
  const form=config.forms.find(f=>f.id===input.event.formId);
  const state:PetFireState={charId,eventId:id,formId:input.event.formId,startedAt};
  ctx.scratch.petCloudFire=state;
  return {messages:[...config.messages,{role:'user',content:renderPetContext(records)+'\n当前桌宠形态：'+(form?.name||input.event.formId)+'。请只回应最后一次桌宠事件，不替用户说话，只输出气泡正文。'}],state,totalTimeoutMs:600000};
 },
 async llmOutput({ctx,state}){
  const s=state as PetFireState;if(!ctx.writeState)throw Error('桌宠结果无法存储');
  if((ctx.llmResponse as any)?.choices?.[0]?.finish_reason==='length')throw Error('桌宠模型回复被截断');
  const text=sanitizeForNotification(ctx.llmOutputText||'').trim();if(!text)throw Error('桌宠模型没有返回正文');
  const record:PetCloudRecord={id:s.eventId+':out',eventId:s.eventId,at:Date.now(),role:'assistant',content:text,formId:s.formId,source:'pet'};
  await ctx.writeState(petCloudNamespace(s.charId),[{key:'record:'+record.id,value:JSON.stringify(record)},{key:'result:'+s.eventId,value:JSON.stringify({status:'done',text})}]);
  s.committed=true;return {decision:'skip-push',reason:'pet-result-stored'};
 }
};
export async function settlePetCloud(info:{status?:string;scratch:Record<string,unknown>;writeState:KindWriteState}){
 const s=info.scratch.petCloudFire as PetFireState|undefined;if(!s)return false;
 if(!s.committed&&(info.status==='failed'||info.status==='cancelled'))await info.writeState(petCloudNamespace(s.charId),[{key:'result:'+s.eventId,value:JSON.stringify({status:'failed',error:'本轮生成未完成；不会自动重试付费请求，请重新发一条消息'})}]);
 return true;
}
