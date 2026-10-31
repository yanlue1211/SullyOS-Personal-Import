import {loadCharacterContextMessageIds,resolveContextRangeMode,clampManualContextLimit,computeContextRangeSnapshot} from '../../utils/chatContextRange';
import {DB,openDB} from '../../utils/db';
import type {CharacterProfile,Message} from '../../types';
import {getReliableMemoryPalaceHighWaterMark,getLocalMemoryPalaceHighWaterMark} from '../../utils/memoryPalace/highWaterMark';
import {getBlobForRef,isBlobRef} from '../../utils/blobRef';
import {collectBlobRefs} from '../../utils/backupBlobs';
import {REF_SOURCE_STORES} from '../../utils/blobGc';
import {WORKROOM_STORES,idbResult,transactionDone} from '../workroom/schema';
import {tryAcquireMaintenanceLock,currentMaintenanceHolder,releaseMaintenanceLock} from '../../utils/maintenanceLock';
import {readRealMedia} from './format';
export interface ArchivedMediaCandidate {id:number;charId:string;kind:'image'|'video';signature:string;refs:string[];inlineBytes:number}
export interface ArchivedMediaPreview {rows:ArchivedMediaCandidate[];bytes:number;images:number;videos:number;characters:number}
// Strictly below the hidden-original boundary AND no newer than the successful memory waterline.
export function isArchivedMediaMessage(m:Message,char:CharacterProfile|undefined,hwm:number):boolean{return !!char&&!m.groupId&&Number.isFinite(hwm)&&hwm>0&&m.id<=hwm&&m.id<(char.hideBeforeMessageId||0)&&!m.metadata?.mediaCleared;}
function archivedStory(m:Message,entry:any):boolean{return !m.groupId&&m.metadata?.source==='story_theater'&&m.metadata?.theaterArchived===true&&!m.metadata?.mediaCleared&&m.metadata?.theaterId===entry?.id&&Array.isArray(entry?.archives)&&entry.archives.some((a:any)=>Number.isFinite(a.fromMessageId)&&Number.isFinite(a.toMessageId)&&m.id>=a.fromMessageId&&m.id<=a.toMessageId&&(a.strategy==='summary'?typeof a.summary==='string'&&!!a.summary.trim():a.strategy==='vector'));}
function signature(m:Message):string{const text=m.content+'\n'+JSON.stringify(m.metadata?.realMedia??null);let a=2166136261,b=2654435761;for(let i=0;i<text.length;i++){const n=text.charCodeAt(i);a=Math.imul(a^n,16777619);b=Math.imul(b^n,2246822519);}return `${text.length}:${a>>>0}:${b>>>0}`;}
function candidate(m:Message):ArchivedMediaCandidate|undefined{
 const media=readRealMedia(m.metadata?.realMedia);if(!media&&m.type!=='image')return;if(!media&&!m.content)return;
 const refs=new Set<string>();if(media){for(const ref of [media.originalRef,...media.frames.map(f=>f.image)])if(isBlobRef(ref))refs.add(ref);}else if(isBlobRef(m.content))refs.add(m.content);
 const inlineBytes=!media&&m.content.startsWith('data:image/')?Math.ceil(m.content.length*.75):0;
 return {id:m.id,charId:m.charId,kind:media?.kind||'image',signature:signature(m),refs:[...refs],inlineBytes};
}
export async function scanArchivedMedia(charId?:string):Promise<ArchivedMediaPreview>{
 const chars=(await DB.getAllCharacters()).filter(c=>!charId||c.id===charId),owners=new Map(chars.map(c=>[c.id,c])),water=new Map<string,number>();
 for(const char of chars)water.set(char.id,await getReliableMemoryPalaceHighWaterMark(char.id));
 const stories=new Map((await DB.getStoryTheaters()).map(e=>['story-theater:'+e.id,e]));
 const rows:ArchivedMediaCandidate[]=[];let after:IDBValidKey|null=null;
 for(;;){const page=await DB.getStoreRowsPage('messages',after,100);for(const m of page.rows as Message[])if((!charId||m.charId===charId)&&(isArchivedMediaMessage(m,owners.get(m.charId),water.get(m.charId)||0)||archivedStory(m,stories.get(m.charId)))){const value=candidate(m);if(value)rows.push(value);}if(page.lastKey===null||page.rows.length<100)break;after=page.lastKey;}
 for(const char of chars){const protectedIds=await loadCharacterContextMessageIds(char,rows.filter(r=>r.charId===char.id));for(let i=rows.length-1;i>=0;i--)if(rows[i].charId===char.id&&protectedIds.has(rows[i].id))rows.splice(i,1);}
 const refs=new Set(rows.flatMap(r=>r.refs));let bytes=rows.reduce((n,r)=>n+r.inlineBytes,0);for(const ref of refs)bytes+=(await getBlobForRef(ref))?.size||0;
 return {rows,bytes,images:rows.filter(r=>r.kind==='image').length,videos:rows.filter(r=>r.kind==='video').length,characters:new Set(rows.map(r=>r.charId)).size};
}
/** One DB transaction covers detach, complete reference scan and deletion, so failures roll back together. */
export async function clearArchivedMedia(preview:ArchivedMediaPreview):Promise<{cleared:number;freedBytes:number;retainedFiles:number;skipped:number}>{
 if(!tryAcquireMaintenanceLock('归档图片与视频清理'))throw Error(`请等待「${currentMaintenanceHolder()}」完成`);
 try{
 const db=await openDB(),names=[...new Set<string>([...REF_SOURCE_STORES,...WORKROOM_STORES,'story_theaters','blob_assets'])];
 for(const name of names)if(!db.objectStoreNames.contains(name))throw Error('引用范围读取不完整，未清理任何附件');
 const tx=db.transaction(names,'readwrite'),done=transactionDone(tx);void done.catch(()=>{});
 const clearedIds:number[]=[];let cleared=0,freedBytes=0,retainedFiles=0,skipped=0;
 try{
 const refs=new Set<string>(),owners=new Map<string,CharacterProfile>(),water=new Map<string,number>();
 for(const id of new Set(preview.rows.map(r=>r.charId))){const char=await idbResult<CharacterProfile|undefined>(tx.objectStore('characters').get(id));if(char)owners.set(id,char);const row=await idbResult<any>(tx.objectStore('assets').get('mp_hwm_v1_'+id));const hwm=typeof row?.data==='number'?row.data:row?.data?.msgId;water.set(id,Math.max(getLocalMemoryPalaceHighWaterMark(id),Number(hwm)||0));}
 const protectedMessages=new Set<number>();
 for(const char of owners.values())if(resolveContextRangeMode(char)==='manual'){const refs:Message[]=[];await new Promise<void>((resolve,reject)=>{const request=tx.objectStore('messages').index('charId').openCursor(IDBKeyRange.only(char.id),'prev');request.onsuccess=()=>{const cursor=request.result;if(!cursor||refs.length>=clampManualContextLimit(char.contextLimit)){resolve();return;}const row=cursor.value;if(!row.groupId)refs.push({id:row.id,timestamp:row.timestamp} as Message);cursor.continue();};request.onerror=()=>reject(request.error);});computeContextRangeSnapshot(refs,char,water.get(char.id)||0).messages.forEach(m=>protectedMessages.add(m.id));}
 for(const planned of new Map(preview.rows.map(r=>[r.id,r])).values()){
  const m=await idbResult<Message|undefined>(tx.objectStore('messages').get(planned.id));
  const story=m?.metadata?.source==='story_theater'?await idbResult<any>(tx.objectStore('story_theaters').get(m.metadata.theaterId)):undefined;
  if(!m||protectedMessages.has(m.id)||m.charId!==planned.charId||!(isArchivedMediaMessage(m,owners.get(m.charId),water.get(m.charId)||0)||archivedStory(m,story))||signature(m)!==planned.signature){skipped++;continue;}
  const current=candidate(m);if(!current){skipped++;continue;}current.refs.forEach(r=>refs.add(r));
  const metadata={...m.metadata,mediaCleared:{kind:current.kind,at:Date.now()}};delete metadata.realMedia;
  const description=typeof metadata.visionDescription==='string'?metadata.visionDescription.trim():'';
  const content=current.kind==='video'?m.content+'\n【原视频与截帧已清理】':(readRealMedia(m.metadata?.realMedia)?m.content:'【历史图片】')+'\n【原图已清理】';
  await idbResult(tx.objectStore('messages').put({...m,type:'text',content:content+(description?'\n保留的画面描述：'+description:''),metadata}));cleared++;clearedIds.push(m.id);freedBytes+=current.inlineBytes;
 }
 const protectedRefs=new Set<string>();
 const inspect=(text:string)=>{const found=new Set<string>();collectBlobRefs(text,found);for(const ref of found)if(refs.has(ref))protectedRefs.add(ref);};
 for(const name of names.filter(n=>n!=='blob_assets'))await new Promise<void>((resolve,reject)=>{const request=tx.objectStore(name).openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve();return;}try{inspect(JSON.stringify(cursor.value)||'');cursor.continue();}catch(e){reject(e);}};request.onerror=()=>reject(request.error);});
 for(let i=0;i<localStorage.length;i++)inspect(localStorage.getItem(localStorage.key(i)!)||'');
 for(const ref of refs){if(protectedRefs.has(ref)){retainedFiles++;continue;}const id=ref.slice('blobref:'.length),record=await idbResult<any>(tx.objectStore('blob_assets').get(id));if(record?.blob){await idbResult(tx.objectStore('blob_assets').delete(id));freedBytes+=record.blob.size;}}
 await done;
 }catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('archived-media-cleaned',{detail:{ids:clearedIds}}));
 return {cleared,freedBytes,retainedFiles,skipped};
 }finally{releaseMaintenanceLock();}
}
