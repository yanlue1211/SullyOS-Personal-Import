import { expect, it, vi } from 'vitest';
import { DB } from './db';
import { matchSongArchiveKeywords, buildSongArchiveKeywordBlock, setSongKeywordsEnabled } from '../features/personal/songArchive/keywords';
const rows = [
 {songId:1,songName:'说谎',artists:'张真源',description:'低音与弦乐',updatedAt:1,isTrial:false},
 {songId:2,songName:'心桥',artists:'张真源 / 宋亚轩',description:'双人演唱',updatedAt:1,isTrial:false},
 {songId:3,songName:'Hello',artists:'Troye Sivan',description:'声音细节',updatedAt:1,isTrial:true},
];
it('full artist name injects only names; nickname does not trigger; song title adds saved details',()=>{
 expect(matchSongArchiveKeywords('真源呀',rows)).toBe('');
 const singer=matchSongArchiveKeywords('张真源有什么歌',rows);
 expect(singer).toContain('《说谎》');expect(singer).toContain('《心桥》');expect(singer).not.toContain('低音与弦乐');expect(singer).not.toContain('双人演唱');
 expect(matchSongArchiveKeywords('我想聊聊《说谎》',rows)).toContain('低音与弦乐');
 expect(matchSongArchiveKeywords('Troye Sivan',rows)).toContain('《Hello》');
 expect(matchSongArchiveKeywords('helloWorld',rows)).toBe('');
 expect(matchSongArchiveKeywords('HELLO',rows)).toContain('试听片段');
});
it('disabled skips archive read; enabled only reads current pending user turn and persists in existing assets',async()=>{
 await setSongKeywordsEnabled(false);const all=vi.spyOn(DB,'getAllAssets');
 const user=(content:string,id:number)=>({id,charId:'c',role:'user',type:'text',content,timestamp:id} as any);
 expect(await buildSongArchiveKeywordBlock([user('说谎',1)])).toBe('');expect(all).not.toHaveBeenCalled();
 await DB.saveAsset('personal_song_sound_v1_1',JSON.stringify(rows[0]));await DB.saveAsset('unrelated-large-image','image-data');await setSongKeywordsEnabled(true);
 const history=[user('说谎',1),{...user('好听',2),role:'assistant'},user('真源呀',3)];
 expect(await buildSongArchiveKeywordBlock(history)).toBe('');
 expect(await buildSongArchiveKeywordBlock([...history,user('张真源',4)])).toContain('《说谎》');
 expect(await buildSongArchiveKeywordBlock([user('说谎',5)])).toContain('低音与弦乐');
 expect(await DB.getAllAssets('personal_song_sound_v1_')).toHaveLength(1);
 await setSongKeywordsEnabled(false);all.mockRestore();
});
it('cards persist in ordinary history, deduplicate across retries/concurrent calls, and return only after summarization',async()=>{
 const {setReliableMemoryPalaceHighWaterMark}=await import('./memoryPalace/highWaterMark');
 const charId='keyword-durable-test';
 await DB.saveAsset('personal_song_sound_v1_1',JSON.stringify(rows[0]));
 await setSongKeywordsEnabled(true);
 const user={id:600,charId,role:'user',type:'text',content:'张真源的说谎',timestamp:600} as any;
 await Promise.all([buildSongArchiveKeywordBlock([user],charId),buildSongArchiveKeywordBlock([user],charId)]);
 let messages=await DB.getMessagesByCharId(charId,true);
 expect(messages).toHaveLength(2);expect(messages.every(m=>m.role==='system'&&m.type==='text')).toBe(true);
 expect(messages.find(m=>m.metadata.recallKind==='artist')?.content).not.toContain('低音与弦乐');
 expect(messages.find(m=>m.metadata.recallKind==='song')?.content).toContain('低音与弦乐');
 const visible=[...messages,{...user,id:601}];
 expect(await buildSongArchiveKeywordBlock(visible,charId)).toBe('');
 // A limited visible window does not imply summarization and must not create another card.
 expect(await buildSongArchiveKeywordBlock([user],charId)).toContain('低音与弦乐');
 expect(await DB.getMessagesByCharId(charId,true)).toHaveLength(2);
 await setReliableMemoryPalaceHighWaterMark(charId,Math.max(...messages.map(m=>m.id)));
 await buildSongArchiveKeywordBlock([user],charId);
 messages=await DB.getMessagesByCharId(charId,true);expect(messages).toHaveLength(4);
 await setSongKeywordsEnabled(false);
});
it('system cards, assistant replies, and sourced application records never trigger keyword recursion',async()=>{
 await setSongKeywordsEnabled(true);
 const m={id:800,charId:'keyword-no-recursion',role:'system',type:'text',content:'张真源 说谎',timestamp:800} as any;
 for(const msg of [m,{...m,role:'assistant'},{...m,role:'user',metadata:{source:'songwriting'}}])expect(await buildSongArchiveKeywordBlock([msg],m.charId)).toBe('');
 expect(await DB.getMessagesByCharId(m.charId,true)).toHaveLength(0);
 await setSongKeywordsEnabled(false);
});
