import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { runLocalAwayMessages, syncCloudAwayTask } from './awayMessage';
import type { CharacterProfile } from '../types';

vi.mock('./activeMsgClient', () => ({ ActiveMsgClient: {
  probeWorkerVersion: vi.fn(async () => ({ state: 'current' })),
  listRemoteTasksForChar: vi.fn(async () => []),
  scheduleCharacterTask: vi.fn(async (input: { task: { firstSendTime: string } }) => ({
    uuid: 'new-away-uuid', clientTaskId: 'away-new-away-uuid', firstSendAt: input.task.firstSendTime,
  })),
  updatePendingTasksRemote: vi.fn(async () => ({ updated: 1, failed: [] })),
  cancelTask: vi.fn(async () => {}),
} }));
vi.mock('./activeMsgStore', () => ({ ActiveMsgStore: {
  getGlobalConfig: vi.fn(async () => ({ workerUrl: 'https://worker.example', userId: 'test-user' })),
} }));
vi.mock('./amsg2ToolBridge', () => ({ isAmsg2GlobalReady: vi.fn(async () => true) }));
vi.mock('../context/MusicContext', () => ({ loadMusicPlaybackSnapshot: () => null }));

const HOUR = 3600_000;
const NOW = Date.parse('2026-11-08T08:40:00Z');
let serial = 0;
const makeChar = () => ({
  id: 'away-cloud-seed-' + serial++, name: '朋友',
  activeMsg2Config: { enabled: true, tasks: [] },
  awayMessage: { enabled: true, delayMinutes: 240 },
}) as unknown as CharacterProfile;

const createDeps = (char: CharacterProfile) => ({
  char, lastUserAt: NOW - 12 * HOUR,
  userProfile: { name: '用户' } as any,
  groups: [], realtimeConfig: {} as any, apiConfig: {} as any,
  updateCharacter: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.mocked(ActiveMsgStore.getGlobalConfig).mockResolvedValue({ workerUrl: 'https://worker.example', userId: 'test-user' } as any);
  vi.mocked(ActiveMsgClient.probeWorkerVersion).mockResolvedValue({ state: 'current' } as any);
  vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('cloud away first-task creation and passive repair', () => {
  it('saving or opening without a pending loop seeds only a future opportunity, never an immediate paid catch-up', async () => {
    const deps = createDeps(makeChar());
    const result = await syncCloudAwayTask(deps, { seedOnly: true });
    expect(result).toBe(true);
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();
    const task = vi.mocked(ActiveMsgClient.scheduleCharacterTask).mock.calls[0][0].task;
    expect(Date.parse(task.firstSendTime)).toBe(NOW + 4 * HOUR);
    expect(task.mode).toBe('auto');
    expect(task.away).toEqual({ delayMinutes: 240 });
  });

  it('keeps an existing live future task without postponing it on app open', async () => {
    const deps = createDeps(makeChar());
    vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockResolvedValue([{
      uuid: 'old-away-uuid', clientTaskId: 'away-old-away-uuid', status: 'pending',
      nextSendAt: new Date(NOW + HOUR).toISOString(),
    }] as any);
    const result = await syncCloudAwayTask(deps, { seedOnly: true });
    expect(result).toBe(true);
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
    expect(ActiveMsgClient.updatePendingTasksRemote).not.toHaveBeenCalled();
  });

  it('foreground one-shot check builds a missing cloud loop from real user message history', async () => {
    const char = makeChar();
    vi.spyOn(DB, 'getRecentMessagesByCharId').mockResolvedValue([{
      id: 1, charId: char.id, role: 'user', type: 'text', content: '早安', timestamp: NOW - 5 * HOUR,
    }] as any);
    const updateCharacter = vi.fn();
    const deps = {
      getCharacters: () => [char], updateCharacter,
      getApiConfig: () => ({} as any), getUserProfile: () => ({ name: '用户' } as any),
      getGroups: () => [], getRealtimeConfig: () => ({} as any), isBusyWith: () => false,
    };
    await runLocalAwayMessages(deps);
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();
    const first = vi.mocked(ActiveMsgClient.scheduleCharacterTask).mock.calls[0][0].task;
    expect(Date.parse(first.firstSendTime)).toBe(NOW + 4 * HOUR);
    await runLocalAwayMessages(deps);
    expect(ActiveMsgClient.listRemoteTasksForChar).toHaveBeenCalledOnce();
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();
  });

  it('does not create paid activity for a character with no prior real user message', async () => {
    const char = makeChar();
    vi.spyOn(DB, 'getRecentMessagesByCharId').mockResolvedValue([] as any);
    await runLocalAwayMessages({
      getCharacters: () => [char], updateCharacter: vi.fn(),
      getApiConfig: () => ({} as any), getUserProfile: () => ({ name: '用户' } as any),
      getGroups: () => [], getRealtimeConfig: () => ({} as any), isBusyWith: () => false,
    });
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
  });
});
