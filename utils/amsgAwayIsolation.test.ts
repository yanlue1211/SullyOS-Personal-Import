import { describe, expect, it } from 'vitest';
import {
  appendSelfLogEntry, countUnansweredSends, countAwayUnansweredSends, createSelfLog,
  parseSelfLog,
} from './amsgFirePack';
import { AMSG_DAILY_SENDS_KEY, AMSG_AWAY_DAILY_SENDS_KEY, bumpDailySends } from './amsgLimits';

const userAt = Date.parse('2026-11-08T08:00:00Z');
const entry = (id: string, away: boolean) => ({
  id, at: userAt + 90_000, startedAt: userAt + 60_000, text: '测试文本',
  ...(away ? { away: true } : {}),
});

describe('离开后消息与自主预约的额度真正隔离', () => {
  it('自动离开联系 3 次不会吃掉自主预约未回复上限', () => {
    let log = createSelfLog(userAt, userAt);
    for (let i = 0; i < 3; i++) {
      log = appendSelfLogEntry(log, entry(`away-test${i}@${userAt+i}`, true));
    }
    expect(countAwayUnansweredSends(log)).toBe(3);
    expect(countUnansweredSends(log)).toBe(0);
    log = appendSelfLogEntry(log, entry('self-appointment@123', false));
    expect(countUnansweredSends(log)).toBe(1);
    expect(countAwayUnansweredSends(log)).toBe(3);
  });

  it('旧版混合日志升级不会因离开后提醒锁死预约机会', () => {
    const legacy = createSelfLog(userAt, userAt);
    const raw = { ...legacy, separatedAwayCounts: undefined, awayUnansweredSends: undefined,
      unansweredSends: 3,
      entries: [entry('away-1@1', false), entry('away-2@2', false), entry('self-3@3', false)],
    };
    const log = parseSelfLog(JSON.stringify(raw));
    expect(countUnansweredSends(log)).toBe(1);
    const upgraded = appendSelfLogEntry(log!, entry('self-4@4', false));
    expect(upgraded.separatedAwayCounts).toBe(true);
    expect(countUnansweredSends(upgraded)).toBe(2);
  });

  it('同一条离开后消息重试不重复计算，同步入聊天仍保留文本', () => {
    const e = entry('away-once@1', true);
    const once = appendSelfLogEntry(createSelfLog(userAt, userAt), e);
    const twice = appendSelfLogEntry(once, e);
    expect(countAwayUnansweredSends(twice)).toBe(1);
    expect(countUnansweredSends(twice)).toBe(0);
    expect(twice.entries.map(x => x.text)).toEqual(['测试文本']);
  });

  it('分开保存的每日账本互不扣减，仍使用原来的去重机制', () => {
    expect(AMSG_DAILY_SENDS_KEY).not.toBe(AMSG_AWAY_DAILY_SENDS_KEY);
    const day = '2026-11-08';
    const normal = bumpDailySends(null, day, { sends: 1, llmCalls: 1, sentId: 'scheduled@1' });
    const away = bumpDailySends(null, day, { sends: 3, llmCalls: 3, sentId: 'away@1' });
    expect(normal.sends).toBe(1);
    expect(away.sends).toBe(3);
    expect(bumpDailySends(normal, day, { sends: 1, sentId: 'scheduled@1' }).sends).toBe(1);
  });
});
