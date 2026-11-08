import { describe, expect, it, vi } from 'vitest';
import {
  AMSG_CALL_HEARTBEAT_MS, AMSG_CALL_PRESENCE_TTL_MS,
  buildAmsgCallPresence, isFreshAmsgCallPresence, parseAmsgCallPresence,
} from './amsgCallPresence';

describe('云端电话存活租约（只有离开后消息会读）', () => {
  const NOW = Date.parse('2026-11-08T13:19:21.000Z');

  it('只认同角色、仍有效的真正通话，切后台但 JS 存活仍可续租', () => {
    const lease = buildAmsgCallPresence('char', true, NOW - AMSG_CALL_HEARTBEAT_MS);
    expect(isFreshAmsgCallPresence(lease, 'char', NOW)).toBe(true);
    expect(isFreshAmsgCallPresence(lease, 'another-char', NOW)).toBe(false);
    expect(isFreshAmsgCallPresence({ ...lease, active: false }, 'char', NOW)).toBe(false);
  });

  it('整个进程被杀后不会无限保持昨天的通话锁', () => {
    const stale = buildAmsgCallPresence('char', true, NOW - AMSG_CALL_PRESENCE_TTL_MS - 1);
    expect(isFreshAmsgCallPresence(stale, 'char', NOW)).toBe(false);
    expect(isFreshAmsgCallPresence(null, 'char', NOW)).toBe(false);
    expect(isFreshAmsgCallPresence({ ...stale, at: NOW + 600_001 }, 'char', NOW)).toBe(false);
  });

  it('旧版没有心跳或数据坏掉一律不假装仍在通话', () => {
    expect(parseAmsgCallPresence('')).toBeNull();
    expect(parseAmsgCallPresence('{"v":1,"charId":"a","active":true}')).toBeNull();
    expect(parseAmsgCallPresence(JSON.stringify(buildAmsgCallPresence('a', false, NOW)))).toMatchObject({
      charId: 'a', active: false,
    });
  });

  it('旧版本 localStorage 的 true 在 JS 重启后不能被当作正在通话', async () => {
    const oldLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
    try {
      const guard = await import('./amsgInteractionGuard');
      guard.setAmsgActiveCall('crash-char', true);
      expect(guard.isAmsgActiveCall('crash-char')).toBe(true);
      expect(data.get('sully_amsg2_call_active_v1')).toContain('crash-char');
      // A fresh page has a fresh module-level Set, despite persisted legacy true.
      vi.resetModules();
      const freshGuard = await import('./amsgInteractionGuard');
      expect(freshGuard.isAmsgActiveCall('crash-char')).toBe(false);
      freshGuard.setAmsgActiveCall('crash-char', true);
      expect(freshGuard.isAmsgActiveCall('crash-char')).toBe(true);
      freshGuard.setAmsgActiveCall('crash-char', false);
      expect(freshGuard.isAmsgActiveCall('crash-char')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      if (oldLocalStorage) Object.defineProperty(globalThis, 'localStorage', oldLocalStorage);
    }
  });
});
