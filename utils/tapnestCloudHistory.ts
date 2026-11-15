import {DB} from './db';
import {parsePetRecords} from './tapnestCloud';
const importing=new Map<string,Promise<void>>(),checked=new Map<string,number>();
/** An adapter before normal context reads; does not change range boundaries or memory watermarks. */
export async function recoverPetCloudHistory(charId:string):Promise<void>{
 if(typeof window==='undefined'||typeof DB.getAsset!=='function')return;
 const raw=await DB.getAsset('tapnest_config_v2');if(!raw||!JSON.parse(raw).bindings?.[charId]?.cloudEnabled)return;
 const pending=importing.get(charId);if(pending)return pending;
 if(Date.now()-(checked.get(charId)||0)<1000)return;
 const run=(async()=>{const {ActiveMsgClient}=await import('./activeMsgClient');const rows=await ActiveMsgClient.readPetCloudState(charId);let added=false;
 for(const r of parsePetRecords(rows).filter(r=>r.source==='pet')){
  await DB.saveMessageOnce('tapnest-cloud:'+charId+':'+r.id,{charId,role:r.role,type:'text',content:r.content,timestamp:r.at,metadata:{source:'tapnest',petCloudRecordId:r.id,tapnestEventId:r.eventId,tapnestFormId:r.formId,tapnestKind:r.kind}});added=true;
 }
 checked.set(charId,Date.now());if(added&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('tapnest-history-updated',{detail:{charId}}));
 })();importing.set(charId,run);try{await run;}finally{if(importing.get(charId)===run)importing.delete(charId);}
}
