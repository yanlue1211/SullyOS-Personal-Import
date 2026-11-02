import {repairMomentMemories} from './memoryRevision';
import {bm25Index} from '../../utils/memoryPalace/bm25Index';
import {notifyMemoryNodesChanged} from '../../utils/memoryPalace/nodeChanges';
import {getConfig,getRow,rows,transaction,refreshSnapshot,markSeen,enqueue,announceHistory,checkPost} from './storage';
import {result,type Post,type Seen,type Snapshot,type FeedEvent,type Row} from './schema';
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
  await repairMomentMemories(tx,p,change?next:null,c);
  const affected=new Set([p.owner,...seen.filter(x=>x.postId===id).map(x=>x.owner)]);
  for(const record of seen.filter(x=>x.postId===id)){
   if(!change||!projectPost(c,record.owner,next))s.delete(record.id);
   else s.put({...record,projection:projectPost(c,record.owner,{...next,comments:record.projection.comments}),reaction:''});
  }
  const messages=tx.objectStore('messages');
  const request=messages.openCursor();
  await new Promise<void>((resolve,reject)=>{request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cur=request.result;if(!cur){resolve();return;}const m=cur.value;if(m.metadata?.momentsPostId===id){affected.add(m.charId);if(!change||!projectPost(c,m.charId,next))cur.delete();else cur.update({...m,content:`[私人朋友圈]\n${postText(next)}\n动态ID：${id}`});}cur.continue();};});
  for(const owner of affected){
   // A persisted authority correction also supersedes summaries that predate source tracking.
   s.put({id:`correction:${owner}:${id}`,kind:'correction',owner,at:Date.now(),postId:id,text:change&&projectPost(c,owner,next)?`现实校正：${p.name}于${new Date(p.at).toISOString()}的朋友圈唯一有效版本为：${postText(next)}。旧版本及由其推导的经历、判断与记忆作废；不记得发生过修改。`:`现实校正：${p.name}于${new Date(p.at).toISOString()}的朋友圈（ID ${id}）从未发布。与该动态有关的见闻、互动和记忆均不构成发生过的事实，不记得发生过删除。`} as Row);
  }
 }
 if(change&&!reality)await enqueue(s,c,next,'post');
 if(actor!=="user"){await markSeen(s,c,actor,change?next:p);await refreshSnapshot(s,c,actor);}
 for(const snap of await rows<Snapshot>('snapshot',undefined,10000,Infinity,s))await refreshSnapshot(s,c,snap.owner);
 return next;
}
export async function revisePost(actor:string,id:string,change:RevisionInput|null,reality=false,expected?:number){
 const next=await transaction((s,tx)=>reviseIn(s,tx,actor,id,change,reality,expected),true,reality);
 if(reality){bm25Index.dropAll();notifyMemoryNodesChanged();if(typeof window!=="undefined")window.dispatchEvent(new Event("moments-reality-updated"));}
 const config=await getConfig();for(const owner of Object.keys(config.participants))announceHistory(owner);return next;
}
