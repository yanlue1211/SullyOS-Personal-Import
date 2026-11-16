import { describe, expect, it } from 'vitest';
import { findNativeAwayGapStartWithPresence, getLatestAwayInPersonActivity, isAwayInPersonActivity, resolvePersonalAwayAnchor } from './awayPresenceAnchor';
const MIN = 60_000;
const NOW = Date.parse('2026-11-16T12:00:00Z');
const at = (minutesAgo: number) => NOW - minutesAgo * MIN;

describe('作者在场时间适配到个人 B 模式（不改变普通私聊节拍）', () => {
  it('角色 12:00 说话、用户 13:00 单独留言仍只以角色发言为节拍', () => {
    expect(resolvePersonalAwayAnchor(at(120), [
      { role: 'assistant', timestamp: at(120), metadata: { source: 'chat' } },
      { role: 'user', timestamp: at(60), metadata: { source: 'chat' } },
    ])).toBe(at(120));
  });
  it('见面里用户与角色的真实回合都可延后离开起点，普通线上助手通知不能', () => {
    expect(resolvePersonalAwayAnchor(at(200), [
      { role: 'assistant', timestamp: at(85), metadata: { source: 'date' } },
      { role: 'user', timestamp: at(70), metadata: { source: 'date' } },
      { role: 'assistant', timestamp: at(50), metadata: { source: 'active_msg_2' } },
    ])).toBe(at(70));
  });
  it('通话结束卡属于在场锚点，即使它的 role 是 system', () => {
    expect(getLatestAwayInPersonActivity([
      { role: 'assistant', timestamp: at(110), metadata: { source: 'call' } },
      { role: 'system', timestamp: at(15), metadata: { source: 'call-end-popup' } },
    ])?.timestamp).toBe(at(15));
    expect(resolvePersonalAwayAnchor(at(100), [
      { role: 'system', timestamp: at(15), metadata: { source: 'call-end-popup' } },
    ])).toBe(at(15));
  });
  it('记录失败时用已确认的挂断时间保护空闲计时，但无角色历史不凭空创建循环', () => {
    expect(resolvePersonalAwayAnchor(at(150), [], at(4))).toBe(at(4));
    expect(resolvePersonalAwayAnchor(null, [], at(4))).toBeNull();
  });
  it('内部提示、隐藏消息与普通自动消息不触发在线记录', () => {
    for (const metadata of [
      { source: 'date', proactiveHint: true }, { source: 'call', hidden: true },
      { source: 'call', awayMessage: true }, { source: 'active_msg_2' }, {},
    ]) expect(isAwayInPersonActivity({ role: 'assistant', timestamp: NOW, metadata })).toBe(false);
  });
});

describe('原生本地模式仍只补一次，并按见面/通话分别后重新计算', () => {
  it('上一轮在场结束 30 分钟，不应因三小时前的私聊开始补发', () => {
    expect(findNativeAwayGapStartWithPresence([
      { role: 'user', timestamp: at(190) },
      { role: 'system', timestamp: at(30), metadata: { source: 'call-end-popup' } },
    ], 90 * MIN, NOW)).toBeNull();
  });
  it('见面结束超过等待时长时可以补一次（角色自己说话也可证明当时在场）', () => {
    expect(findNativeAwayGapStartWithPresence([
      { role: 'user', timestamp: at(200) },
      { role: 'assistant', timestamp: at(120), metadata: { source: 'date' } },
    ], 90 * MIN, NOW)).toBe(at(120));
  });
  it('同一次离开已补过，禁止重复发；之后有新线下相处可以重新开始', () => {
    const rows = [
      { role: 'user', timestamp: at(400) },
      { role: 'assistant', timestamp: at(250), metadata: { awayMessage: true } },
    ];
    expect(findNativeAwayGapStartWithPresence(rows, 90 * MIN, NOW)).toBeNull();
    expect(findNativeAwayGapStartWithPresence(rows, 90 * MIN, NOW, at(120))).toBe(at(120));
    expect(findNativeAwayGapStartWithPresence([...rows, {
      role: 'user', timestamp: at(90), metadata: { source: 'chat' },
    }], 90 * MIN, NOW)).toBe(at(90));
  });
  it('挂断记录因数据库错误缺失，外部挂断时间仍阻止提前补发', () => {
    expect(findNativeAwayGapStartWithPresence([
      { role: 'user', timestamp: at(240) },
    ], 90 * MIN, NOW, at(15))).toBeNull();
  });
});
