// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('./db',()=>({DB:{getAssetRaw:vi.fn(async()=>null)}}));
import {MusicProvider,useMusic,musicApi,type Song} from '../context/MusicContext';
import {cachedCall,clearAll} from './musicCache';
class AudioMock extends EventTarget {
 src='';paused=true;preload='';currentTime=0;duration=100;error:any=null;
 play=vi.fn(async()=>{this.paused=false;this.dispatchEvent(new Event('play'));});
 pause(){this.paused=true;}removeAttribute(){this.src='';}load(){this.error=null;}
}
let music:ReturnType<typeof useMusic>,audio:AudioMock,root:ReturnType<typeof createRoot>,host:HTMLDivElement;
function Probe(){music=useMusic();return null;}
const songs:Song[]=[1,2,3].map(id=>({id,name:'歌'+id,artists:'歌手',album:'',albumPic:'',duration:1,fee:0}));
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();vi.stubGlobal('Audio',class extends AudioMock{constructor(){super();audio=this;}});vi.spyOn(musicApi,'lyric').mockResolvedValue({});vi.spyOn(musicApi,'songUrl').mockImplementation(async(_cfg,id)=>({data:[{url:'https://cdn.test/'+id}]}));vi.spyOn(musicApi,'songUrlFresh').mockResolvedValue({data:[]});host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<MusicProvider><Probe/></MusicProvider>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('does not store empty song/url results in the browser cache',async()=>{
 clearAll();let requests=0;
 const fetcher=async()=>{
   requests++;
   return requests===1?{data:[{url:null}]}:{data:[{url:'https://cdn.test/recovered'}]};
 };
 const first=await cachedCall('/song/url',{ids:[741],level:'exhigh'},'',fetcher);
 const second=await cachedCall('/song/url',{ids:[741],level:'exhigh'},'',fetcher);
 expect(first.data[0].url).toBeNull();
 expect(second.data[0].url).toBe('https://cdn.test/recovered');
 expect(requests).toBe(2);
 clearAll();
});
it('missing URLs skip to the next track and stop after exhausting the queue',async()=>{
 vi.mocked(musicApi.songUrl).mockResolvedValue({data:[]});
 await act(async()=>{await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 expect(vi.mocked(musicApi.songUrl).mock.calls.map(c=>c[1])).toEqual([1,2,3]);expect(music.current?.id).toBe(3);expect(music.playing).toBe(false);
});
it('empty cached play URLs fetch a fresh address for the SAME song before any skip',async()=>{
 vi.mocked(musicApi.songUrl).mockResolvedValueOnce({data:[]});
 vi.mocked(musicApi.songUrlFresh).mockResolvedValueOnce({data:[{url:'https://cdn.test/recovered-1'}]});
 await act(async()=>{await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 expect(music.current?.id).toBe(1);
 expect(audio.src).toBe('https://cdn.test/recovered-1');
 expect(musicApi.songUrlFresh).toHaveBeenCalledTimes(1);
 expect(vi.mocked(musicApi.songUrl).mock.calls.map(c=>c[1])).toEqual([1]);
});
it('network outages do not skip the entire playlist; retry only this track once',async()=>{
 vi.mocked(musicApi.songUrl).mockRejectedValueOnce(new Error('HTTP 502'));
 vi.mocked(musicApi.songUrlFresh).mockRejectedValueOnce(new Error('netease upstream fetch failed (all sources)'));
 await act(async()=>{await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 expect(music.current?.id).toBe(1);
 expect(music.playing).toBe(false);
 expect(musicApi.songUrlFresh).toHaveBeenCalledTimes(1);
 expect(vi.mocked(musicApi.songUrl).mock.calls.map(c=>c[1])).toEqual([1]);
});
it('stale media errors while the next song has no attached source cannot trigger another skip',async()=>{
 let release!:(result:any)=>void;
 vi.mocked(musicApi.songUrl).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 let requested!:Promise<void>;
 await act(async()=>{requested=music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 expect(audio.src).toBe('');
 audio.error={code:4};
 await act(async()=>{audio.dispatchEvent(new Event('error'));});
 expect(music.current?.id).toBe(1);
 expect(musicApi.songUrlFresh).not.toHaveBeenCalled();
 await act(async()=>{release({data:[{url:'https://cdn.test/1'}]});await requested;});
 expect(audio.src).toBe('https://cdn.test/1');
 expect(music.current?.id).toBe(1);
});
it('does not call load() with an empty source when changing songs on mobile',async()=>{
 const loadSpy=vi.spyOn(audio,'load');
 await act(async()=>{await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 await act(async()=>{await music.playSong(songs[1]);});
 expect(loadSpy).not.toHaveBeenCalled();
 expect(audio.src).toBe('https://cdn.test/2');
});
it('aborted media loading while changing tracks does not count as a failed song',async()=>{
 await act(async()=>{await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 await act(async()=>{audio.error={code:1};audio.dispatchEvent(new Event('error'));});
 expect(music.current?.id).toBe(1);
 expect(musicApi.songUrlFresh).not.toHaveBeenCalled();
 expect(vi.mocked(musicApi.songUrl).mock.calls.map(c=>c[1])).toEqual([1]);
});
it('network playback media errors refresh the current URL instead of skipping',async()=>{
 vi.mocked(musicApi.songUrlFresh).mockResolvedValueOnce({data:[{url:'https://cdn.test/1-fresh'}]});
 await act(async()=>{await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 await act(async()=>{audio.error={code:2};audio.dispatchEvent(new Event('error'));});
 expect(audio.src).toBe('https://cdn.test/1-fresh');
 expect(music.current?.id).toBe(1);
 expect(musicApi.songUrlFresh).toHaveBeenCalledTimes(1);
});
it('a fresh URL request uses a unique cache key and preserves the chosen quality',async()=>{
 vi.mocked(musicApi.songUrlFresh).mockRestore();
 const raw=vi.spyOn(musicApi,'_raw').mockResolvedValue({data:[{url:'https://cdn.test/1'}]});
 await musicApi.songUrlFresh({...music.cfg,quality:'lossless'},1);
 await musicApi.songUrlFresh({...music.cfg,quality:'lossless'},1);
 expect(raw).toHaveBeenCalledTimes(2);
 const first=raw.mock.calls[0],second=raw.mock.calls[1];
 expect(first[1]).toBe('/song/url');
 expect(first[2]).toMatchObject({ids:[1],level:'lossless'});
 expect(first[2].playbackRefreshNonce).not.toBe(second[2].playbackRefreshNonce);
});
it('decode errors skip even in single-repeat mode and do not retry the failed song',async()=>{
 await act(async()=>{music.setPlayMode('single');await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 await act(async()=>{audio.error={code:3};audio.dispatchEvent(new Event('error'));});
 expect(music.current?.id).toBe(2);expect(audio.src).toBe('https://cdn.test/2');
});
it('autoplay permission denial stays on the track for user interaction',async()=>{
 audio.play.mockRejectedValueOnce(new DOMException('gesture required','NotAllowedError'));
 await act(async()=>{await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 expect(music.current?.id).toBe(1);expect(musicApi.songUrl).toHaveBeenCalledTimes(1);
});
it('late URL responses cannot replace a newly selected song',async()=>{
 let release!:(v:any)=>void;vi.mocked(musicApi.songUrl).mockImplementationOnce(()=>new Promise(r=>release=r));
 let first!:Promise<void>;await act(async()=>{first=music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 await act(async()=>{await music.playSong(songs[1]);release({data:[{url:'https://cdn.test/old'}]});await first;});
 expect(music.current?.id).toBe(2);expect(audio.src).toBe('https://cdn.test/2');
});
