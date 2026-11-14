// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {afterEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({call:vi.fn(),recover:vi.fn(),generate:vi.fn(),disconnect:vi.fn(),sync:vi.fn(),report:vi.fn(),connection:{token:'session',runtimeToken:'session',visible:true,epoch:1,busy:false,controller:null as AbortController|null}}));
vi.mock('../context/OSContext',()=>({useOS:()=>({activeApp:'tapnest'})}));
vi.mock('../features/tapnest/model',()=>({CHANGED:'tapnest-config-changed',loadConfig:async()=>({revision:'r',activeCharId:'a'})}));
vi.mock('../features/tapnest/bridge',()=>({call:m.call,connection:m.connection,recoverSession:m.recover,report:m.report,disconnect:m.disconnect,syncConfig:m.sync,validEvent:()=>true,changeForm:vi.fn(),STATE:'state'}));
vi.mock('../features/tapnest/generate',()=>({generatePet:m.generate}));
import Runtime from '../features/tapnest/Runtime';
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it('recovers polling without disconnecting, re-pairing or replaying paid generation',async()=>{
 vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;m.connection.token='session';m.connection.visible=true;m.sync.mockResolvedValue('r');m.generate.mockResolvedValue('回复');m.recover.mockResolvedValue(false);let watches=0;
 m.call.mockImplementation(async(path:string,_body:any,signal?:AbortSignal)=>{if(path==='/watch'){watches++;if(watches===1)throw new DOMException('wait','TimeoutError');if(watches===2)return {events:[{id:'one',kind:'text',revision:'r',charId:'a'}],visible:true};return new Promise((_,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason)));}return {accepted:true};});
 const div=document.createElement('div'),root=createRoot(div);await act(async()=>{root.render(React.createElement(Runtime));});expect(m.recover).toHaveBeenCalledOnce();expect(m.disconnect).not.toHaveBeenCalled();await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(m.generate).toHaveBeenCalledOnce();expect(m.call.mock.calls.filter(c=>c[0]==='/speech')).toHaveLength(1);expect(m.disconnect).not.toHaveBeenCalled();await act(async()=>{root.unmount();});
});
