// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('../features/personal/chatMedia/recording',()=>({recordingToWav:vi.fn(async()=>new Blob(['wav'],{type:'audio/wav'}))}));
vi.mock('./speechToText',()=>({resolveSttProvider:()=> 'minimax',startStt:vi.fn()}));
import HandsFreeCallControl from '../features/personal/calls/HandsFreeCallControl';
import {callHandsFreeWaitReason} from '../features/personal/calls/readiness';
let level=.1,start=vi.fn(),stopTrack=vi.fn();
class Recorder{
 static isTypeSupported=()=>true;state='inactive';mimeType='audio/webm';
 ondataavailable?:(e:any)=>void;onstop?:()=>void;
 start(){this.state='recording';start();}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});queueMicrotask(()=>this.onstop?.());}
}
class Context{
 resume=async()=>{};close=async()=>{};createMediaStreamSource=()=>({connect(){},disconnect(){}});
 createAnalyser=()=>({fftSize:2048,getFloatTimeDomainData:(samples:Float32Array)=>samples.fill(level)});
}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>Date.now());start=vi.fn();stopTrack=vi.fn();level=.1;
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop:stopTrack}]}))}});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('one enable click starts real capture with input hidden, silence submits once, reply completion restarts capture',async()=>{
 level=0;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let enabled=false,playing=false,generating=false;
 const send=vi.fn(async()=>{generating=true;render();});
 const render=()=>{const wait=callHandsFreeWaitReason({inCall:true,visible:true,modalOpen:false,generating,playbackActive:playing,manualRecording:false,transcribing:false,draft:''});root.render(<HandsFreeCallControl enabled={enabled} onEnabledChange={v=>{enabled=v;render();}} ready={!wait} waitReason={wait} sessionId="actual-recorder" inputMode="real" apiConfig={{}} onStart={()=>{}} onUtterance={send}/>);};
 await act(async()=>render());await act(async()=>host.querySelector('button')!.click());await act(async()=>{await vi.advanceTimersByTimeAsync(601);});
 expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();expect(start).toHaveBeenCalledOnce();expect(host.textContent).toContain('先安静半秒');
 await act(async()=>{await vi.advanceTimersByTimeAsync(700);});level=.1;await act(async()=>{await vi.advanceTimersByTimeAsync(700);});level=0;await act(async()=>{await vi.advanceTimersByTimeAsync(2500);});expect(send).toHaveBeenCalledOnce();expect(stopTrack).toHaveBeenCalledOnce();
 await act(async()=>{generating=false;playing=true;render();});await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(start).toHaveBeenCalledOnce();
 await act(async()=>{playing=false;render();});await act(async()=>{await vi.advanceTimersByTimeAsync(601);});expect(start).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('先安静半秒');
 await act(async()=>root.unmount());host.remove();
});
