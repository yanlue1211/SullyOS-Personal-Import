// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from '../features/personal/chatMedia/Composer';
let root: Root; let host: HTMLDivElement; let stopTrack = vi.fn();
let activeRecorder: FakeRecorder | undefined;
const onSend = vi.fn(async () => {});
class FakeRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
  constructor() { activeRecorder = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['voice']) }); this.onstop?.(); }
}
const press = async (type: string, key = ' ') => { await act(async () => host.querySelector('[aria-label="按住录音"]')!.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }))); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  activeRecorder = undefined; stopTrack = vi.fn(); onSend.mockClear();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe('hold-to-record composer', () => {
  it('records while held and produces a preview on release', async () => {
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'a', onSend })));
    await press('keydown'); expect(activeRecorder?.state).toBe('recording');
    await press('keyup'); expect(activeRecorder?.state).toBe('inactive');
    expect(stopTrack).toHaveBeenCalled(); expect(host.querySelector('audio')).not.toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });
  it('releases microphone and discards recording on conversation change', async () => {
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'a', onSend })));
    await press('keydown');
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'b', onSend })));
    expect(stopTrack).toHaveBeenCalled(); expect(activeRecorder?.state).toBe('inactive');
    expect(host.querySelector('audio')).toBeNull(); expect(onSend).not.toHaveBeenCalled();
  });
  it('does not start if the press ends before microphone permission arrives', async () => {
    let grant!: (value: any) => void;
    navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'a', onSend })));
    await press('keydown'); await press('keyup');
    await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] }));
    expect(stopTrack).toHaveBeenCalled(); expect(activeRecorder).toBeUndefined();
  });
  it('releases permission granted after the composer unmounts', async () => {
    let grant!: (value: any) => void;
    navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; }));
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'a', onSend })));
    await press('keydown'); await act(async () => root.render(null));
    await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] }));
    expect(stopTrack).toHaveBeenCalled();
  });
  it('switches to virtual voice on a right swipe and back on a left swipe', async () => {
    await act(async () => root.render(React.createElement(Composer, { conversationId: 'a', onSend })));
    const swipe = async (start: number, end: number) => { await act(async () => { const section = host.querySelector('section')!; section.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: start, clientY: 50 })); section.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: end, clientY: 50 })); }); };
    await swipe(20, 120); expect(host.querySelector('textarea')).not.toBeNull();
    await swipe(120, 20); expect(host.querySelector('textarea')).toBeNull();
  });
});
