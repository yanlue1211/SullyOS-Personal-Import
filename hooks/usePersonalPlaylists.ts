import {useEffect,useState} from 'react';
import {PERSONAL_PLAYLIST_EVENT,readPersonalPlaylists,type PersonalPlaylist} from '../utils/personalMusicLibrary';
export function usePersonalPlaylists(){
 const [playlists,setPlaylists]=useState<PersonalPlaylist[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true,sequence=0;const reload=()=>{const current=++sequence;void readPersonalPlaylists().then(value=>{if(alive&&current===sequence){setPlaylists(value);setReady(true);setError('');}}).catch(e=>{if(alive&&current===sequence)setError(String(e));});};const storage=(e:StorageEvent)=>{if(e.key===PERSONAL_PLAYLIST_EVENT)reload();};reload();window.addEventListener(PERSONAL_PLAYLIST_EVENT,reload);window.addEventListener('storage',storage);return()=>{alive=false;window.removeEventListener(PERSONAL_PLAYLIST_EVENT,reload);window.removeEventListener('storage',storage);};},[]);
 return {playlists,ready,error};
}
