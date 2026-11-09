import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import {
  isAwayCloudRoute, runLocalAwayMessages, syncCloudAwayTask, cancelCloudAwayTasks,
  pauseCloudAwaySyncForSettings, resumeCloudAwaySyncForSettings, waitForCloudAwaySync,
  isLatestCloudAwaySettings, enqueueCloudAwaySettingsUpdate,
} from './awayMessage';
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
  char, lastCharAt: NOW - 12 * HOUR,
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

  it('foreground one-shot check builds a missing cloud loop from last Char reply', async () => {
    const char = makeChar();
    vi.spyOn(DB, 'getRecentMessagesByCharId').mockResolvedValue([{
      id: 1, charId: char.id, role: 'assistant', type: 'text', content: '早安', timestamp: NOW - 5 * HOUR,
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
      id: 1, charId: char.id, role: 'assistant', type: 'text', content: '在吗', timestamp: NOW - 5 * HOUR,
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
      id: 1, charId: char.id, role: 'assistant', type: 'text', content: '晚安', timestamp: NOW - 5 * HOUR,
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

  it('concurrent first-task bootstrap holds the lock before async Worker probes', async () => {
    const deps = createDeps(makeChar());
    const first = syncCloudAwayTask(deps, { seedOnly: true });
    const second = syncCloudAwayTask(deps, { seedOnly: true });
    expect(await Promise.all([first, second])).toEqual([true, false]);
    expect(ActiveMsgClient.listRemoteTasksForChar).toHaveBeenCalledOnce();
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();
  });

  it('Char 12:00 回复、用户 13:00 单独留言时下一次仍是 14:00', async () => {
    const char = makeChar();
    char.awayMessage!.delayMinutes = 120;
    const deps = { ...createDeps(char), lastCharAt: NOW - 40 * 60_000 };
    vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockResolvedValue([{
      uuid: 'away-keep', clientTaskId: 'away-away-keep', status: 'pending',
      nextSendAt: new Date(NOW + 80 * 60_000).toISOString(),
    }] as any);
    await syncCloudAwayTask(deps);
    expect(ActiveMsgClient.updatePendingTasksRemote).not.toHaveBeenCalled();
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
  });

  it('rapid Char reply anchors coalesce to latest activity instead of losing the rearm', async () => {
    const deps = createDeps(makeChar());
    // 第一次只会创建一条，随后最新的用户消息会重新读取那条并推迟。
    vi.mocked(ActiveMsgClient.listRemoteTasksForChar)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        uuid: 'new-away-uuid', clientTaskId: 'away-new-away-uuid', status: 'pending',
        nextSendAt: new Date(NOW + 60_000).toISOString(),
      }] as any);
    const first = syncCloudAwayTask({ ...deps, lastCharAt: NOW - 5 * HOUR });
    const latest = syncCloudAwayTask({ ...deps, lastCharAt: NOW });
    expect(await latest).toBe(false); // 在前一轮网络读写中，先登记最新发言。
    expect(await first).toBe(true);
    await vi.waitFor(() => expect(ActiveMsgClient.updatePendingTasksRemote).toHaveBeenCalledOnce());
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();
    expect(ActiveMsgClient.listRemoteTasksForChar).toHaveBeenCalledTimes(2);
    expect(ActiveMsgClient.updatePendingTasksRemote).toHaveBeenCalledWith(
      ['new-away-uuid'], { nextSendAt: new Date(NOW + 4 * HOUR).toISOString() },
    );
  });

  it('closing while remote scheduling is in flight waits and cancels the actual new UUID', async () => {
    const char = makeChar();
    const deps = createDeps(char);
    let finishSchedule!: (result: any) => void;
    vi.mocked(ActiveMsgClient.scheduleCharacterTask).mockImplementationOnce(
      () => new Promise(resolve => { finishSchedule = resolve; }),
    );
    vi.mocked(ActiveMsgClient.listRemoteTasksForChar)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        uuid: 'late-away', clientTaskId: 'away-late-away', status: 'pending',
        nextSendAt: new Date(NOW + 4 * HOUR).toISOString(),
      }] as any);
    const start = syncCloudAwayTask(deps);
    await vi.waitFor(() => expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce());
    const epoch = pauseCloudAwaySyncForSettings(char.id);
    const cancelling = cancelCloudAwayTasks(char, deps.updateCharacter);
    await Promise.resolve();
    // 取消任务不能只看建链前的空清单；须等刚才的排程请求完成。
    expect(ActiveMsgClient.listRemoteTasksForChar).toHaveBeenCalledOnce();
    finishSchedule({ uuid: 'late-away', clientTaskId: 'away-late-away', firstSendAt: new Date(NOW + 4 * HOUR).toISOString() });
    expect(await start).toBe(false);
    await cancelling;
    expect(ActiveMsgClient.cancelTask).toHaveBeenCalledOnce();
    expect(ActiveMsgClient.cancelTask).toHaveBeenCalledWith('late-away');
    // 已经关掉的角色不能被旧的成功回执写回一条本地幽灵任务。
    expect(deps.updateCharacter).toHaveBeenCalledOnce();
    const filtered = deps.updateCharacter.mock.calls[0][1];
    expect(filtered({ activeMsg2Config: { enabled: false, tasks: [] } } as any)
      .activeMsg2Config.tasks).toEqual([]);
    resumeCloudAwaySyncForSettings(char.id, epoch);
  });

  it('old pending user rearm is discarded after settings change, never creates another old-interval chain', async () => {
    const char = makeChar();
    const deps = createDeps(char);
    let finishSchedule!: (result: any) => void;
    vi.mocked(ActiveMsgClient.scheduleCharacterTask).mockImplementationOnce(
      () => new Promise(resolve => { finishSchedule = resolve; }),
    );
    const start = syncCloudAwayTask({ ...deps, lastCharAt: NOW - 5 * HOUR });
    await vi.waitFor(() => expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce());
    await syncCloudAwayTask({ ...deps, lastCharAt: NOW });
    const epoch = pauseCloudAwaySyncForSettings(char.id);
    finishSchedule({ uuid: 'old-away', clientTaskId: 'away-old-away', firstSendAt: new Date(NOW + 4 * HOUR).toISOString() });
    expect(await start).toBe(false);
    await waitForCloudAwaySync(char.id);
    await Promise.resolve();
    expect(ActiveMsgClient.listRemoteTasksForChar).toHaveBeenCalledOnce();
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();
    resumeCloudAwaySyncForSettings(char.id, epoch);
  });

  it('rapid settings changes remain serialized and only the latest can resume cloud activity', async () => {
    const char = makeChar();
    const order: string[] = [];
    let finishFirst!: () => void;
    const firstEpoch = pauseCloudAwaySyncForSettings(char.id);
    const first = enqueueCloudAwaySettingsUpdate(char.id, async () => {
      order.push('first-start');
      await new Promise<void>(resolve => { finishFirst = resolve; });
      order.push('first-end');
    });
    await vi.waitFor(() => expect(order).toEqual(['first-start']));
    const secondEpoch = pauseCloudAwaySyncForSettings(char.id);
    const second = enqueueCloudAwaySettingsUpdate(char.id, async () => {
      order.push('second-start');
      expect(isLatestCloudAwaySettings(char.id, firstEpoch)).toBe(false);
      expect(isLatestCloudAwaySettings(char.id, secondEpoch)).toBe(true);
    });
    resumeCloudAwaySyncForSettings(char.id, firstEpoch);
    expect(await syncCloudAwayTask(createDeps(char))).toBe(false);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    resumeCloudAwaySyncForSettings(char.id, secondEpoch);
    expect(await syncCloudAwayTask(createDeps(char), { seedOnly: true })).toBe(true);
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledOnce();
  });

  it('can retry cancellation of a remote away chain even when local away toggle is already off', async () => {
    const char = makeChar();
    char.awayMessage!.enabled = false;
    vi.mocked(ActiveMsgClient.listRemoteTasksForChar).mockResolvedValue([{
      uuid: 'orphan-away', clientTaskId: 'away-orphan-away', status: 'pending',
      nextSendAt: new Date(NOW + HOUR).toISOString(),
    }, {
      uuid: 'keep-appointment', clientTaskId: 'user-appointment', status: 'pending',
      nextSendAt: new Date(NOW + HOUR).toISOString(),
    }] as any);
    const updated = vi.fn();
    await cancelCloudAwayTasks(char, updated);
    expect(ActiveMsgClient.cancelTask).toHaveBeenCalledOnce();
    expect(ActiveMsgClient.cancelTask).toHaveBeenCalledWith('orphan-away');
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
