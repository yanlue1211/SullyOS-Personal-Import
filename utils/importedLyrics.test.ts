import {expect,it} from 'vitest';
import {parseLyric} from '../context/MusicContext';
import {ContextBuilder} from './context';
it('reads exact LRC offsets, repeated timestamp tags and decimal precision',()=>{
 expect(parseLyric('[offset:-500]\n[00:10.50][00:30.250]副歌\n[00:05:75]开头')).toEqual([{t:5.25,text:'开头'},{t:10,text:'副歌'},{t:29.75,text:'副歌'}]);expect(parseLyric('没有时间戳的歌词')).toEqual([]);
});
it('labels untimed lyrics as full-song reference without inventing a current line',()=>{
 const text=ContextBuilder.buildMusicAtmosphere({id:'a',name:'A'} as any,'User',{songName:'歌',artists:'歌手',lyricWindow:[],activeIdx:-1,fullLyrics:'第一句\n第二句'},null,true);
 expect(text).toContain('未对轴');expect(text).toContain('第一句');expect(text).not.toContain('>>');
});

it('detects Ogg content behind a .mp3 remote link for the music recognition API',async()=>{
 const {vi}=await import('vitest');const {fetchSongAudio,audioBlobToPayload}=await import('./audioApi');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Blob(['OggSfake-audio'],{type:'audio/mpeg'}),{status:200,headers:{'content-type':'audio/mpeg'}})));
 try{const result=await fetchSongAudio({remoteAudioUrl:'https://cdn.test/song.mp3'} as any,{} as any);expect(result.blob.type).toBe('audio/ogg');expect((await audioBlobToPayload(result.blob)).format).toBe('ogg');}finally{vi.unstubAllGlobals();}
});
