import { afterEach, describe, expect, it, vi } from 'vitest';
import { markLocalAwayTickChecked, wasLocalAwayTickChecked } from './awayMessageLocalTick';

afterEach(() => vi.unstubAllGlobals());
const prepareStorage = () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
};

describe('B方案本地静默节拍账本', () => {
  it('静默/成功发送后同一节拍只检查一次，下一节拍照常有机会', () => {
    prepareStorage();
    expect(wasLocalAwayTickChecked('char-a', 100, 200)).toBe(false);
    markLocalAwayTickChecked('char-a', 100, 200);
    expect(wasLocalAwayTickChecked('char-a', 100, 200)).toBe(true);
    expect(wasLocalAwayTickChecked('char-a', 100, 250)).toBe(false);
    markLocalAwayTickChecked('char-a', 100, 250);
    markLocalAwayTickChecked('char-a', 100, 200); // 迟到重试不能回滚进度
    expect(wasLocalAwayTickChecked('char-a', 100, 250)).toBe(true);
  });
  it('真实用户发言或结束见面改了计时锚，旧静默不挡新的轮次', () => {
    prepareStorage();
    markLocalAwayTickChecked('char-a', 100, 200);
    expect(wasLocalAwayTickChecked('char-a', 150, 200)).toBe(false);
    expect(wasLocalAwayTickChecked('char-b', 100, 200)).toBe(false);
  });
});
