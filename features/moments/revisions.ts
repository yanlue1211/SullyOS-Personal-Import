import {activityCardText} from './cards';
import {getConfig,getRow,rows,transaction,refreshSnapshot,markSeen,enqueue,announceHistory,checkPost} from './storage';
import {result,type Post,type Seen,type Snapshot,type FeedEvent} from './schema';
import {postText,projectPost,areFriends} from './permissions';
export type RevisionInput=Pick<Post,'text'|'media'|'visibility'|'theme'>;
/** Ordinary deletion retains the original seen projection; only the public post is tombstoned. */
export async function reviseIn(s:IDBObjectStore,tx:IDBTransaction,actor:string,id:string,change:RevisionInput|null,reality=false,expected?:number){
 const c=await getConfig(s),p=await getRow<Post>(id,s);
 if(!c.enabled||!p||p.kind!=='post'||p.deletedAt)throw Error('动态已删除或朋友圈已关闭');
 if(actor!=='user'&&actor!==p.owner)throw Error('只能调整自己的动态');
 if(reality&&actor!=='user')throw Error('只有用户可以修订现实');
 if(expected!==undefined&&p.revision!==expected)throw Error('动态已变化，请重新打开编辑');
 if(change){checkPost(change);if(change.visibility.ids.some(x=>!areFriends(c,p.owner,x)||x===p.owner))throw Error("可见范围包含非好友");}
 const next:Post=change?{...p,...change,text:change.text.trim(),revision:p.revision+1,editedAt:Date.now()}:{...p,revision:p.revision+1,deletedAt:Date.now()};
 if(reality&&!change)s.delete(id);else s.put(next);
 // Invalidate in-flight model requests and cached chat queries atomically.
 c.revision++;s.put(c);
 for(const event of await rows<FeedEvent>('event',undefined,Number.MAX_SAFE_INTEGER,Infinity,s))if(event.postId===id)s.delete(event.id);
 const seen=await rows<Seen>('seen',undefined,Number.MAX_SAFE_INTEGER,Infinity,s);
 if(reality){
  for(const record of seen.filter(x=>x.postId===id)){
   if(!change||!projectPost(c,record.owner,next))s.delete(record.id);
   else s.put({...record,projection:projectPost(c,record.owner,{...next,comments:record.projection.comments}),reaction:''});
  }
  const messages=tx.objectStore('messages');
  const request=messages.openCursor();
  await new Promise<void>((resolve,reject)=>{request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cur=request.result;if(!cur){resolve();return;}const m=cur.value;if(Array.isArray(m.metadata?.momentsActivityParts)&&m.metadata.momentsActivityParts.some((part:any)=>part.postId===id)){const parts=m.metadata.momentsActivityParts.flatMap((part:any)=>part.postId!==id?[part]:change&&projectPost(c,m.charId,next)?[{postId:id,text:`[用户修订后的朋友圈]\n${postText(projectPost(c,m.charId,next)!)}\n动态ID：${id}`}]:[]);if(!parts.length)cur.delete();else cur.update({...m,content:activityCardText(parts,m.metadata.momentsActivityAt),metadata:{...m.metadata,momentsActivityParts:parts,momentsPostIds:parts.map((p:any)=>p.postId),momentsPostId:parts.length===1?parts[0].postId:undefined}});}else if(m.metadata?.momentsPostId===id){if(!change||!projectPost(c,m.charId,next))cur.delete();else cur.update({...m,content:`[私人朋友圈]\n${postText(next)}\n动态ID：${id}`});}cur.continue();};});

 }
 if(change&&!reality)await enqueue(s,c,next,'post');
 if(actor!=="user"){await markSeen(s,c,actor,change?next:p);await refreshSnapshot(s,c,actor);}
 for(const snap of await rows<Snapshot>('snapshot',undefined,10000,Infinity,s))await refreshSnapshot(s,c,snap.owner);
 return next;
}
export async function revisePost(actor:string,id:string,change:RevisionInput|null,reality=false,expected?:number){
 const next=await transaction((s,tx)=>reviseIn(s,tx,actor,id,change,reality,expected),true);
 const config=await getConfig();for(const owner of Object.keys(config.participants))announceHistory(owner);return next;
}
