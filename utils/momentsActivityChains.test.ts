import { expect, it } from 'vitest';
import { activityCommentChain, renderActivityPart } from '../features/moments/cards';
import { projectPost } from '../features/moments/permissions';
import { participantDefaults, type Post } from '../features/moments/schema';
const comment=(id:string,author:string,replyTo?:string)=>({id,authorId:author,name:author,text:`comment-${id}`,at:1,replyTo});
const post={id:'p',kind:'post',owner:'A',name:'A',at:1,text:'original-post',theme:'',visibility:{mode:'all',ids:[]},media:[],likes:[{authorId:'B',name:'B'}],revision:1,comments:[comment('b','B'),comment('c','C'),comment('d','D'),comment('e','E'),comment('ab','A','b'),comment('ac','A','c'),comment('ad','A','d'),comment('ae','A','e'),comment('f','F','ae')]} as Post;
it('keeps only original → E → A-to-E → F-to-A in both text and structured metadata',()=>{
 const part=renderActivityPart(post,['本轮回复'],['f']);
 expect(part.post?.comments.map(c=>c.id)).toEqual(['e','ae','f']);
 expect(part.post?.likes).toEqual([]);expect(part.text).toContain('original-post');
 for(const c of post.comments)expect(part.text.includes(c.text+'\n')).toBe(['e','ae','f'].includes(c.id));
 expect(post.comments).toHaveLength(9);expect(post.likes).toHaveLength(1);
});
it('merges multiple chains, emits shared ancestors and original post only once',()=>{
 const p={...post,comments:[...post.comments,comment('f2','F','ae'),comment('f3','F','ad')]};
 const part=renderActivityPart(p,[],['f','f2','f3']);
 expect(part.post?.comments.map(c=>c.id)).toEqual(['e','ae','f','f2','d','ad','f3']);
 expect(part.text.split('original-post')).toHaveLength(2);
});
it('publishing needs no comments; a root comment needs no other replies',()=>{
 expect(renderActivityPart(post,['发布'],[]).post?.comments).toEqual([]);
 expect(renderActivityPart(post,[],['e']).post?.comments.map(c=>c.id)).toEqual(['e']);
});
it('permissions are applied before ancestry selection so hidden parents are never recovered',()=>{
 const participants=Object.fromEntries(['A','B','C','D','E','F'].map(x=>[x,{...participantDefaults(),enabled:true}]));
 const c={enabled:true,participants,friends:[['F','A']]} as any;
 const view=projectPost(c,'F',post)!;
 expect(renderActivityPart(view,[],['f']).post?.comments).toEqual([]);
});
it('handles broken/cyclic references without looping or adding unrelated branches',()=>{
 expect(activityCommentChain({...post,comments:[comment('x','A','y'),comment('y','E','x')]},['x']).map(c=>c.id)).toHaveLength(2);
 expect(activityCommentChain(post,['missing'])).toEqual([]);
});
it('legacy parts keep their original render contract for explicit historical edits',()=>{
 expect(renderActivityPart(post,[]).post?.comments).toHaveLength(post.comments.length);
 expect(renderActivityPart(post,[])).not.toHaveProperty('commentIds');
});

it('an older comment by the same actor does not join the selected reply chain',()=>{
 const view={...post,comments:[comment('older-own','F'),...post.comments]};
 expect(renderActivityPart(view,[],['f']).post?.comments.map(x=>x.id)).toEqual(['e','ae','f']);
});
