import {beforeEach,expect,it,vi} from 'vitest';
import {DB} from './db';
import {importNeteasePlaylist,readPersonalPlaylists,savePersonalPlaylists,savePersonalPlaylistEdits,mergePlaylistSongs,loadNeteasePlaylistSongs} from './personalMusicLibrary';
const song=(id:number,extra:any={})=>({id,name:'歌曲',artists:'歌手',album:'',albumPic:'',duration:1,fee:0,...extra});
beforeEach(async()=>{await DB.deleteAsset('music-user-playlists');});
it('retains old personal playlists, merges repeated imports and preserves local/remote sources',async()=>{
 await savePersonalPlaylists([{id:'old',title:'旧歌单',songs:[song(-1,{local:true,remoteAudioUrl:'https://cdn.test/a.mp3'})],description:'',coverStyle:'',createdAt:1,updatedAt:1}]);
 await importNeteasePlaylist({id:10,name:'网易歌单'},[song(1),song(1),song(2)]);
 const result=await importNeteasePlaylist({id:10,name:'网易歌单'},[song(2),song(3)]);
 expect(result.added).toBe(1);const lists=await readPersonalPlaylists();expect(lists).toHaveLength(2);expect(lists[1].songs.map(s=>s.id)).toEqual([1,2,3]);expect(lists[0].songs[0].remoteAudioUrl).toBe('https://cdn.test/a.mp3');
});
it('does not lose another playlist during concurrent imports',async()=>{
 await Promise.all([importNeteasePlaylist({id:1,name:'A'},[song(1)]),importNeteasePlaylist({id:2,name:'B'},[song(2)])]);expect(await readPersonalPlaylists()).toHaveLength(2);
});
it('deduplicates exact URLs/assets but retains different recordings with the same title',()=>{
 const result=mergePlaylistSongs([song(-1,{remoteAudioUrl:'https://cdn.test/a.mp3'})],[song(-2,{remoteAudioUrl:'https://cdn.test/a.mp3#x'}),song(-3,{localAssetKey:'same'}),song(-4,{localAssetKey:'same'}),song(5),song(6)]);expect(result.map(s=>s.id)).toEqual([-1,-3,5,6]);
});
it('reads a 290-song playlist across all three pages before importing',async()=>{
 const page=vi.fn(async(limit,offset)=>({code:200,songs:Array.from({length:Math.min(limit,290-offset)},(_,i)=>({id:offset+i+1,name:'歌',ar:[{name:'歌手'}],dt:1000}))}));
 const songs=await loadNeteasePlaylistSongs({trackCount:290},page);expect(songs).toHaveLength(290);expect(page.mock.calls.map(c=>c[1])).toEqual([0,100,200]);
});
it('rejects missing or repeated pages so a partial response is not saved as a complete import',async()=>{
 const old=await importNeteasePlaylist({id:1,name:'保留'},[song(1)]);
 await expect(loadNeteasePlaylistSongs({trackCount:120},async()=>({songs:[{id:1,name:'歌'}]}))).rejects.toThrow('读取完整');
 expect(await readPersonalPlaylists()).toEqual(old.lists);
});

it('a delayed add/rename does not overwrite songs saved by a simultaneous cloud refresh',async()=>{
 await importNeteasePlaylist({id:1,name:'歌单'},[song(1)]);const previous=await readPersonalPlaylists();
 await importNeteasePlaylist({id:1,name:'歌单'},[song(1),song(2)]);
 await savePersonalPlaylistEdits(previous,[{...previous[0],title:'新名字',songs:[...previous[0].songs,song(-1,{remoteAudioUrl:'https://cdn.test/local.mp3'})]}]);
 const [result]=await readPersonalPlaylists();expect(result.title).toBe('新名字');expect(result.songs.map(s=>s.id)).toEqual([1,2,-1]);
});
