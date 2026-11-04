// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import InnerVoiceSettings from '../features/personal/innerVoice/InnerVoiceSettings';
it('saves independent preferences without clearing the prompt when generation is disabled', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const save=vi.fn(),close=vi.fn();
  await act(async()=>root.render(<InnerVoiceSettings character={{id:'a',innerVoiceCustomPrompt:'最多80字'} as any} onSave={save} onClose={close}/>));
  const switches=host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(switches).toHaveLength(3);expect([...switches].every(input=>input.checked)).toBe(true);
  await act(async()=>{switches[0].click();switches[1].click();});
  expect(host.querySelector('textarea')?.value).toBe('最多80字');
  expect(save).not.toHaveBeenCalled();
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='保存')!.click());
  expect(save).toHaveBeenCalledWith({innerVoiceEnabled:false,innerVoiceContextEnabled:false,innerVoiceMemoryEnabled:true,innerVoiceCustomPrompt:'最多80字'});
  expect(close).toHaveBeenCalledOnce();await act(async()=>root.unmount());host.remove();
});
