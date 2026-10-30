// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import InnerVoiceChip from '../features/personal/innerVoice/InnerVoiceChip';
import RecordingEditTrigger from '../features/personal/chatMedia/RecordingEditTrigger';
it('keeps heart content collapsed, opens a dialog, omits empty dark feelings and closes on Escape', async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(React.createElement(InnerVoiceChip,{value:{state:'放下画笔',thoughts:'总算能休息了',undercurrent:''}})));
 expect(document.querySelector('[aria-label="角色心声"]')).toBeNull();
 await act(async()=>host.querySelector('button')!.click());
 const modal=document.querySelector('[aria-label="角色心声"]')!;
 expect(modal.textContent).toContain('总算能休息了');expect(modal.textContent).not.toContain('暗流');
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
 expect(document.querySelector('[aria-label="角色心声"]')).toBeNull();await act(async()=>root.unmount());host.remove();
});
it('opens two independent editable fields from a recording context press',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(React.createElement(RecordingEditTrigger,{id:1,transcript:'我下班了',analysis:'语气平静',children:React.createElement('span',null,'声音细节')})));
 await act(async()=>host.firstElementChild!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));
 const areas=document.querySelectorAll('[aria-label="修改语音识别"] textarea');expect(areas).toHaveLength(2);expect((areas[0] as HTMLTextAreaElement).value).toBe('我下班了');expect((areas[1] as HTMLTextAreaElement).value).toBe('语气平静');
 await act(async()=>root.unmount());host.remove();
});
