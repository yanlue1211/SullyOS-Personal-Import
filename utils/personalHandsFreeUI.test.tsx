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
it('automatically starts the microphone after response completion, sends one captured turn, and rearms after the reply',async()=>{
 const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 let enabled=false,ready=false,resolveCapture:(value:any)=>void=()=>{},signal:AbortSignal|undefined;
 let finishReply:()=>void=()=>{};const send=vi.fn(()=>new Promise<void>(resolve=>{finishReply=resolve;}));
 vi.mocked(captureSpeechTurn).mockImplementation(async(_ctx,s,options)=>{signal=s;options?.onStarted?.(()=>{});return new Promise(resolve=>resolveCapture=resolve);});
 const render=()=>root.render(<HandsFreeCallControl enabled={enabled} onEnabledChange={v=>{enabled=v;render();}} ready={ready} waitReason={ready?'':'等待对方回应'} sessionId="automatic" inputMode="real" apiConfig={{}} onStart={()=>{}} onUtterance={send}/>);
 const initial=vi.mocked(captureSpeechTurn).mock.calls.length;
 await act(async()=>render());await act(async()=>host.querySelector('button')!.click());await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(captureSpeechTurn).toHaveBeenCalledTimes(initial);
 await act(async()=>{ready=true;render();await vi.advanceTimersByTimeAsync(1);});await act(async()=>{await vi.advanceTimersByTimeAsync(601);});
 expect(host.textContent).toContain('正在听你说');expect(signal?.aborted).toBe(false);
 await act(async()=>resolveCapture({audio:new Blob(['wav']),duration:2}));expect(send).toHaveBeenCalledOnce();
 await act(async()=>{ready=false;render();});await act(async()=>finishReply());
 await act(async()=>{ready=true;render();});await act(async()=>{await vi.advanceTimersByTimeAsync(601);});expect(captureSpeechTurn).toHaveBeenCalledTimes(initial+2);expect(host.textContent).toContain('正在听你说');
 await act(async()=>root.unmount());host.remove();
});

it('shows silence countdown and finishes the current turn without disabling hands-free',async()=>{
 const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 let enabled=true,progress:any,complete:(v:any)=>void=()=>{};const finish=vi.fn(()=>complete({audio:new Blob(['wav']),duration:1})),send=vi.fn(async()=>{}),onToggle=vi.fn();
 vi.mocked(captureSpeechTurn).mockImplementation(async(_ctx,_signal,options)=>{options?.onStarted?.(finish);progress=options?.onProgress;return new Promise(resolve=>complete=resolve);});
 await act(async()=>root.render(<HandsFreeCallControl enabled={enabled} onEnabledChange={onToggle} ready sessionId="finish" inputMode="real" apiConfig={{}} onStart={()=>{}} onUtterance={send}/>));
 await act(async()=>{await vi.advanceTimersByTimeAsync(601);});
 await act(async()=>progress({state:'pausing',remainingMs:1200}));expect(host.textContent).toContain('2 秒后发送');
 await act(async()=>progress({state:'interrupted'}));expect(host.textContent).toContain('停顿检测暂停');expect(host.textContent).toContain('说完了');
 await act(async()=>progress({state:'speaking'}));expect(host.textContent).toContain('听到你在说话');expect(host.textContent).not.toContain('2 秒后发送');
 await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='说完了')!.click();});
 expect(finish).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledOnce();expect(onToggle).not.toHaveBeenCalled();
 await act(async()=>root.unmount());host.remove();
});
