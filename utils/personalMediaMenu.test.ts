// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ChatInputArea from '../components/chat/ChatInputArea';
import MediaMessage from '../features/personal/chatMedia/MediaMessage';
it('offers two direct first-page actions and keeps occasional settings on page two', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const action = vi.fn();
  await act(async () => root.render(React.createElement(ChatInputArea, { personalMediaEnabled: true, input: '', setInput: () => {}, isTyping: false, selectionMode: false, showPanel: 'actions', setShowPanel: () => {}, onSend: () => {}, onDeleteSelected: () => {}, selectedCount: 0, emojis: [], onPanelAction: action, onImageSelect: () => {}, isSummarizing: false, onReroll: () => {}, canReroll: true })));
  const first = host.querySelector('[aria-label="聊天功能第 1 页"]')!;
  const second = host.querySelector('[aria-label="聊天功能第 2 页"]')!;
  const buttons = [...first.querySelectorAll('button')];
  expect(buttons.map(button => button.textContent).slice(0, 2)).toEqual(['语音', '图片／视频']);
  expect(first.textContent).not.toContain('协同工作'); expect(first.textContent).not.toContain('日程/情绪');
  expect(second.textContent).toContain('协同工作'); expect(second.textContent).toContain('日程/情绪');
  await act(async () => { buttons[0].click(); buttons[1].click(); });
  expect(action.mock.calls.map(call => call[0])).toEqual(['voice-input', 'virtual-media']);
  await act(async () => root.unmount()); host.remove();
});
it('shows only the original caption while analysis stays in closed details', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(React.createElement(MediaMessage, { message: { id: 1, charId: 'a', role: 'user', type: 'audio', content: '', timestamp: 0, metadata: { audioCleared: true, audioTranscript: '嗯，我下班了。', audioAnalysis: '语气轻松，有脚步声。' } } })));
  expect(host.querySelector('details')?.open).toBe(false);
  expect(host.querySelector('details')?.textContent).toContain('语气轻松');
  expect(host.querySelector('details')?.previousElementSibling?.textContent).toBe('嗯，我下班了。');
  await act(async () => root.unmount());
});
