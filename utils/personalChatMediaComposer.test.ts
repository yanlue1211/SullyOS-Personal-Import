// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from '../features/personal/chatMedia/Composer';

let root: Root;
let host: HTMLDivElement;
let stopTrack = vi.fn();
const onSend = vi.fn(async () => {});
let activeRecorder: FakeRecorder;
class FakeRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable?: (e: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor() { activeRecorder = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['voice']) }); this.onstop?.(); }
}
const click = async (label: string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  stopTrack = vi.fn();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe('recording lifecycle', () => {
  it('releases microphone and discards recording on conversation change', async () => {
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'a', onSend })));
    await click('语音 / 虚拟图片 / 视频'); await click('开始录音');
    expect(activeRecorder.state).toBe('recording');
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'b', onSend })));
    expect(stopTrack).toHaveBeenCalled(); expect(activeRecorder.state).toBe('inactive');
    expect(host.querySelector('audio')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });
  it('releases permission granted after the composer unmounts', async () => {
    let grant!: (stream: any) => void;
    navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'a', onSend })));
    await click('语音 / 虚拟图片 / 视频'); await click('开始录音');
    await act(async () => root.render(null));
    await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] }));
    expect(stopTrack).toHaveBeenCalled();
  });
});
