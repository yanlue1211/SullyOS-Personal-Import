// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import VoiceCleanupPanel from '../components/settings/VoiceCleanupPanel';
const mocks=vi.hoisted(()=>({inspect:vi.fn(),clear:vi.fn()}));
vi.mock('./voiceCleanup',()=>({inspectAllVoices:mocks.inspect,clearAllVoices:mocks.clear}));
it('shows the full scope and estimate, cancellation never deletes speech and uses no native confirm',async()=>{
 mocks.inspect.mockResolvedValue({assets:[],recordings:[],inlineSessions:[],estimatedBytes:1024});
 const native=vi.spyOn(window,'confirm').mockImplementation(()=>{throw Error('broken host confirm');});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<VoiceCleanupPanel/>));
 expect(host.textContent).toContain('角色语音');expect(host.textContent).toContain('音乐与 BGM 保留');
 await act(async()=>host.querySelector('button')!.click());
 expect(host.textContent).toContain('1.0 KB');expect(host.textContent).toContain('收藏语音和未转写录音');
 const cancel=[...host.querySelectorAll('button')].find(b=>b.textContent==='取消')!;
 await act(async()=>cancel.click());expect(mocks.clear).not.toHaveBeenCalled();expect(native).not.toHaveBeenCalled();
 await act(async()=>root.unmount());host.remove();native.mockRestore();
});
