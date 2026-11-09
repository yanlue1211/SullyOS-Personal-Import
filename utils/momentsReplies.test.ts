import {expect,it} from 'vitest';
import {assertReplyRecipient} from '../features/moments/replies';
import {activityPrompt} from '../features/moments/runtime';
import {participantDefaults} from '../features/moments/schema';
import type {Post} from '../features/moments/schema';
const post={owner:'ding',name:'丁程鑫',comments:[{id:'ma-comment',authorId:'ma',name:'马嘉祺',text:'上手就知道',at:1},{id:'he-comment',authorId:'he',name:'贺峻霖',text:'加一点水',at:2}]} as Post;
it('rejects the screenshot case without guessing a new reply location',()=>{
 expect(()=>assertReplyRecipient(post,{replyTo:'ma-comment',text:'丁哥我连面粉在厨房哪个柜子都不知道'})).toThrow('称呼');
});
it('requires recipient identity to match the referenced comment',()=>{
 expect(()=>assertReplyRecipient(post,{replyTo:'ma-comment',recipientId:'ding',text:'我还没找到面粉'})).toThrow('ID');
 expect(()=>assertReplyRecipient(post,{recipientId:'ma',text:'我还没找到面粉'})).toThrow('ID');
});
it('allows addressing the author directly without referencing any comment',()=>{
 expect(()=>assertReplyRecipient(post,{replyTo:null,recipientId:'ding',text:'丁哥我连面粉放哪儿都不知道'})).not.toThrow();
});
it('preserves third-party replies and does not mistake a later mention or quotation for the recipient',()=>{
 expect(()=>assertReplyRecipient(post,{replyTo:'ma-comment',recipientId:'ma',text:'马哥我试了一次，好像太稠了'})).not.toThrow();
 expect(()=>assertReplyRecipient(post,{replyTo:'ma-comment',recipientId:'ma',text:'刚才丁哥也说让我直接上手试试'})).not.toThrow();
 expect(()=>assertReplyRecipient(post,{recipientId:'ding',text:'马哥说得对，先试一次就知道比例了'})).not.toThrow();
});
it('does not invent a recipient for ambiguous or unknown opening names',()=>{
 expect(()=>assertReplyRecipient(post,{replyTo:'he-comment',recipientId:'he',text:'朋友我觉得你说的有道理'})).not.toThrow();
 expect(()=>assertReplyRecipient(post,{replyTo:'missing',text:'随便说点'})).toThrow('可见');
});
it('same-person single-character accounts keep their established alias grouping',()=>{
 const p={...post,owner:'zhang',name:'张真源',comments:[{id:'variant',authorId:'yuan',name:'源',at:1,text:'你好'}]} as Post;
 expect(()=>assertReplyRecipient(p,{replyTo:'variant',recipientId:'yuan',text:'源源我找到那首歌了'})).not.toThrow();
});

it('does not require an opening name or nickname on every natural reply',()=>{
 const p=post;
 expect(()=>assertReplyRecipient(p,{replyTo:'ma-comment',recipientId:'ma',text:'哈哈哈那我现在就试试！'})).not.toThrow();
 expect(()=>assertReplyRecipient(p,{replyTo:'ma-comment',recipientId:'ma',text:'这么一说我也想试试了'})).not.toThrow();
 const prompt=activityPrompt({
   call:{id:'demo'},participant:participantDefaults(),canPost:false,
   posts:[],history:[],events:[],browseOpportunity:true,review:{},
 } as any);
 expect(prompt).toContain('无需在每次回复开头叫对方名字');
 expect(prompt).toContain('回复对象由replyTo和recipientId确定');
 expect(prompt).not.toContain('正文开头称呼必须与直接对话对象一致');
 // Explicit wrong name references still cannot redirect a reply.
 expect(()=>assertReplyRecipient(p,{replyTo:'ma-comment',recipientId:'ma',text:'丁哥我现在就试试'})).toThrow('称呼');
});
