import {getConfig,getRow,rows,transaction,refreshSnapshot,announceHistory} from './storage';
import {projectPost} from './permissions';
import {activityCardText,renderActivityPart,type ActivityCardPart} from './cards';
import {result,type Post,type Seen,type Snapshot,type FeedEvent} from './schema';
/** Ordinary deletion is a tombstone. Only user edits/real deletions rewrite learned projections. */
export async function reviseCommentIn(s:IDBObjectStore,tx:IDBTransaction,actor:string,postId:string,id:string,text:string|null,reality=false,expected?:number){
 const c=await getConfig(s),p=await getRow<Post>(postId,s);
 if(!p||p.deletedAt||!c.enabled||(actor!=='user'&&!projectPost(c,actor,p)))throw Error('无权查看这条动态');
 if(expected!==undefined&&p.revision!==expected)throw Error('评论已变化，请重新打开');
 const target=p.comments.find(x=>x.id===id&&!x.deletedAt);if(!target)throw Error('评论已删除');
 if(actor==='user'){if(!reality)throw Error('用户请使用真实删除或修改');}
 else if(reality||text!==null||target.authorId!==actor)throw Error('角色只能普通删除自己的评论');
 const old=structuredClone(p),removed=new Set([id]);
 if(text===null){let expand=true;while(expand){expand=false;for(const x of p.comments)if(x.replyTo&&removed.has(x.replyTo)&&!removed.has(x.id)){removed.add(x.id);expand=true;}}}
 if(text!==null){if(typeof text!=='string'||!text.trim()||text.length>2000)throw Error('评论不能为空或超过2000字');target.text=text.trim();target.editedAt=Date.now();}
 else if(reality)p.comments=p.comments.filter(x=>!removed.has(x.id));
 else for(const x of p.comments)if(removed.has(x.id))x.deletedAt=Date.now();
 p.revision++;s.put(p);c.revision++;s.put(c);
 if(text===null)for(const event of await rows<FeedEvent>('event',undefined,Number.MAX_SAFE_INTEGER,Infinity,s))if(event.postId===postId&&event.interactionId&&removed.has(event.interactionId))s.delete(event.id);
 const rewrite=(view:Post)=>({...view,comments:text===null?view.comments.filter(x=>!removed.has(x.id)):view.comments.map(x=>x.id===id?{...x,text:target.text,editedAt:target.editedAt}:x)});
 if(reality){
  for(const seen of await rows<Seen>('seen',undefined,Number.MAX_SAFE_INTEGER,Infinity,s))if(seen.postId===postId)s.put({...seen,projection:rewrite(seen.projection),reaction:seen.projection.comments.some(x=>removed.has(x.id))?'':seen.reaction});
  const replaceLegacy=(body:string)=>{let next=body;for(const comment of old.comments.filter(x=>removed.has(x.id))){const parent=comment.replyTo&&old.comments.find(x=>x.id===comment.replyTo);const label=comment.name+(parent?' 回复 '+parent.name:'');for(const prefix of [`[${new Date(comment.at).toISOString()}] ${label}：`,comment.name+'：']){const oldLine=prefix+comment.text;if(next.includes(oldLine))next=next.split(oldLine).join(text===null?'':prefix+target.text);}}return next;};
  const messages=tx.objectStore('messages'),cursor=messages.openCursor();
  await new Promise<void>((resolve,reject)=>{cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const row=cursor.result;if(!row){resolve();return;}const m=row.value,meta=m.metadata;
   if(Array.isArray(meta?.momentsActivityParts)&&meta.momentsActivityParts.some((part:ActivityCardPart)=>part.postId===postId)){
    const parts=meta.momentsActivityParts.map((part:ActivityCardPart)=>part.postId!==postId?part:part.post?(part.post.comments.some(x=>removed.has(x.id))?renderActivityPart(rewrite(part.post),['朋友圈经历（已按用户修订更新）']):part):{...part,text:replaceLegacy(part.text)===part.text?part.text:'朋友圈经历（已按用户修订更新）\n'+replaceLegacy(part.text).split('\n').slice(1).join('\n')});
    row.update({...m,content:activityCardText(parts,meta.momentsActivityAt),metadata:{...meta,momentsActivityParts:parts}});
   }else if(meta?.momentsPostId===postId){const revised=replaceLegacy(m.content);if(revised!==m.content)row.update({...m,content:'[私人朋友圈记录（已按用户修订更新）]\n'+revised.split('\n').slice(m.content.startsWith('[私人朋友圈重要事件')?2:1).join('\n')});}
   row.continue();};});
 }
 for(const snap of await rows<Snapshot>('snapshot',undefined,10000,Infinity,s))await refreshSnapshot(s,c,snap.owner);
 return p;
}
export async function reviseComment(actor:string,postId:string,id:string,text:string|null,reality=false,expected?:number){
 const p=await transaction((s,tx)=>reviseCommentIn(s,tx,actor,postId,id,text,reality,expected),true);
 const c=await getConfig();for(const owner of Object.keys(c.participants))announceHistory(owner);return p;
}
