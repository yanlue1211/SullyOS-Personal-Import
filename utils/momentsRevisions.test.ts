import {beforeEach,it,expect} from 'vitest';
import {DB,openDB} from './db';
import {participantDefaults,type Post,type Seen,type Snapshot,type Correction} from '../features/moments/schema';
import {getConfig,getRow,saveConfig,publish,transaction,markSeen,refreshSnapshot,feedPage,rows,addCard} from '../features/moments/storage';
import {revisePost} from '../features/moments/revisions';
import {prepareMomentsQuery,chatMomentsContext} from '../features/moments/bridge';
import {exportMoments,validateMomentsBackup} from '../features/moments/backup';
let post:Post;
beforeEach(async()=>{await DB.deleteDB();for(const id of ['a','b','c'])await DB.saveCharacter({id,name:id,memories:[]} as any);await DB.saveUserProfile({name:'用户'} as any);await saveConfig(c=>{c.enabled=true;for(const id of ['a','b','c'])c.participants[id]={...participantDefaults(),enabled:true};c.friends=[['a','b'],['a','c']];});post=await publish('a','a',{text:'今天心情低落，暂时不想说话。',media:[],visibility:{mode:'all',ids:[]},theme:'心情'});await transaction(async(s,tx)=>{const c=await getConfig(s);await markSeen(s,c,'b',post);await refreshSnapshot(s,c,'b');await addCard(s,tx,c,'b',post,'看到好友心情低落','first');},true);});
it('ordinary deletion hides the feed from everyone while preserving only actual viewers knowledge',async()=>{
 await revisePost('a',post.id,null);
 expect((await feedPage()).posts).toEqual([]);expect((await feedPage('b')).posts).toEqual([]);
 expect((await getRow<Snapshot>('snapshot:b'))?.text).toContain('暂时不想说话');
 expect(await getRow<Seen>('seen:c:'+post.id)).toBeUndefined();
 await prepareMomentsQuery('b',[{id:2,role:'user',type:'text',content:'a的朋友圈说了什么？'} as any]);
 expect((await chatMomentsContext('b',2)).dynamic).toContain('暂时不想说话');
 await prepareMomentsQuery('c',[{id:3,role:'user',type:'text',content:'去看看a的朋友圈'} as any]);
 expect((await chatMomentsContext('c',3)).dynamic).not.toContain('暂时不想说话');
 expect(validateMomentsBackup(await exportMoments(await openDB())).length).toBeGreaterThan(0);
});
it('user reality deletion revokes seen, cards, source memories and embeddings, retaining unrelated memories',async()=>{
 const char=await DB.getCharacter('b');
 await transaction(async(_s,tx)=>{tx.objectStore('memory_nodes').put({id:'linked',charId:'b',content:'我听说好友心情很差',sourcePostIds:[post.id]});tx.objectStore('memory_nodes').put({id:'other',charId:'b',content:'我喜欢海边'});tx.objectStore('memory_vectors').put({memoryId:'linked',charId:'b',vector:[]});tx.objectStore('characters').put({...char,memories:[{id:'m',summary:'旧朋友圈记忆',palaceMemoryId:'linked'},{id:'keep',summary:'无关记忆'}]});},true,true);
 await revisePost('user',post.id,null,true);
 expect(await getRow(post.id)).toBeUndefined();expect(await getRow<Seen>('seen:b:'+post.id)).toBeUndefined();
 expect((await DB.getMessagesByCharId('b')).filter(m=>m.metadata?.momentsPostId===post.id)).toEqual([]);
 expect((await DB.getCharacter('b'))?.memories.map(m=>m.id)).toEqual(['keep']);
 expect((await chatMomentsContext('b')).dynamic).toContain('从未发布');
 expect((await chatMomentsContext('c')).dynamic).not.toContain('从未发布');
 expect(validateMomentsBackup(await exportMoments(await openDB())).some(r=>r.kind==='correction')).toBe(true);
});
it('normal character edits leave old viewers unchanged until reading again; user edits rewrite actual viewers immediately',async()=>{
 const changed={...post,text:'已经平静了，出门吃饭。'};
 await revisePost('a',post.id,changed,false,post.revision);
 expect((await getRow<Seen>('seen:b:'+post.id))?.projection.text).toBe(post.text);
 const current=(await getRow<Post>(post.id))!;
 await revisePost('user',post.id,{...current,text:'今天去看了一场电影。'},true,current.revision);
 expect((await getRow<Seen>('seen:b:'+post.id))?.projection.text).toBe('今天去看了一场电影。');
 expect((await getRow<Snapshot>('snapshot:b'))?.text).not.toContain('暂时不想说话');
 expect(await getRow<Seen>('seen:c:'+post.id)).toBeUndefined();
});
it('rejects management of other characters and stale edit versions',async()=>{
 await expect(revisePost('b',post.id,null)).rejects.toThrow('自己');
 await expect(revisePost('user',post.id,{...post,text:'改'},true,post.revision+1)).rejects.toThrow('变化');
 expect((await getRow<Post>(post.id))?.text).toBe(post.text);
});
