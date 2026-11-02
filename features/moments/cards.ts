import {projectPost,postText} from './permissions';
import {result,type Config,type Post} from './schema';
export interface ActivityCardPart {postId:string;text:string}
export const activityCardText=(parts:ActivityCardPart[],at:string)=>`[私人朋友圈活动记录 · ${at}]\n【经历记录，不是聊天台词；按原有规则判断是否值得记忆，不额外提高重要性。】\n`+parts.map(p=>p.text).join('\n\n');
export async function saveActivityCard(tx:IDBTransaction,c:Config,owner:string,eventId:string,entries:{post:Post;events:string[]}[]):Promise<boolean>{
 if(!entries.length)return false;
 const messages=tx.objectStore('messages'),deliveryId=`moments:${owner}:activity:${eventId}`;
 if(await result(messages.index('charId_deliveryId').get([owner,deliveryId])))return false;
 const parts:ActivityCardPart[]=entries.flatMap(entry=>{
  const view=projectPost(c,owner,entry.post);if(!view)return [];
  const comments=view.comments.map(x=>{const parent=x.replyTo&&view.comments.find(y=>y.id===x.replyTo);return `[${new Date(x.at).toISOString()}] ${x.name}${parent?' 回复 '+parent.name:''}：${x.text}`;}).join('\n');
  return [{postId:view.id,text:`${entry.events.join('；')}\n[发布于 ${new Date(view.at).toISOString()}] ${postText(view)}\n${comments}\n动态ID：${view.id}`}];
 });
 if(!parts.length)return false;
 const at=new Date().toISOString();messages.add({charId:owner,role:'system',type:'moments_card',timestamp:Date.now(),content:activityCardText(parts,at),metadata:{source:'moments',deliveryId,momentsPostIds:parts.map(p=>p.postId),momentsActivityParts:parts,momentsActivityAt:at,...(parts.length===1?{momentsPostId:parts[0].postId}:{})}});return true;
}
