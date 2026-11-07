import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { buildLocalAwayHint } from './awayMessagePrompt';
import { AMSG_SILENT_MARK } from './amsgFirePack';
const now = Date.parse('2026-11-07T12:00:00Z');
const character = { id: 'char-a', name: '阿一', customTimezoneEnabled: true, customTimezone: 'Asia/Tokyo' } as CharacterProfile;
const hint = (recent: Partial<Message>[] = [], extra: Partial<CharacterProfile> = {}) =>
  buildLocalAwayHint({ ...character, ...extra }, '小明', now - 180 * 60_000, recent as Message[], now);
describe('本地离开后消息：作者原版自然联系 + 个人 B 方案', () => {
  it('不虚构历史多次补发，每次只有当前一次机会，允许主动静默', () => {
    const text = hint();
    expect(text).toContain('现在是你可以主动');
    expect(text).toContain('随手拍的照片');
    expect(text).toContain('刚看到的趣事');
    expect(text).toContain(AMSG_SILENT_MARK);
    expect(text).not.toContain('分别写出来');
    expect(text).not.toContain('你主动给小明发过');
  });
  it('刚结束的线下见面保留分别后的心情，但不引入被归档的原文', () => {
    const text = hint([{ role: 'assistant', timestamp: now - 30 * 60_000,
      content: '不应该重复注入的归档见面故事', metadata: { source: 'date' } }]);
    expect(text).toContain('现在已经分开了');
    expect(text).not.toContain('不应该重复注入的归档见面故事');
  });
  it('换成线上聊天或超过三小时，不会误判刚见过面', () => {
    expect(hint([
      { role: 'assistant', timestamp: now - 40 * 60_000, metadata: { source: 'date' } },
      { role: 'user', timestamp: now - 10 * 60_000, metadata: { source: 'chat' } },
    ])).not.toContain('现在已经分开了');
    expect(hint([{ role: 'assistant', timestamp: now - 4 * 3600_000, metadata: { source: 'date' } }]))
      .not.toContain('现在已经分开了');
  });
  it('关闭时间感知不泄露具体钟点', () => {
    expect(hint([], { timeAwarenessEnabled: false })).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
