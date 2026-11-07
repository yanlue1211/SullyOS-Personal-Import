import { afterEach, describe, expect, it, vi } from 'vitest';
import { diffCloudOwners, findCloudOwnerConflicts } from './amsgOwnerReconcile';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { CloudDataError } from './amsgCloudData';
import { pendingCloudRetirements } from './amsgCloudRetirement';

vi.mock('./activeMsgClient', () => ({
  ActiveMsgClient: { openCloudDataSession: vi.fn() },
}));
vi.mock('./activeMsgStore', () => ({
  ActiveMsgStore: { getGlobalConfig: vi.fn() },
}));
vi.mock('./amsgCloudRetirement', () => ({
  pendingCloudRetirements: vi.fn().mockReturnValue([]),
}));
afterEach(() => vi.restoreAllMocks());
const owner = (id: string, retired: boolean, generation: number, type = 'character') =>
  ({ owner: { type, id }, retired, generation });
const chars = [{ id: 'a', name: '阿一' }, { id: 'b', name: '阿二' }, { id: 'c', name: '阿三' }];
describe('云端角色只读对账', () => {
  it('区分云端停用和代次错位，过滤未登记/其它类型的角色及正在删除者', () => {
    expect(diffCloudOwners(chars, [
      owner('a', true, 1), owner('b', false, 2), owner('c', false, 0),
      owner('a', true, 9, 'group'), owner('unknown', true, 1),
    ], () => 0)).toEqual([
      { id: 'a', name: '阿一', retired: true },
      { id: 'b', name: '阿二', retired: false },
    ]);
    expect(diffCloudOwners(chars, [owner('a', true, 1)], () => 0, new Set(['a']))).toEqual([]);
  });
  it('用户没有设置 Worker 或 Worker 不支持云端数据管理时，不误报也不写入', async () => {
    vi.mocked(ActiveMsgStore.getGlobalConfig).mockResolvedValue({ workerUrl: '' } as any);
    await expect(findCloudOwnerConflicts(chars)).resolves.toEqual([]);
    expect(ActiveMsgClient.openCloudDataSession).not.toHaveBeenCalled();
    vi.mocked(ActiveMsgStore.getGlobalConfig).mockResolvedValue({ workerUrl: 'https://w.example' } as any);
    vi.mocked(ActiveMsgClient.openCloudDataSession)
      .mockRejectedValueOnce(new CloudDataError('CLOUD_DATA_UNSUPPORTED', 'old'));
    await expect(findCloudOwnerConflicts(chars)).resolves.toEqual([]);
  });
  it('云端返回分页不全时严禁当成完整清单处理', async () => {
    vi.mocked(ActiveMsgStore.getGlobalConfig).mockResolvedValue({ workerUrl: 'https://w.example' } as any);
    vi.mocked(ActiveMsgClient.openCloudDataSession).mockResolvedValueOnce({
      workerUrl: 'https://w.example', userId: 'user',
      listOwners: vi.fn(async () => ({ owners: [], complete: false, gaps: ['missing'] })),
    } as any);
    await expect(findCloudOwnerConflicts(chars)).rejects.toThrow('不完整');
  });
});
