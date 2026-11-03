// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const state=vi.hoisted(()=>({value:{} as any}));vi.mock('../context/OSContext',()=>({useOS:()=>state.value}));
import IncomingCallOverlay from '../features/personal/calls/IncomingCallOverlay';
import {requestIncomingCall,takeIncomingCallLaunch} from '../features/personal/calls/incoming';
import {DB} from './db';import {AppID} from '../types';
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');vi.stubGlobal('AudioContext',class{state='suspended';resume=async()=>{};close=async()=>{};});});afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shows a granted video invitation and requires an explicit answer before navigation',async()=>{
 const char={id:'incoming-ui',name:'阿源',allowIncomingVideoCalls:true} as any;await DB.saveCharacter(char);const openApp=vi.fn(),setActiveCharacterId=vi.fn();state.value={characters:[char],activeApp:AppID.Chat,suspendedCall:null,openApp,setActiveCharacterId,addToast:vi.fn()};
 await requestIncomingCall(char.id,'video');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(<IncomingCallOverlay/>));
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('视频来电');expect(openApp).not.toHaveBeenCalled();
 await act(async()=>{const accept=[...document.querySelectorAll('button')].find(button=>button.textContent==='接听');accept!.click();await new Promise(resolve=>setTimeout(resolve,40));});
 expect(setActiveCharacterId).toHaveBeenCalledWith(char.id);expect(openApp).toHaveBeenCalledWith(AppID.Call);expect(takeIncomingCallLaunch()?.mode).toBe('video');await act(async()=>root.unmount());host.remove();
});
it('decline leaves the app in place and permits the same character to call again immediately',async()=>{
 const char={id:'incoming-repeat-ui',name:'阿源',allowIncomingVoiceCalls:true} as any;await DB.saveCharacter(char);const openApp=vi.fn();state.value={characters:[char],activeApp:AppID.Chat,suspendedCall:null,openApp,setActiveCharacterId:vi.fn(),addToast:vi.fn()};
 await requestIncomingCall(char.id,'voice');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(<IncomingCallOverlay/>));
 await act(async()=>{[...document.querySelectorAll('button')].find(button=>button.textContent==='拒接')!.click();await new Promise(resolve=>setTimeout(resolve,40));});
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(openApp).not.toHaveBeenCalled();
 await act(async()=>{expect(await requestIncomingCall(char.id,'voice')).toBe('ringing');});expect(document.querySelector('[role="dialog"]')?.textContent).toContain('语音来电');
 await act(async()=>root.unmount());host.remove();
});
