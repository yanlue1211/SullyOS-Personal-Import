import {expect,it,vi} from 'vitest';
import {DB} from './db';
import {makeVersion} from '../features/songwriting/melody';
import {listenVocalRange} from '../features/songwriting/melodyListening';
import {vocalTarget} from '../features/songwriting/vocalMelody';
const state=vi.hoisted(()=>({render:vi.fn(),describe:vi.fn(),config:{enabled:true}}));
vi.mock('../features/songwriting/melodyAudio',()=>({renderMelodyAudio:(...a:any[])=>state.render(...a)}));
vi.mock('./audioApi',()=>({songAudioToPayload:async()=>({}),describeMelodyWithAudioApi:(...a:any[])=>state.describe(...a)}));
vi.mock('./songListening',()=>({loadAudioApiConfig:()=>state.config}));
it('character listening sends only the selected line/section/song; caches by immutable version and exact range',async()=>{
 const lines=[{id:'a',content:'第一句',section:'verse'},{id:'b',content:'第二句',section:'verse'},{id:'c',content:'副歌',section:'chorus'}] as any;
 const version={...makeVersion(Array.from({length:3},()=>({notes:[{pitch:'C4',beats:4}]})),84,'写好了'),phrases:lines.map((l:any,i:number)=>({id:'p'+i,lineId:l.id,lyricText:l.content,section:l.section,start:i,count:1}))};
 const song={id:'listen-ranges',collaboratorId:'c',lines,comments:[],melody:{activeId:version.id,versions:[version]}} as any;
 await DB.saveSong(song);state.render.mockResolvedValue({wav:new Blob(['test'])});state.describe.mockResolvedValue('客观音高与节奏');
 const one=vocalTarget(song,'line',1);let saved=await listenVocalRange(song,version,one);
 expect(state.render.mock.calls[0][0].bars).toHaveLength(1);expect(state.describe).toHaveBeenCalledTimes(1);
 const updated=(saved as any).melody.versions[0];await listenVocalRange(saved,updated,one);expect(state.describe).toHaveBeenCalledTimes(1);
 saved=await listenVocalRange(saved,updated,vocalTarget(song,'section',0));expect(state.render.mock.calls[1][0].bars).toHaveLength(2);
 await listenVocalRange(saved,(saved as any).melody.versions[0],vocalTarget(song,'song'));expect(state.render.mock.calls[2][0].bars).toHaveLength(3);
 expect(state.describe).toHaveBeenCalledTimes(3);
});
it('missing audio configuration never falls back to the character model',async()=>{
 state.config.enabled=false;state.render.mockClear();state.describe.mockClear();
 const version=makeVersion([{notes:[{pitch:'C4',beats:4}]}],84,'一小节');
 const song={id:'no-fallback',lines:[]} as any;
 await expect(listenVocalRange(song,version,vocalTarget(song,'song'))).rejects.toThrow('独立音频识别');
 expect(state.render).not.toHaveBeenCalled();expect(state.describe).not.toHaveBeenCalled();state.config.enabled=true;
});
