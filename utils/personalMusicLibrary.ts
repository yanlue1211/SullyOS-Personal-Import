import {DB} from './db';
import type {CharPlaylist,CharPlaylistSong} from '../types';
export const PERSONAL_PLAYLIST_KEY='music-user-playlists';
export const PERSONAL_PLAYLIST_EVENT='personal-music-playlists-changed';
export interface PersonalPlaylist extends CharPlaylist {neteaseSourceId?:number}
let writes:Promise<unknown>=Promise.resolve();
export async function readPersonalPlaylists():Promise<PersonalPlaylist[]>{
 const raw=await DB.getAsset(PERSONAL_PLAYLIST_KEY);if(!raw)return [];
 const value=JSON.parse(raw);if(!Array.isArray(value)||value.some(p=>!p||typeof p.id!=='string'||typeof p.title!=='string'||!Array.isArray(p.songs)))throw Error('歌单数据无法读取，请保留数据后重试');
 return value;
}
function announce(){if(typeof window==='undefined')return;window.dispatchEvent(new Event(PERSONAL_PLAYLIST_EVENT));try{localStorage.setItem(PERSONAL_PLAYLIST_EVENT,crypto.randomUUID());}catch{}}
export function updatePersonalPlaylists(change:(current:PersonalPlaylist[])=>PersonalPlaylist[]):Promise<PersonalPlaylist[]>{
 const operation=async()=>{const next=change(await readPersonalPlaylists());await DB.saveAsset(PERSONAL_PLAYLIST_KEY,JSON.stringify(next));announce();return next;};
 const run=()=>typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request(PERSONAL_PLAYLIST_KEY,operation):operation();
 const job=writes.then(run,run);writes=job.catch(()=>{});return job;
}
export const savePersonalPlaylists=(playlists:PersonalPlaylist[])=>updatePersonalPlaylists(()=>playlists);
function keys(song:CharPlaylistSong):string[]{
 const result:string[]=[];
 if(song.remoteAudioUrl){try{const url=new URL(song.remoteAudioUrl);url.hash='';result.push('url:'+url.href);}catch{result.push('url:'+song.remoteAudioUrl.trim());}}
 if(song.localAssetKey)result.push('asset:'+song.localAssetKey);
 if(Number.isFinite(song.id))result.push('id:'+song.id);
 return result;
}
/** Match recording IDs/URLs, never just a title: live, cover and studio versions stay distinct. */
export function mergePlaylistSongs(current:CharPlaylistSong[],incoming:CharPlaylistSong[]):CharPlaylistSong[]{
 const seen=new Set<string>(),out:CharPlaylistSong[]=[];
 for(const song of [...current,...incoming]){const identity=keys(song);if(identity.some(k=>seen.has(k)))continue;identity.forEach(k=>seen.add(k));out.push({...song});}
 return out;
}
export async function importNeteasePlaylist(source:{id:number;name:string;coverImgUrl?:string},songs:CharPlaylistSong[]){
 let added=0;
 const lists=await updatePersonalPlaylists(current=>{
  const existing=current.find(p=>p.neteaseSourceId===source.id||p.id==='netease-'+source.id);
  const merged=mergePlaylistSongs(existing?.songs||[],songs);added=merged.length-(existing?.songs.length||0);
  if(existing)return current.map(p=>p.id===existing.id?{...p,songs:merged,updatedAt:Date.now()}:p);
  return [...current,{id:'netease-'+source.id,neteaseSourceId:source.id,title:source.name,description:'',coverStyle:'gradient-01',songs:merged,createdAt:Date.now(),updatedAt:Date.now()}];
 });return {lists,added};
}

export async function loadNeteasePlaylistSongs(source:{trackCount:number},readPage:(limit:number,offset:number)=>Promise<any>):Promise<CharPlaylistSong[]>{
 const expected=Math.max(0,Number(source.trackCount)||0),all:CharPlaylistSong[]=[];
 let offset=0;
 while(offset===0||(!expected||offset<expected)){
  const result=await readPage(100,offset);
  if(result?.code&&result.code!==200)throw Error(result.message||'歌单读取失败');
  if(!Array.isArray(result?.songs))throw Error('歌单没有返回歌曲列表');
  const songs:CharPlaylistSong[]=result.songs.map((s:any)=>{
   if(!Number.isFinite(s.id))throw Error('歌曲编号缺失');
   return {id:s.id,name:s.name||'',artists:(s.ar||s.artists||[]).map((a:any)=>a.name).join(' / '),album:s.al?.name||s.album?.name||'',albumPic:(s.al?.picUrl||s.album?.picUrl||'').replace(/^http:/,'https:'),duration:(s.dt||s.duration||0)/1000,fee:s.fee||0};
  });
  const previous=all.length,merged=mergePlaylistSongs(all,songs);all.splice(0,all.length,...merged);
  if(expected>all.length&&all.length===previous)throw Error('歌单尚未读取完整，请重试');
  offset+=100;
  if(!expected&&songs.length===100){if(offset>100000)throw Error('歌单过大，请分批导入');continue;}
  if(!expected||offset>=expected)break;
 }
 if(expected&&all.length<expected)throw Error('歌单尚未读取完整，请重试');
 return all;
}
