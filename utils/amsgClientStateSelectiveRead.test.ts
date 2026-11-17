import { describe, expect, it, vi } from 'vitest';
import { readSelectedClientStateEntries } from './amsgClientStateSelectiveRead';

const namespace = 'amsg:char:test';

describe('AMSG2 按 key 读取（避免 Free Worker 解密整份 fire_pack）', () => {
  it('五条面板小状态分别走 SDK key 查询，从不读整个 namespace', async () => {
    const states: Record<string, string> = {
      last_skip: '{"reason":"chat-overlap"}',
      away_last_skip: '{"reason":"away-date-lock"}',
      away_trace_v1: '{"v":1,"entries":[]}',
      daily_sends: '{"v":1,"count":2}',
      away_daily_sends: '{"v":1,"count":0}',
    };
    const keys = Object.keys(states);
    const getClientState = vi.fn(async (ns: string, opts?: { key: string }) => {
      expect(ns).toBe(namespace);
      // 未过滤的 GET 会把大段压缩上下文也一起解密，必须杜绝。
      if (!opts?.key) throw new Error('unexpected full namespace GET');
      return { success: true, data: { entries: [{ key: opts.key, value: states[opts.key] }] } };
    });
    const entries = await readSelectedClientStateEntries({ getClientState }, namespace, keys);
    expect(entries).toEqual(keys.map((key) => ({ key, value: states[key] })));
    expect(getClientState).toHaveBeenCalledTimes(5);
    expect(getClientState.mock.calls.every(([, options]) => !!options?.key)).toBe(true);
  });

  it('key 不存在时返回空集，而不是回退整份命名空间', async () => {
    const getClientState = vi.fn().mockResolvedValue({ success: true, data: { entries: [] } });
    expect(await readSelectedClientStateEntries({ getClientState }, namespace, ['last_skip'])).toEqual([]);
    expect(getClientState).toHaveBeenCalledWith(namespace, { key: 'last_skip' });
  });

  it('旧路由意外返回其他 key 时不能把 fire_pack 转交给面板', async () => {
    const getClientState = vi.fn().mockResolvedValue({
      success: true,
      data: { entries: [
        { key: 'fire_pack', value: 'secret and very large character context' },
        { key: 'last_skip', value: 'expected' },
      ] },
    });
    expect(await readSelectedClientStateEntries({ getClientState }, namespace, ['last_skip']))
      .toEqual([{ key: 'last_skip', value: 'expected' }]);
  });

  it('任意一个读取失败/回执不完整，必须报失败而不是把未知误报为「没有」', async () => {
    const getClientState = vi.fn(async (_ns: string, opts: { key: string }) =>
      opts.key === 'away_trace_v1'
        ? { success: false }
        : { success: true, data: { entries: [] } });
    await expect(readSelectedClientStateEntries(
      { getClientState }, namespace, ['last_skip', 'away_trace_v1', 'daily_sends'],
    )).rejects.toThrow(/读取云端状态失败/);

    const brokenClient = { getClientState: vi.fn().mockResolvedValue({ success: true, data: {} }) };
    await expect(readSelectedClientStateEntries(brokenClient, namespace, ['last_skip']))
      .rejects.toThrow(/结果不完整/);
  });

  it('不需要任何状态时不发请求', async () => {
    const getClientState = vi.fn();
    expect(await readSelectedClientStateEntries({ getClientState }, namespace, [])).toEqual([]);
    expect(getClientState).not.toHaveBeenCalled();
  });
});
