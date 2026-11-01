import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OSPreviewProvider} from '../../context/OSContext';
import {MusicProvider,useMusic,loadMusicPlaybackSnapshot} from '../../context/MusicContext';
import MusicLibraryManager from '../../apps/music/MusicLibraryManager';
import Gallery from '../../apps/Gallery';
import {DB} from '../../utils/db';
const char={id:'library-qa',name:'测试角色',avatar:'',musicProfile:{bio:'爱听歌',genreTags:[],signatureArtists:[],playlists:[],likedSongIds:[],recentPlays:[],initializedAt:1,updatedAt:1}};
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#cdd8bb"/></svg>');
await DB.saveCharacter(char as any);
if(!(await DB.getGalleryImages(char.id)).length)for(let i=0;i<3;i++)await DB.saveGalleryImage({id:'qa-photo-'+i,charId:char.id,url:image,timestamp:i} as any);
function Probe(){const music=useMusic();(window as any).__libraryQA.music=music;return null;}
function App(){const [characters,setCharacters]=useState([char]);return <OSPreviewProvider value={{characters,userProfile:{name:'用户'},apiConfig:{},groups:[],realtimeConfig:{},addToast:()=>{},closeApp:()=>{},updateCharacter:(id:string,patch:any)=>{setCharacters(cs=>cs.map(c=>c.id===id?{...c,...patch}:c));}} as any}><MusicProvider><Probe/>{location.search.includes('gallery')?<Gallery/>:<MusicLibraryManager onClose={()=>{}}/>}</MusicProvider></OSPreviewProvider>;}
(window as any).__libraryQA={DB,loadMusicPlaybackSnapshot};
createRoot(document.getElementById('root')!).render(<App/>);
