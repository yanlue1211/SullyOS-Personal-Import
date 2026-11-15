// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import VoiceClonePanel from '../components/song/VoiceClonePanel';
const mocks=vi.hoisted(()=>({create:vi.fn(async()=>{} )}));
vi.mock('../features/songwriting/voiceClone',()=>({loadVoiceClone:async()=>null,createVoiceClone:mocks.create,inspectVoiceClone:vi.fn(),mutateVoiceClone:vi.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it('upload confirmation avoids broken native browser confirm and cancellation sends nothing',async()=>{
 const native=vi.spyOn(window,'confirm').mockImplementation(()=>{throw Error('broken browser bridge');});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
 await act(async()=>root.render(<VoiceClonePanel charId="c" sample={new Blob(['sample'])} script="台词"/>));
 const click=async(text:string)=>{const b=[...host.querySelectorAll('button')].find(x=>x.textContent===text);expect(b).toBeTruthy();await act(async()=>b!.click());};
 await click('上传当前朗读，创建音色');expect(mocks.create).not.toHaveBeenCalled();await click('取消');expect(mocks.create).not.toHaveBeenCalled();await click('上传当前朗读，创建音色');await click('确认上传');expect(mocks.create).toHaveBeenCalledOnce();expect(native).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());host.remove();native.mockRestore();}
});
