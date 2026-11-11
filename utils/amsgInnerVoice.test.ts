import { describe, expect, it, vi } from 'vitest';
import { extractInnerVoice } from '../features/personal/innerVoice/protocol';
import { restoreAmsgInnerVoice, stripAmsgInnerVoiceTransport } from './amsgInnerVoice';

const voice = { state: '候机', thoughts: '想睡了', undercurrent: '' };
describe('2.0 private voice transport', () => {
  it('restores structured voice at the shared parser boundary, not as spoken text', async () => {
    const read = vi.fn();
    const body = await restoreAmsgInnerVoice('落地找你', { amsgInnerVoice: voice }, read);
    expect(extractInnerVoice(body)).toEqual({ text: '落地找你\n', innerVoice: voice });
    expect(read).not.toHaveBeenCalled();
  });
  it('supports large offloaded JSON and attachment references', async () => {
    for (const metadata of [{ amsgInnerVoiceRef: 'voice:task' }, { amsgInnerVoiceAttachment: { id: 'one' } }]) {
      expect(extractInnerVoice(await restoreAmsgInnerVoice('到了', metadata, async () => JSON.stringify(voice))).innerVoice).toEqual(voice);
    }
  });
  it('keeps legacy inline voice once and tolerates invalid/missing transport', async () => {
    const body = `到了\n<心声>${JSON.stringify(voice)}</心声>`;
    const read = vi.fn();
    expect(await restoreAmsgInnerVoice(body, { amsgInnerVoice: voice }, read)).toBe(body);
    for (const raw of [null, 'bad json', '{"thoughts":"missing state"}']) {
      expect(await restoreAmsgInnerVoice('到了', { amsgInnerVoiceRef: 'one' }, async () => raw)).toBe('到了');
    }
    expect(read).not.toHaveBeenCalled();
  });
  it('does not copy private transport fields into persistent bubble metadata', () => {
    expect(stripAmsgInnerVoiceTransport({ amsgInnerVoice: voice, amsgInnerVoiceRef: 'x', amsgInnerVoiceAttachment: {}, charId: 'one', directives: [] })).toEqual({ charId: 'one', directives: [] });
  });
});
