import type {Post} from './schema';
import {resolveMomentsNames} from './names';
/** Validate an LLM's routing decision; never silently move a comment to a guessed recipient. */
export function assertReplyRecipient(post:Post,action:{text?:string;replyTo?:string|null;recipientId?:string}){
 const parent=action.replyTo?post.comments.find(c=>c.id===action.replyTo&&!c.deletedAt):undefined;
 if(action.replyTo&&!parent)throw Error('回复对象不在当前可见评论中');
 const target=parent?.authorId||post.owner;
 if(action.recipientId!==undefined&&(typeof action.recipientId!=='string'||action.recipientId!==target))throw Error('回复人物与评论ID不一致，本轮未执行');
 // Only a clear opening address is evidence. A name mentioned later, a quote, or an ambiguous alias is not.
 const address=action.text?.trim().match(/^([\p{Script=Han}]{1,5}|[A-Za-z][A-Za-z0-9_-]{1,20})[，,：:\s]*(?=[我你您咱]|[，,：:\s])/u)?.[1];
 if(!address)return;
 const people=[{id:post.owner,name:post.name},...post.comments.map(c=>({id:c.authorId,name:c.name}))].filter((p,i,all)=>all.findIndex(x=>x.id===p.id)===i);
 const exactAddress=people.some(p=>p.name===address||(p.name.length>=3&&p.name.slice(1)===address))||/^(?:[小老阿]\p{Script=Han}|\p{Script=Han}(?:哥哥?|姐姐?|老师|总)|(\p{Script=Han})\1)$/u.test(address);
 if(!exactAddress)return;
 const addressed=resolveMomentsNames(address,people);
 if(addressed.length&&!addressed.some(p=>p.id===target))throw Error('正文开头的称呼与回复人物不一致，本轮未执行');
}
