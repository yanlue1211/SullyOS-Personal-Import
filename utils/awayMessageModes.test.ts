import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { runLocalAwayMessages } from './awayMessage';
import { safeFetchJson } from './safeApi';
import { applyAssistantPostProcessing } from './applyAssistantPostProcessing';

vi.mock('./activeMsgClient', () => ({ ActiveMsgClient: {} }));
vi.mock('./amsg2ToolBridge', () => ({ isAmsg2GlobalReady: vi.fn(async () => false) }));
vi.mock('../context/MusicContext', () => ({ loadMusicPlaybackSnapshot: () => null }));
vi.mock('./safeApi', async original => ({
  ...await original<typeof import('./safeApi')>(), safeFetchJson: vi.fn(),
}));
vi.mock('./applyAssistantPostProcessing', () => ({ applyAssistantPostProcessing: vi.fn() }));

const NOW = Date.parse('2026-11-07T12:00:00Z');
let serial = 0;
let char: CharacterProfile;
let rows: Message[];

beforeEach(() => {
  vi.clearAllMocks();
  // Node 环境隔离测试，避免 jsdom 与 Node 24 undici 的 DecompressionStream 冲突。
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  vi.stubGlobal('CustomEvent', class {
    constructor(public type: string, public options?: unknown) {}
  });
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  char = {
    id: `away-modes-${serial++}`, name: '阿一',
    awayMessage: { enabled: true, delayMinutes: 90 },
    contextRangePolicyVersion: 1, contextRangeMode: 'manual', contextLimit: 10,
  } as CharacterProfile;
  rows = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1, charId: char.id, role: i % 2 ? 'assistant' : 'user',
    type: 'text', timestamp: NOW - 8 * 3600_000 + i * 1000,
    content: `HISTORY_${i + 1}_END`,
  }));
  vi.spyOn(DB, 'ensureHomeContextMessages').mockResolvedValue(undefined);
  vi.spyOn(DB, 'getRecentMessagesByCharId').mockImplementation(async (_charId, limit) => rows.slice(-limit));
  vi.spyOn(DB, 'getMessagesFromId').mockImplementation(async (_id, fromId) => ({
    messages: rows.filter(m => m.id >= fromId), totalCount: rows.length,
  }));
  vi.spyOn(DB, 'getEmojis').mockResolvedValue([]);
  vi.spyOn(DB, 'getEmojiCategories').mockResolvedValue([]);
  vi.mocked(applyAssistantPostProcessing).mockResolvedValue(undefined as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const run = async () => runLocalAwayMessages({
  getCharacters: () => [char],
  updateCharacter: vi.fn(),
  getApiConfig: () => ({ baseUrl: 'https://fixture.invalid/v1', apiKey: '', model: 'fixture' } as any),
  getUserProfile: () => ({ name: '小明' } as any),
  getGroups: () => [], getRealtimeConfig: () => ({} as any),
  isBusyWith: () => false,
});

describe('author local away mode vs personal 2.0 B mode', () => {
  it('2.0 OFF: author original one-shot up to three simulated messages, with original distributed timestamps', async () => {
    vi.mocked(safeFetchJson).mockResolvedValue({ choices: [{ message: {
      content: '第1次联系\n[[NEXT]]\n第2次联系\n[[NEXT]]\n第3次联系',
    } }] });
    await run();
    expect(safeFetchJson).toHaveBeenCalledOnce();
    const args = JSON.parse(String(vi.mocked(safeFetchJson).mock.calls[0][1]?.body));
    const fullPrompt = args.messages.map((m: any) => String(m.content)).join('\n');
    expect(fullPrompt).toContain('请把这 3 次按时间先后分别写出来');
    expect(fullPrompt).toContain('随手拍的照片');
    expect(fullPrompt).not.toContain('[[SILENT]]');
    expect(applyAssistantPostProcessing).toHaveBeenCalledTimes(3);
    const writes = vi.mocked(applyAssistantPostProcessing).mock.calls;
    expect(writes.map(([text]) => text)).toEqual(['第1次联系', '第2次联系', '第3次联系']);
    const moments = writes.map(([,opts]) => opts.messageTimestamp!);
    expect(moments[0]).toBeLessThan(moments[1]);
    expect(moments[1]).toBeLessThan(moments[2]);
    expect(moments[2]).toBeLessThan(NOW);
    // 作者的原生一次性标记：同一次离开已补过之后不能再补。
    rows.push({ id: 13, charId: char.id, role: 'assistant', type: 'text',
      content: '第3次联系', timestamp: NOW, metadata: { awayMessage: true } });
    await run();
    expect(safeFetchJson).toHaveBeenCalledOnce();
  });

  it('2.0 ON without Worker: keep personal local B tick, one chance, silence once per tick', async () => {
    char.activeMsg2Config = { enabled: true, tasks: [] } as any;
    vi.mocked(safeFetchJson).mockResolvedValue({ choices: [{ message: { content: '[[SILENT]]' } }] });
    await run();
    expect(safeFetchJson).toHaveBeenCalledOnce();
    const args = JSON.parse(String(vi.mocked(safeFetchJson).mock.calls[0][1]?.body));
    const fullPrompt = args.messages.map((m: any) => String(m.content)).join('\n');
    expect(fullPrompt).toContain('现在是你可以主动');
    expect(fullPrompt).toContain('[[SILENT]]');
    expect(fullPrompt).not.toContain('请把这 3 次');
    expect(applyAssistantPostProcessing).not.toHaveBeenCalled();
    await run();
    expect(safeFetchJson).toHaveBeenCalledOnce();
  });

  it('no away feature enabled: neither native nor B makes a model request', async () => {
    char.awayMessage = { enabled: false, delayMinutes: 90 };
    await run();
    expect(safeFetchJson).not.toHaveBeenCalled();
  });
});
