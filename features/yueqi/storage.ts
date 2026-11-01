import {DB,openDB} from '../../utils/db';
import {elapsed,type Clip,type Session} from './model';
const prefix='yueqi:session:';
const audioPrefix='yueqi:audio:';
const savedAudio=new Set<string>();
/** Namespaced assets follow existing backup paths; audio is separate so clock checkpoints never rewrite megabytes of sound. */
export const storage={
 async list():Promise<Session[]> {const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction('assets','readonly').objectStore('assets').getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));r.onsuccess=()=>resolve(r.result.map(x=>x.data).sort((a,b)=>b.createdAt-a.createdAt));r.onerror=()=>reject(r.error);});},
 async save(s:Session){
  const clips=await Promise.all(s.clips.map(async c=>{if(!c.audio)return c;const audioKey=c.audioKey||audioPrefix+c.id;
   if(!savedAudio.has(audioKey)){await DB.saveAssetRaw(audioKey,c.audio);savedAudio.add(audioKey);}
   const {audio,...rest}=c;return {...rest,audioKey,audioBytes:Math.round(audio.length*.75)};
  }));
  const now=Date.now();await DB.saveAssetRaw(prefix+s.id,{...s,clips,checkpointAt:now,elapsedMs:elapsed(s,now),runningSince:s.runningSince?now:undefined});
 },
 async get(id:string):Promise<Session|null>{const s:Session|null=await DB.getAssetRaw(prefix+id);if(!s)return null;return {...s,clips:await Promise.all(s.clips.map(async c=>({...c,audio:c.audio||(c.audioKey?await DB.getAssetRaw(c.audioKey)||undefined:undefined)})))};},
 async remove(id:string){const s=await storage.get(id);if(s)for(const c of s.clips)if(c.audioKey){await DB.deleteAsset(c.audioKey);savedAudio.delete(c.audioKey);}await DB.deleteAsset(prefix+id);},
 async clearAudio(s:Session):Promise<Session>{for(const c of s.clips){const key=c.audioKey||audioPrefix+c.id;await DB.deleteAsset(key);savedAudio.delete(key);}const next={...s,clips:s.clips.map(({audio,audioKey,audioBytes,seconds,error,...c})=>c)};await storage.save(next);return next;},
};
export function blobData(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
