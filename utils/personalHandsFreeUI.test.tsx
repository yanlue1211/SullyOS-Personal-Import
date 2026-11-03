// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
vi.mock('../features/personal/calls/handsFree',()=>({captureSpeechTurn:vi.fn(),captureBrowserSpeech:vi.fn(),abortError:()=>new DOMException('cancelled','AbortError')}));
vi.mock('./speechToText',()=>({resolveSttProvider:()=> 'minimax'}));
import HandsFreeCallControl from '../features/personal/calls/HandsFreeCallControl';
import {captureSpeechTurn} from '../features/personal/calls/handsFree';
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.stubGlobal('AudioContext',class{resume=vi.fn(async()=>{});close=vi.fn(async()=>{});});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('starts only after opt-in, aborts capture during playback, and ignores a late result after turning off',async()=>{
 const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 let enabled=false,ready=true,signal:AbortSignal|undefined,deliver:(value:any)=>void=()=>{};const send=vi.fn(async()=>{});
 vi.mocked(captureSpeechTurn).mockImplementation(async(_context,s)=>{signal=s;return new Promise(resolve=>deliver=resolve);});
 const render=()=>root.render(<HandsFreeCallControl enabled={enabled} onEnabledChange={value=>{enabled=value;render();}} ready={ready} sessionId="one" inputMode="real" apiConfig={{}} onStart={()=>{}} onUtterance={send}/>);
 await act(async()=>render());await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(captureSpeechTurn).not.toHaveBeenCalled();
 await act(async()=>{host.querySelector('button')!.click();});await act(async()=>{await vi.advanceTimersByTimeAsync(601);});expect(captureSpeechTurn).toHaveBeenCalledOnce();expect(signal?.aborted).toBe(false);
 await act(async()=>{ready=false;render();});expect(signal?.aborted).toBe(true);await act(async()=>deliver({audio:new Blob(['wav']),duration:1}));expect(send).not.toHaveBeenCalled();
 await act(async()=>{ready=true;render();});await act(async()=>{await vi.advanceTimersByTimeAsync(601);});expect(captureSpeechTurn).toHaveBeenCalledTimes(2);
 await act(async()=>{host.querySelector('button')!.click();});expect(signal?.aborted).toBe(true);await act(async()=>deliver({audio:new Blob(['wav']),duration:1}));expect(send).not.toHaveBeenCalled();
 await act(async()=>root.unmount());host.remove();
});
