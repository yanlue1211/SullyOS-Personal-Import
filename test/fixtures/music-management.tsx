import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OSPreviewProvider} from '../../context/OSContext';
import {MusicPreviewProvider,type Song} from '../../context/MusicContext';
import Manager from '../../apps/music/MusicLibraryManager';
import Playlists from '../../apps/music/PersonalPlaylistsPanel';
import {readPersonalPlaylists,savePersonalPlaylists} from '../../utils/personalMusicLibrary';
if(!(await readPersonalPlaylists()).length)await savePersonalPlaylists([{id:'ci-music',title:'测试歌单',description:'',coverStyle:'',songs:[{id:-1,name:'原有歌曲',artists:'原有歌手',album:'',albumPic:'',duration:0,fee:0,local:true,remoteAudioUrl:'https://fixture.invalid/old.mp3'}],createdAt:1,updatedAt:1}]);
function Fixture(){
 const [songs,setSongs]=useState<Song[]>([]);const [plays,setPlays]=useState(0);
 return <OSPreviewProvider value={{characters:[],userProfile:{name:'用户'},addToast:()=>{},updateCharacter:()=>{}} as any}>
 <MusicPreviewProvider value={{localAlbumSongs:songs,current:null,cfg:{},addLocalSong:(song:Song)=>setSongs(old=>[song,...old.filter(x=>x.id!==song.id)]),playSong:()=>setPlays(n=>n+1)} as any}>
 <div data-play-count={plays} style={{position:'relative',height:'100%',overflow:'auto',background:'#faf9fd'}}>
 {location.search.includes('playlists')?<Playlists onOpenPlayer={()=>{}}/>:<Manager onClose={()=>{}} initialPlaylist="ci-music"/>}
 </div></MusicPreviewProvider></OSPreviewProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
