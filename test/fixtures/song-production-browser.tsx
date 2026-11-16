import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OSPreviewProvider} from '../../context/OSContext';
import {MusicProvider} from '../../context/MusicContext';
import SongwritingApp from '../../apps/SongwritingApp';
import {DB} from '../../utils/db';
import {parseLyrics} from '../../features/songwriting/model';
import {mergeVocalReply} from '../../features/songwriting/melody';
import {vocalTarget} from '../../features/songwriting/vocalMelody';
const char={id:'vocal-qa',name:'阿源',systemPrompt:'自然交流',memories:[],worldbooks:[]};
const song:any={id:'vocal-song',title:'晚风试唱',genre:'folk',mood:'free',collaboratorId:char.id,lines:parseLyrics('[verse]\n你把月光折成信\n晚风带我回到你身边','user'),comments:[],status:'draft',coverStyle:'forest',createdAt:1,lastActiveAt:1};
const v=mergeVocalReply(song,undefined,{reply:'第一段',bpm:84,phrases:song.lines.map((l:any)=>({lineId:l.id,bars:[{notes:[{pitch:'C4',beats:1,lyric:'你'},{pitch:'E4',beats:1},{pitch:'G4',beats:2}]}]}))},vocalTarget(song,'song'));
song.melody={activeId:v.id,versions:[v]};await DB.saveCharacter(char as any);await DB.saveSong(song);
// Visual notation stub: no external script, soundfont or paid API in this UI fixture.
(window as any).ABCJS={renderAbc:(target:any)=>{if(target instanceof HTMLElement)target.innerHTML='<svg viewBox="0 0 400 80"><path d="M10 15H390 M10 25H390 M10 35H390 M10 45H390 M10 55H390" stroke="#6b8d7e" fill="none"/><text x="20" y="40" fill="#34574e">♪  ♫  ♪</text></svg>';return [{}];},synth:{CreateSynth:function(){}}};
function App(){const [songs,setSongs]=useState([song]);return <OSPreviewProvider value={{songs,characters:[char],apiConfig:{baseUrl:'https://qa-vocal.invalid/v1',apiKey:'TEST-ONLY',model:'qa',aceStepApiKey:'TEST-ONLY'},userProfile:{name:'你'},groups:[],characterGroups:[],realtimeConfig:{},lastMsgTimestamp:0,addToast:()=>{},closeApp:()=>{},openApp:()=>{},addSong:async(s:any)=>{await DB.saveSong(s);setSongs(a=>[...a,s]);},updateSong:async(id:string,patch:any)=>{const next={...(await DB.getAllSongs()).find(s=>s.id===id),...patch};await DB.saveSong(next as any);setSongs(a=>a.map(s=>s.id===id?next:s));},deleteSong:()=>{}} as any}><MusicProvider><SongwritingApp/></MusicProvider></OSPreviewProvider>}
createRoot(document.getElementById('root')!).render(<App/>);
