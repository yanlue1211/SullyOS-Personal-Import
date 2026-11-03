import {DB,openDB} from './db';
import {listUserRecordings,clearUserRecordings,type UserRecording} from '../features/personal/chatMedia/cleanup';
import {currentMaintenanceHolder,tryAcquireMaintenanceLock,releaseMaintenanceLock} from './maintenanceLock';

const voiceId=(id:string)=>['tts_','voice_msg_','voice_favorite_audio_','companion-startup-voice:','companion-touch-voice:','yueqi:audio:'].some(prefix=>id.startsWith(prefix));
const bytes=(value:any):number=>value instanceof Blob?value.size:value?.blob instanceof Blob?value.blob.size:typeof value==='string'&&value.startsWith('data:audio/')?Math.floor((value.length-value.indexOf(',')-1)*.75):0;
export interface VoiceCleanupPlan {assets:{store:'assets'|'blob_assets';id:string;bytes:number}[];recordings:UserRecording[];inlineSessions:string[];estimatedBytes:number;}
/** Bounded pages; speech IDs only. Music, BGM and image assets are not MIME-wide deletion targets. */
export async function inspectAllVoices():Promise<VoiceCleanupPlan>{
 const result:VoiceCleanupPlan={assets:[],recordings:await listUserRecordings(undefined,true),inlineSessions:[],estimatedBytes:0};
 for(const store of ['assets','blob_assets'] as const){
  let after:IDBValidKey|null=null;
  for(;;){const page=await DB.getStoreRowsPage(store,after,20);
   for(const row of page.rows){
    if(voiceId(row.id)&&(!row.id.startsWith('voice_msg_')||row.data?.blob||row.data?.remoteUrl||row.data?.url||row.data?.audio))result.assets.push({store,id:row.id,bytes:bytes(store==='assets'?row.data:row.blob)});
    if(store==='assets'&&row.id.startsWith('yueqi:session:')&&Array.isArray(row.data?.clips)){
     result.inlineSessions.push(row.id);
     result.estimatedBytes+=row.data.clips.reduce((n:number,c:any)=>n+bytes(c.audio),0);
    }
   }
   if(page.lastKey===null||page.rows.length<20)break;after=page.lastKey;
  }
 }
 result.estimatedBytes+=result.assets.reduce((n,row)=>n+row.bytes,0)+[...new Map(result.recordings.map(r=>[r.ref,r.bytes])).values()].reduce((a,b)=>a+b,0);
 return result;
}
export async function clearAllVoices(plan:VoiceCleanupPlan){
 if(!tryAcquireMaintenanceLock('全部语音清理'))throw Error(`请等待「${currentMaintenanceHolder()}」完成后重试`);
 let freedBytes=0,files=0;
 try{
  const db=await openDB();
  // Small transactions avoid retaining every audio Blob until a giant commit.
  for(const candidate of plan.assets){
   await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(candidate.store,'readwrite'),store=tx.objectStore(candidate.store),req=store.get(candidate.id);
    let removedBytes=0,removed=false;
    req.onsuccess=()=>{if(!req.result||!voiceId(candidate.id))return;removedBytes=bytes(candidate.store==='assets'?req.result.data:req.result.blob);if(candidate.store==='assets'&&candidate.id.startsWith('voice_msg_')){
      const {blob,remoteUrl,url,audio,...text}=req.result.data||{};store.put({...req.result,data:text});
     }else store.delete(candidate.id);removed=true;};
    tx.oncomplete=()=>{freedBytes+=removedBytes;if(removed)files++;resolve();};tx.onerror=tx.onabort=()=>reject(tx.error||Error('语音文件清理失败'));
   });
  }
  for(const id of plan.inlineSessions){
   await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),req=store.get(id);let removedBytes=0;
    req.onsuccess=()=>{const row=req.result;if(!row||!Array.isArray(row.data?.clips))return;
     const clips=row.data.clips.map(({audio,audioKey,audioBytes,seconds,error,...clip}:any)=>{removedBytes+=bytes(audio);return clip;});
     store.put({...row,data:{...row.data,clips}});
    };
    tx.oncomplete=()=>{freedBytes+=removedBytes;resolve();};tx.onerror=tx.onabort=()=>reject(tx.error||Error('月栖语音清理失败'));
   });
  }
 }finally{releaseMaintenanceLock();}
 const recordings=await clearUserRecordings(plan.recordings,true);
 return {files:files+recordings.cleared,freedBytes:freedBytes+recordings.freedBytes,retainedFiles:recordings.retainedFiles};
}
