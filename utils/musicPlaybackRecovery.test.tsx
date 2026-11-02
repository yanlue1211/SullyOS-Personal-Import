// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('./db',()=>({DB:{getAssetRaw:vi.fn(async()=>null)}}));
import {MusicProvider,useMusic,musicApi,type Song} from '../context/MusicContext';
class AudioMock extends EventTarget {
 src='';paused=true;preload='';currentTime=0;duration=100;error:any=null;
 play=vi.fn(async()=>{this.paused=false;this.dispatchEvent(new Event('play'));});
 pause(){this.paused=true;}removeAttribute(){this.src='';}load(){this.error=null;}
}
let music:ReturnType<typeof useMusic>,audio:AudioMock,root:ReturnType<typeof createRoot>,host:HTMLDivElement;
function Probe(){music=useMusic();return null;}
const songs:Song[]=[1,2,3].map(id=>({id,name:'歌'+id,artists:'歌手',album:'',albumPic:'',duration:1,fee:0}));
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();vi.stubGlobal('Audio',class extends AudioMock{constructor(){super();audio=this;}});vi.spyOn(musicApi,'lyric').mockResolvedValue({});vi.spyOn(musicApi,'songUrl').mockImplementation(async(_cfg,id)=>({data:[{url:'https://cdn.test/'+id}]}));host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<MusicProvider><Probe/></MusicProvider>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('missing URLs skip to the next track and stop after exhausting the queue',async()=>{
 vi.mocked(musicApi.songUrl).mockResolvedValue({data:[]});
 await act(async()=>{await music.playSong(songs[0],{replaceQueue:songs,startIdx:0});});
 expect(vi.mocked(musicApi.songUrl).mock.calls.map(c=>c[1])).toEqual([1,2,3]);expect(music.current?.id).toBe(3);expect(music.playing).toBe(false);
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
