// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {useVocalPlayback} from '../components/song/useVocalPlayback';
import {mergeVocalReply} from '../features/songwriting/melody';
import {vocalTarget} from '../features/songwriting/vocalMelody';
const render=vi.hoisted(()=>vi.fn());
vi.mock('../features/songwriting/melodyAudio',()=>({renderMelodyAudio:render}));
it('pauses and resumes the existing source, then resets when playback ends',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const source={connect:vi.fn(),start:vi.fn(),onended:null as null|(()=>void),buffer:null};
 const audio={resume:vi.fn().mockResolvedValue(undefined),suspend:vi.fn().mockResolvedValue(undefined),close:vi.fn().mockResolvedValue(undefined),decodeAudioData:vi.fn().mockResolvedValue({}),createBufferSource:vi.fn(()=>source),destination:{}};
 const constructor=vi.fn(function(){return audio;});vi.stubGlobal('AudioContext',constructor);
 render.mockResolvedValue({wav:{arrayBuffer:async()=>new ArrayBuffer(8)}});
 const song:any={id:'pause',lines:[{id:'a',content:'想你',section:'verse'}]};
 const target=vocalTarget(song,'line',0),version=mergeVocalReply(song,undefined,{reply:'好了',bpm:84,phrases:[{lineId:'a',bars:[{notes:[{pitch:'C4',beats:4}]}]}]},target);
 song.melody={activeId:version.id,versions:[version]};
 let playback!:ReturnType<typeof useVocalPlayback>;
 function Harness(){playback=useVocalPlayback(song);return null;}
 const node=document.createElement('div'),root=createRoot(node);
 try{
  await act(async()=>root.render(<Harness/>));
  await act(async()=>playback.play(target));expect(playback.statusFor(target)).toBe('playing');
  await act(async()=>playback.play(target));expect(playback.statusFor(target)).toBe('paused');expect(audio.suspend).toHaveBeenCalledOnce();
  await act(async()=>playback.play(target));expect(playback.statusFor(target)).toBe('playing');expect(audio.resume).toHaveBeenCalledTimes(2);
  expect(constructor).toHaveBeenCalledOnce();expect(source.start).toHaveBeenCalledOnce();expect(render).toHaveBeenCalledOnce();
  await act(async()=>source.onended?.());expect(playback.statusFor(target)).toBe('idle');expect(audio.close).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
