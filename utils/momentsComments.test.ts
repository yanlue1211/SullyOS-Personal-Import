import {beforeEach,it,expect} from 'vitest';
import {DB,openDB} from './db';
import {saveConfig,publish,interact,getRow,getConfig,transaction,markSeen,refreshSnapshot,rows,feedPage} from '../features/moments/storage';
import {participantDefaults,type Post,type Seen,type Snapshot,type FeedEvent} from '../features/moments/schema';
import {reviseComment} from '../features/moments/comments';
import {saveActivityCard} from '../features/moments/cards';
import {exportMoments,validateMomentsBackup} from '../features/moments/backup';
let p:Post,id:string,reply:string;
beforeEach(async()=>{
 await DB.deleteDB();localStorage.clear();for(const who of ['a','b','c'])await DB.saveCharacter({id:who,name:who,memories:[{id:'keep',summary:'长期记忆保持原样'}]} as any);
 await saveConfig(c=>{c.enabled=true;for(const who of ['a','b','c'])c.participants[who]={...participantDefaults(),enabled:true};c.friends=[['a','b'],['a','c'],['b','c']];});
 p=await publish('a','a',{text:'周末晒太阳',theme:'日常',media:[],visibility:{mode:'all',ids:[]}});
 await interact('b','b',p.id,{kind:'comment',text:'旧评论正文'});p=(await getRow<Post>(p.id))!;id=p.comments[0].id;
 await interact('a','a',p.id,{kind:'comment',text:'回复旧评论',replyTo:id});p=(await getRow<Post>(p.id))!;reply=p.comments[1].id;
 await transaction(async(s,tx)=>{const c=await getConfig(s);await markSeen(s,c,'a',p);await refreshSnapshot(s,c,'a');await saveActivityCard(tx,c,'a','first',[{post:p,events:['实际读到评论；本轮回复了']}]);},true);
});
it('ordinary char deletion hides the thread but preserves earlier viewers and cards',async()=>{
 await reviseComment('b',p.id,id,null);
 expect((await feedPage('c')).posts[0].comments).toEqual([]);expect((await feedPage('user')).posts[0].comments).toEqual([]);
 expect((await getRow<Snapshot>('snapshot:a'))?.text).toContain('旧评论正文');expect((await DB.getMessagesByCharId('a'))[0].content).toContain('回复旧评论');
 expect((await getRow<Post>(p.id))?.comments[0].deletedAt).toBeTruthy();validateMomentsBackup(await exportMoments(await openDB()));
});
it('only user may rewrite or really delete; updates known cards and snapshots without adding unseen comments',async()=>{
 await expect(reviseComment('b',p.id,id,'越权修改',true)).rejects.toThrow();await expect(reviseComment('a',p.id,id,null)).rejects.toThrow();
 await interact('c','c',p.id,{kind:'comment',text:'后来未浏览的秘密'});
 await reviseComment('user',p.id,id,'用户修改后的评论',true);
 const card=(await DB.getMessagesByCharId('a'))[0];expect(card.content).toContain('用户修改后的评论');expect(card.content).not.toContain('旧评论正文');expect(card.content).not.toContain('后来未浏览的秘密');expect((await getRow<Snapshot>('snapshot:a'))?.text).toContain('用户修改后的评论');
 await reviseComment('user',p.id,id,null,true);
 expect((await getRow<Post>(p.id))!.comments.map(x=>x.id)).not.toContain(reply);expect((await getRow<Seen>('seen:a:'+p.id))!.projection.comments).toEqual([]);
 expect((await DB.getMessagesByCharId('a'))[0].content).not.toContain('用户修改后的评论');expect((await DB.getCharacter('a'))!.memories[0].summary).toBe('长期记忆保持原样');
});
it('likes enqueue activity opportunities but do not immediately teach the author new facts',async()=>{
 await interact('user','用户',p.id,{kind:'like'});
 expect((await rows<FeedEvent>('event','a',100)).some(x=>x.eventType==='like')).toBe(true);
 expect((await getRow<Snapshot>('snapshot:a'))?.text).not.toContain('已看到的点赞：用户');
 await transaction(async s=>{const c=await getConfig(s);await markSeen(s,c,'a',(await getRow<Post>(p.id,s))!,'本轮未新增评论或回复');await refreshSnapshot(s,c,'a');},true);
 expect((await getRow<Snapshot>('snapshot:a'))?.text).toContain('已看到的点赞：用户');
});

it('rewrites legacy text-only cards as well as new structured cards',async()=>{
 const legacy=await DB.saveMessage({charId:'a',role:'system',type:'moments_card',content:'[私人朋友圈重要事件]\n读到交流\na：周末晒太阳\nb：旧评论正文\na：回复旧评论\n动态ID：'+p.id,metadata:{source:'moments',momentsPostId:p.id}} as any);
 await reviseComment('user',p.id,id,'修正后的旧卡片正文',true);
 expect((await DB.getMessageById(legacy))!.content).toContain('修正后的旧卡片正文');
 await reviseComment('user',p.id,id,null,true);
 expect((await DB.getMessageById(legacy))!.content).not.toContain('修正后的旧卡片正文');expect((await DB.getMessageById(legacy))!.content).not.toContain('回复旧评论');
});

it('editing an older timestamped text-only card does not apply the same replacement twice',async()=>{
 const card=(await DB.getMessagesByCharId('a'))[0];await DB.updateMessageMetadata(card.id,meta=>({...meta,momentsActivityParts:meta.momentsActivityParts.map(({post,events,...part}:any)=>part)}));
 await reviseComment('user',p.id,id,'旧评论正文，补充',true);
 const text=(await DB.getMessageById(card.id))!.content;expect(text).toContain('旧评论正文，补充');expect(text).not.toContain('，补充，补充');
});
