import {expect,it} from 'vitest';
import {makeVersion,mergeVocalReply,melodyToAbc} from '../features/songwriting/melody';
import {alignVocalLyrics,phraseForLine,selectVocalRange,vocalTarget} from '../features/songwriting/vocalMelody';
const lines=[{id:'a',section:'verse',content:'想你',authorId:'user'},{id:'b',section:'verse',content:'晚风来',authorId:'user'},{id:'c',section:'chorus',content:'奔向你',authorId:'user'}] as any;
const song={id:'s',lines} as any;
// One syllable extends over several pitches; the rest is a phrase pause, not another word.
const bar=()=>({notes:[{pitch:'C4',beats:1,lyric:'想'},{pitch:'D4',beats:.5},{pitch:'E4',beats:.5},{pitch:'G4',beats:1,lyric:'你'},{pitch:'R',beats:1}]});
it('supports one syllable over multiple pitches and variable-length phrases without filling eight bars',()=>{
 const version=mergeVocalReply(song,undefined,{reply:'先写这一句',bpm:84,phrases:[{lineId:'a',bars:[bar()]}]},vocalTarget(song,'line',0));
 expect(version.bars).toHaveLength(1);expect(version.phrases?.[0].lyricText).toBe('想你');
 expect(version.bars[0].notes.slice(0,3).map(n=>n.lyric)).toEqual(['想',undefined,undefined]);
 expect(melodyToAbc(version,'测试')).toContain('=C2 =D1 =E1 =G2 z2');
});
it('adds and revises only selected phrases; preserves other notes and stable lyric identities',()=>{
 const first=mergeVocalReply(song,undefined,{reply:'主歌',bpm:84,phrases:[{lineId:'a',bars:[bar()]},{lineId:'b',bars:[bar(),bar()]}]},vocalTarget(song,'section',0));
 const next=mergeVocalReply(song,first,{reply:'改第二句',bpm:100,phrases:[{lineId:'b',bars:[{notes:[{pitch:'E4',beats:4,lyric:'晚'}]}]}]},vocalTarget(song,'line',1));
 expect(next.bars).toHaveLength(2);expect(next.bars[0]).toEqual(first.bars[0]);expect(next.bpm).toBe(84);expect(next.sourceId).toBe(first.id);
 expect(next.phrases?.[0].id).toBe(first.phrases?.[0].id);expect(next.phrases?.[1].start).toBe(1);
 expect(()=>mergeVocalReply(song,first,{reply:'越界',phrases:[{lineId:'c',bars:[bar()]}]},vocalTarget(song,'line',0))).toThrow('超出');
 const range=selectVocalRange(song,next,vocalTarget(song,'line',1));expect(range.version.bars).toHaveLength(1);expect(range.label).toContain('晚风来');
 expect(selectVocalRange(song,next,vocalTarget(song,'section',0)).version.bars).toHaveLength(2);
});
it('melody-first lyrics bind in order when unambiguous, while changed lyrics require explicit realignment',()=>{
 const empty={id:'s',lines:[]} as any;
 const version=mergeVocalReply(empty,undefined,{reply:'先曲',bpm:84,phrases:[{bars:[bar()]},{bars:[bar()]}]},vocalTarget(empty,'song'));
 const withLyrics={...song,lines:lines.slice(0,2),melody:{activeId:version.id,versions:[version]}};
 const aligned=alignVocalLyrics(withLyrics,[]) as any;
 expect(phraseForLine(aligned,aligned.melody.versions[0],'a')).toBeDefined();
 const edited=alignVocalLyrics({...aligned,lines:[{...lines[0],id:'a2',content:'我换了词'},lines[1]]},lines) as any;
 expect(phraseForLine(edited,edited.melody.versions[0],'a2')).toBeUndefined();
 expect(edited.melody.versions[0].bars).toEqual(version.bars);
 const unchanged=alignVocalLyrics({...aligned,lines:[{...lines[0],id:'a3'},lines[1]]},lines) as any;
 expect(phraseForLine(unchanged,unchanged.melody.versions[0],'a3')).toBeDefined();
});
it('old eight-bar versions remain playable but are never guessed onto individual lyric lines',()=>{
 const old=makeVersion(Array.from({length:8},bar),84,'旧版');
 expect(selectVocalRange(song,old,vocalTarget(song,'song')).version.bars).toHaveLength(8);
 expect(()=>selectVocalRange(song,old,vocalTarget(song,'line',0))).toThrow('还没有对应曲调');
});
