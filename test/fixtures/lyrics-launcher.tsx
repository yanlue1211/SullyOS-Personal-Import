import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OSPreviewProvider} from '../../context/OSContext';
import {MusicProvider} from '../../context/MusicContext';
import Launcher from '../../apps/Launcher';
import {INSTALLED_APPS,DOCK_APPS} from '../../constants';
function App(){const [theme,setTheme]=useState({skin:'default',wallpaper:'',contentColor:'#526b65',launcherMusicVisible:false,launcherImageVisible:false});return <OSPreviewProvider value={{customIcons:{},theme,updateTheme:(v:any)=>setTheme(t=>({...t,...v})),characters:[],groups:[],unreadMessages:{},virtualTime:{hours:12,minutes:30},userProfile:{name:'QA'},apiConfig:{},realtimeConfig:{},openApp:(id:string)=>{(window as any).__clicked=id;},isDataLoaded:false} as any}><MusicProvider><Launcher staticPreview/></MusicProvider></OSPreviewProvider>;}
(window as any).__expectedApps=INSTALLED_APPS.filter(a=>!DOCK_APPS.includes(a.id)&&a.id!=='char_creator_dev').map(a=>a.id);
createRoot(document.getElementById('root')!).render(<App/>);
