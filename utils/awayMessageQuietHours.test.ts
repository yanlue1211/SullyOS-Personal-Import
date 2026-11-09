import { describe, expect, it } from 'vitest';
import {
  isAwayQuietTime,
  isQuietClockMinute,
  parseQuietClockMinutes,
  shouldSkipAwayForQuietHours,
  nextAwayAllowedTimeMs,
} from './awayMessageQuietHours';

const q = { enabled: true, startTime: '23:00', endTime: '08:00' };

describe('离开后消息禁发时段', () => {
  it('校验墙钟，禁止不规范时间', () => {
    expect(parseQuietClockMinutes('23:01')).toBe(1381);
    expect(parseQuietClockMinutes('24:00')).toBeNull();
    expect(parseQuietClockMinutes('7:00')).toBeNull();
  });

  it('跨午夜包含 23:00，不包含 08:00', () => {
    expect(isQuietClockMinute(23 * 60, 23 * 60, 8 * 60)).toBe(true);
    expect(isQuietClockMinute(7 * 60 + 59, 23 * 60, 8 * 60)).toBe(true);
    expect(isQuietClockMinute(8 * 60, 23 * 60, 8 * 60)).toBe(false);
    expect(isQuietClockMinute(22 * 60 + 59, 23 * 60, 8 * 60)).toBe(false);
  });

  it('白天时段与全天禁发也能判定', () => {
    expect(isQuietClockMinute(12 * 60, 11 * 60, 14 * 60)).toBe(true);
    expect(isQuietClockMinute(15 * 60, 11 * 60, 14 * 60)).toBe(false);
    expect(isQuietClockMinute(10 * 60, 8 * 60, 8 * 60)).toBe(true);
  });

  it('按用户时区，不按角色时区或 Worker UTC 计算', () => {
    const at = Date.parse('2026-11-07T18:30:00Z'); // 东京 11/08 03:30，洛杉矶 11/07 10:30
    expect(isAwayQuietTime(q, at, 'Asia/Tokyo')).toBe(true);
    expect(isAwayQuietTime(q, at, 'America/Los_Angeles')).toBe(false);
  });

  it('凌晨到点即使早晨恢复也不补发', () => {
    const dueMs = Date.parse('2026-11-07T16:30:00Z'); // 东京 01:30
    const nowMs = Date.parse('2026-11-08T00:30:00Z'); // 东京 09:30
    expect(shouldSkipAwayForQuietHours({ quietHours: q, dueMs, nowMs, userTimeZone: 'Asia/Tokyo' })).toBe(true);
  });

  it('白天到点、白天触发不拦', () => {
    const dueMs = Date.parse('2026-11-08T01:30:00Z'); // 东京 10:30
    const nowMs = Date.parse('2026-11-08T02:30:00Z'); // 东京 11:30
    expect(shouldSkipAwayForQuietHours({ quietHours: q, dueMs, nowMs, userTimeZone: 'Asia/Tokyo' })).toBe(false);
  });

  it('07:50 禁发到点 -> 08:00 是当天第一次允许时刻', () => {
    const due = Date.parse('2026-11-08T22:50:00Z'); // 东京 11/09 07:50
    const allowed = Date.parse('2026-11-08T23:00:00Z'); // 东京 08:00
    expect(nextAwayAllowedTimeMs(q, due, 'Asia/Tokyo')).toBe(allowed);
    expect(nextAwayAllowedTimeMs(q, allowed, 'Asia/Tokyo')).toBe(allowed);
    expect(nextAwayAllowedTimeMs(q, due, 'America/Los_Angeles')).toBe(due);
  });

  it('全天禁发不尝试无限续排；夏令时边界正确', () => {
    const allDay = { ...q, startTime: '08:00', endTime: '08:00' };
    expect(nextAwayAllowedTimeMs(allDay, Date.now(), 'Asia/Tokyo')).toBeNull();
    const beforeDst = Date.parse('2026-03-08T09:50:00Z'); // LA 当地 01:50
    expect(nextAwayAllowedTimeMs(q, beforeDst, 'America/Los_Angeles'))
      .toBe(Date.parse('2026-03-08T15:00:00Z')); // 08:00 PDT
  });

  it('配置关闭、格式错误或未知时区不会误丢消息', () => {
    const at = Date.parse('2026-11-07T16:30:00Z');
    expect(isAwayQuietTime({ ...q, enabled: false }, at, 'Asia/Tokyo')).toBe(false);
    expect(isAwayQuietTime({ ...q, startTime: 'xx:xx' }, at, 'Asia/Tokyo')).toBe(false);
    expect(isAwayQuietTime(q, at, 'Not/AZone')).toBe(false);
  });
});
