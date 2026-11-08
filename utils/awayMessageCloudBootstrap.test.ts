import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { isAwayCloudRoute, runLocalAwayMessages, syncCloudAwayTask } from './awayMessage';
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
  it('离开后云端模式独立于预约开关：没有 2.0 config 也建立空闲任务，且不偷偷打开预约', async () => {
    const char = makeChar();
    delete (char as any).activeMsg2Config;
    expect(await isAwayCloudRoute(char)).toBe(true);
    const deps = createDeps(char);
    expect(await syncCloudAwayTask(deps, { seedOnly: true })).toBe(true);
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ enabled: false }),
      task: expect.objectContaining({ away: { delayMinutes: 240 } }),
    }));
    const updater = deps.updateCharacter.mock.calls[0][1];
    const update = updater({ id: char.id } as any);
    expect(update.activeMsg2Config.enabled).toBe(false);
    expect(update.activeMsg2Config.tasks[0].away).toBe(true);
  });
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

  it('later foreground resumes recheck and repair a cloud chain missing after initial success', async () => {
    const char = makeChar();
    vi.spyOn(DB, 'getRecentMessagesByCharId').mockResolvedValue([{
      id: 1, charId: char.id, role: 'user', type: 'text', content: '在吗', timestamp: NOW - 5 * HOUR,
    }] as any);
    const deps = {
      getCharacters: () => [char], updateCharacter: vi.fn(),
      getApiConfig: () => ({} as any), getUserProfile: () => ({ name: '用户' } as any),
      getGroups: () => [], getRealtimeConfig: () => ({} as any), isBusyWith: () => false,
    };
    await runLocalAwayMessages(deps);
    await runLocalAwayMessages(deps);
    expect(ActiveMsgClient.listRemoteTasksForChar).toHaveBeenCalledOnce();
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();

    // 同一 PWA 页面未重启，超过短暂冷却后再切回前台仍可修复失联任务。
    // 模拟 Worker 丢了第一条任务；补建的是未来节拍，不追补过去的旧机会。
    vi.mocked(Date.now).mockReturnValue(NOW + 16 * 60_000);
    await runLocalAwayMessages(deps);
    expect(ActiveMsgClient.listRemoteTasksForChar).toHaveBeenCalledTimes(2);
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledTimes(2);
    const repaired = vi.mocked(ActiveMsgClient.scheduleCharacterTask).mock.calls[1][0].task;
    expect(Date.parse(repaired.firstSendTime)).toBe(NOW + 16 * 60_000 + 4 * HOUR);
  });

  it('later foreground inspection keeps the existing future Worker task, without rearming or paying for AI', async () => {
    const char = makeChar();
    vi.spyOn(DB, 'getRecentMessagesByCharId').mockResolvedValue([{
      id: 1, charId: char.id, role: 'user', type: 'text', content: '晚安', timestamp: NOW - 5 * HOUR,
    }] as any);
    vi.mocked(ActiveMsgClient.listRemoteTasksForChar)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        uuid: 'existing-away', clientTaskId: 'away-existing-away', status: 'pending',
        nextSendAt: new Date(NOW + HOUR).toISOString(),
      }] as any);
    const deps = {
      getCharacters: () => [char], updateCharacter: vi.fn(),
      getApiConfig: () => ({} as any), getUserProfile: () => ({ name: '用户' } as any),
      getGroups: () => [], getRealtimeConfig: () => ({} as any), isBusyWith: () => false,
    };
    await runLocalAwayMessages(deps);
    vi.mocked(Date.now).mockReturnValue(NOW + 16 * 60_000);
    await runLocalAwayMessages(deps);
    expect(ActiveMsgClient.listRemoteTasksForChar).toHaveBeenCalledTimes(2);
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();
    expect(ActiveMsgClient.updatePendingTasksRemote).not.toHaveBeenCalled();
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
