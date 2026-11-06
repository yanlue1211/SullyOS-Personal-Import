import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('../context/MusicContext',()=>({musicApi:{search:vi.fn(),lyric:vi.fn()},parseLyric:(s:string)=>s.split('\n').flatMap(line=>{const m=line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);return m?[{t:Number(m[1])*60+Number(m[2]),text:m[3]}]:[]})}));
vi.mock('./db',()=>({DB:{getAssetRaw:vi.fn()}}));
import {musicApi} from '../context/MusicContext';
import {exactLyricMatch,matchLyrics,lyricFields,parseVorbisTags,bounded} from './lyricCompletion';
const t={id:'1',name:'无名氏',artists:'张真源'};
const c={id:'2',name:'无名氏',artists:'张真源',source:'lrclib' as const,synced:'[00:01.50]第一句\n[00:04.00]第二句'};
describe('conservative lyric completion',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>[ {...c,trackName:c.name,artistName:c.artists,syncedLyrics:c.synced} ]}));vi.mocked(musicApi.search).mockResolvedValue({result:{songs:[]}});});
 it('matches title and singer, rejects covers and versions',()=>{expect(exactLyricMatch(t,c)).toBe(true);expect(exactLyricMatch({...t,artists:'别的歌手'},c)).toBe(false);expect(exactLyricMatch({...t,name:'无名氏 Live'},c)).toBe(false);expect(exactLyricMatch({...t,artists:''},c)).toBe(false);});
 it('fills existing song without reimport',async()=>{expect((await matchLyrics(t,{} as any,new AbortController().signal)).status).toBe('success');});
 it('protects existing lyrics with no request',async()=>{expect((await matchLyrics({...t,lyrics:'原文'},{} as any,new AbortController().signal)).status).toBe('skipped');expect(musicApi.search).not.toHaveBeenCalled();});
 it('leaves same title different singer for confirmation',async()=>{const r=await matchLyrics({...t,artists:'另一位歌手'},{} as any,new AbortController().signal);expect(r.status).toBe('confirm');expect(r.chosen).toBeUndefined();});
 it('saves real LRC timing, does not invent plain timing',()=>{expect(lyricFields(c)).toEqual({localLyrics:'第一句\n第二句',lyricLineTimings:[1.5,4],lyricTimingMode:'synced'});expect(lyricFields({...c,synced:undefined,plain:'纯文字'})).toEqual({localLyrics:'纯文字',lyricLineTimings:undefined,lyricTimingMode:'plain'});});
 it('cancels even when old source never resolves',async()=>{const a=new AbortController();const task=bounded(new Promise(()=>{}),a.signal);a.abort();await expect(task).rejects.toThrow();});
 it('a failed source does not prevent next song',async()=>{vi.mocked(musicApi.search).mockRejectedValue(Error('offline'));vi.mocked(fetch).mockRejectedValueOnce(Error('offline'));expect((await matchLyrics(t,{} as any,new AbortController().signal)).status).toBe('failed');expect((await matchLyrics(t,{} as any,new AbortController().signal)).status).toBe('success');});
 it('reads Ogg comments regardless of filename',()=>{const encode=new TextEncoder(),parts:number[]=[3,...encode.encode('vorbis')];const u32=(n:number)=>parts.push(n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255);u32(3);parts.push(...encode.encode('abc'));u32(2);for(const tag of ['TITLE=无名氏','ARTIST=张真源']){const b=encode.encode(tag);u32(b.length);parts.push(...b);}const page=new Uint8Array(28+parts.length);page.set(encode.encode('OggS'));page[26]=1;page[27]=parts.length;page.set(parts,28);expect(parseVorbisTags(page)).toEqual({TITLE:'无名氏',ARTIST:'张真源'});});
});
