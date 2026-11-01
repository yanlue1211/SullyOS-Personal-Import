// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({add:vi.fn(),play:vi.fn(),update:vi.fn(),toast:vi.fn(),save:vi.fn(),get:vi.fn(),chars:[{id:'a',name:'阿源'}] as any[]}));
vi.mock('../context/OSContext',()=>({useOS:()=>({characters:m.chars,updateCharacter:m.update,addToast:m.toast})}));
vi.mock('../utils/db',()=>({DB:{saveAssetRaw:m.save,getAsset:m.get,saveAsset:vi.fn().mockResolvedValue(undefined)}}));
vi.mock('../context/MusicContext',async original=>{const orig:any=await original();return {...orig,useMusic:()=>({localAlbumSongs:[],addLocalSong:m.add,current:null,cfg:{},playSong:m.play})};});
import Manager from '../apps/music/MusicLibraryManager';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;m.get.mockResolvedValue(null);m.add.mockReset();m.play.mockReset();m.chars=[{id:'a',name:'阿源'}];m.update.mockReset();m.save.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Manager onClose={()=>{}}/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function fill(label:string,value:string){const e=host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});}
async function click(text:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;expect(b).toBeTruthy();await act(async()=>b.click());}
it('imports a remote song without writing audio bytes, keeping exact LRC times',async()=>{
 await fill('歌曲音频链接','https://cdn.jsdelivr.net/gh/yanlue1211/yan@main/xiangsisuo.mp3');await fill('歌名','相思锁');await fill('歌手','歌手');await fill('歌曲歌词','[00:12.50]第一句\n[00:18.20]第二句');await click('导入到本地歌曲');
 expect(m.save).not.toHaveBeenCalled();expect(m.add).toHaveBeenCalledWith(expect.objectContaining({name:'相思锁',remoteAudioUrl:expect.stringContaining('xiangsisuo.mp3'),lyricTimingMode:'synced',lyricLineTimings:[12.5,18.2]}));
});
it('plain lyrics remain untimed and unsafe URLs do not create a song',async()=>{
 await fill('歌曲音频链接','javascript:alert(1)');await fill('歌名','歌');await click('导入到本地歌曲');expect(m.add).not.toHaveBeenCalled();
 await fill('歌曲音频链接','https://cdn.test/song.mp3');await fill('歌曲歌词','第一句\n第二句');await click('导入到本地歌曲');expect(m.add.mock.calls[0][0]).toMatchObject({localLyrics:'第一句\n第二句',lyricTimingMode:'plain',lyricLineTimings:undefined});
});
it('creates a playlist on the selected character account without replacing other profile data',async()=>{
 const select=host.querySelector('[aria-label="管理音乐账号"]') as HTMLSelectElement;await act(async()=>{select.value='a';select.dispatchEvent(new Event('change',{bubbles:true}));});await fill('歌单名称','晚安');await click('新建');expect(m.update).toHaveBeenCalledWith('a',expect.objectContaining({musicProfile:expect.objectContaining({playlists:[expect.objectContaining({title:'晚安',songs:[]})]})}));
});

it('starts the selected playlist as a full queue, retaining remote audio source fields',async()=>{
 const songs=[{id:-1,name:'A',artists:'歌手',remoteAudioUrl:'https://cdn.test/a.mp3',local:true},{id:-2,name:'B',artists:'歌手',remoteAudioUrl:'https://cdn.test/b.mp3',local:true}];
 m.chars[0].musicProfile={bio:'',genreTags:[],signatureArtists:[],playlists:[{id:'p',title:'歌单',songs}],likedSongIds:[],recentPlays:[],updatedAt:1};
 const owner=host.querySelector('[aria-label="管理音乐账号"]') as HTMLSelectElement;await act(async()=>{owner.value='a';owner.dispatchEvent(new Event('change',{bubbles:true}));});
 const pl=host.querySelector('[aria-label="选择歌单"]') as HTMLSelectElement;await act(async()=>{pl.value='p';pl.dispatchEvent(new Event('change',{bubbles:true}));});
 await click('B · 歌手');expect(m.play).toHaveBeenCalledWith(songs[1],{alsoSetQueue:true,replaceQueue:songs,startIdx:1});
});
