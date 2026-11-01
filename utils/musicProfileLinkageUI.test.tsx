// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DB} from './db';
import {savePersonalPlaylists,readPersonalPlaylists} from './personalMusicLibrary';
const mock=vi.hoisted(()=>({play:vi.fn(),manage:vi.fn(),tracks:vi.fn(),search:vi.fn(),index:vi.fn()}));
vi.mock('../context/OSContext',()=>({useOS:()=>({characters:[],userProfile:{name:'我'},addToast:vi.fn()})}));
vi.mock('../context/MusicContext',async original=>{const m:any=await original();return {...m,musicApi:{...m.musicApi,userPlaylist:mock.index,userRecord:vi.fn().mockResolvedValue({}),userCloud:vi.fn().mockResolvedValue({}),playlistTrackAll:mock.tracks,search:mock.search},useMusic:()=>({cfg:{cookie:'TEST'},profile:{userId:1,nickname:'我'},current:null,localAlbumSongs:[],listeningTogetherWith:[],playSong:mock.play,setCfg:vi.fn(),setToastHandler:vi.fn()})};});
import Profile from '../apps/music/NeteaseProfilePage';
import Manager from '../apps/music/MusicLibraryManager';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;await DB.deleteAsset('music-user-playlists');await DB.deleteAsset('music-netease-index:1');mock.manage.mockReset();mock.play.mockReset();mock.index.mockReset();mock.index.mockResolvedValue({playlist:[{id:1,name:'网易收藏',trackCount:2}]});mock.tracks.mockResolvedValue({songs:[{id:1,name:'一',ar:[{name:'歌手'}]},{id:2,name:'二',ar:[{name:'歌手'}]}]});host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Profile onBack={()=>{}} onOpenPlayer={()=>{}} onManage={mock.manage}/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function click(text:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text||b.getAttribute('aria-label')===text);expect(b,text).toBeTruthy();await act(async()=>b!.click());}
it('places music management beside daily sign-in and shows local playlists beside the original NetEase cards',async()=>{
 const row=host.querySelector('[aria-label="音乐快捷操作"]');expect(row?.textContent).toContain('每日签到');expect(row?.textContent).toContain('音乐管理');await click('音乐管理');expect(mock.manage).toHaveBeenCalled();
 await act(async()=>savePersonalPlaylists([{id:'p',title:'实时歌单',songs:[{id:-1,name:'直链歌',artists:'A',album:'',albumPic:'',duration:1,fee:0,local:true,remoteAudioUrl:'https://cdn.test/a.mp3'}],description:'',coverStyle:'',createdAt:1,updatedAt:1}]));await vi.waitFor(()=>expect(host.textContent).toContain('实时歌单'));
 await click('展开歌单 实时歌单');await click('播放 直链歌');expect(mock.play.mock.calls[0][0].remoteAudioUrl).toContain('a.mp3');
});
it('saves the original NetEase card without duplicating it on repeated saves',async()=>{
 await vi.waitFor(()=>expect(host.textContent).toContain('网易收藏'));await click('一键保存已有歌单');await vi.waitFor(async()=>expect((await readPersonalPlaylists())[0]?.songs).toHaveLength(2));await click('一键保存已有歌单');expect((await readPersonalPlaylists())[0].songs).toHaveLength(2);expect(host.querySelectorAll('[aria-label="展开歌单 网易收藏"]')).toHaveLength(1);
});
it('a playlist created in management becomes visible when returning to the homepage',async()=>{
 await act(async()=>root.render(<Manager onClose={()=>{}}/>));await vi.waitFor(()=>expect(host.textContent).not.toContain('正在读取歌单'));
 const input=host.querySelector('[aria-label="歌单名称"]') as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'我的新乐匣');input.dispatchEvent(new Event('input',{bubbles:true}));});await click('新建');await vi.waitFor(async()=>expect((await readPersonalPlaylists())[0]?.title).toBe('我的新乐匣'));
 await act(async()=>root.render(<Profile onBack={()=>{}} onOpenPlayer={()=>{}} onManage={mock.manage}/>));await vi.waitFor(()=>expect(host.textContent).toContain('我的新乐匣'));
});

it('the existing card opens music management for that same saved playlist',async()=>{
 await vi.waitFor(()=>expect(host.textContent).toContain('网易收藏'));await click('加歌');await vi.waitFor(()=>expect(mock.manage).toHaveBeenCalledWith('netease-1'));expect((await readPersonalPlaylists())[0].songs).toHaveLength(2);
});
it('reopening reads the saved playlist index instead of requesting it again',async()=>{
 await vi.waitFor(()=>expect(host.textContent).toContain('网易收藏'));expect(mock.index).toHaveBeenCalledTimes(1);
 await act(async()=>root.render(<div/>));await act(async()=>root.render(<Profile onBack={()=>{}} onOpenPlayer={()=>{}} onManage={mock.manage}/>));await vi.waitFor(()=>expect(host.textContent).toContain('网易收藏'));expect(mock.index).toHaveBeenCalledTimes(1);
});
