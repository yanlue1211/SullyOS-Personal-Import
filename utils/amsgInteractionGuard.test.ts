import { describe, expect, it, vi } from 'vitest';
import { endAmsgDateFromScheduledMessage, getAmsgActiveDateEncounterId, getAmsgDateEndedAt, isAmsgActiveDate, resolveAmsgInteractionLock, setAmsgActiveDate } from './amsgInteractionGuard';

describe('2.0 云端交互锁', () => {
  it('普通私聊没有锁', () => {
    expect(resolveAmsgInteractionLock([{role:'user', metadata:{source:'chat'}}], false)).toBe(null);
  });
  it('上轮约会或剧情保持在同一空间，不按久未讲话踢去线上', () => {
    expect(resolveAmsgInteractionLock([
      {role:'user', metadata:{source:'chat'}},
      {role:'user', metadata:{source:'date'}},
      {role:'assistant', metadata:{source:'date'}},
    ], false, true)).toBe('date');
  });
  it('哪怕最后一条正常聊天来自较早，未挂断电话仍禁止主动私聊', () => {
    expect(resolveAmsgInteractionLock([{role:'user'}], true)).toBe('call');
  });
  it('电话明确挂断后的系统事件解除通话锁', () => {
    expect(resolveAmsgInteractionLock([
      {role:'user',metadata:{source:'call'}},
      {role:'system',metadata:{source:'call-end-popup'}},
    ], false)).toBe(null);
  });
  it('线下见面显式退出后不因历史最后一条仍为 date 而永久锁住', () => {
    expect(resolveAmsgInteractionLock([
      {role: 'assistant', metadata: {source: 'date'}},
    ], false, false)).toBe(null);
  });
  it('挂断后即使结束卡保存失败也不会锁死，后台未明确挂断则保留锁', () => {
    expect(resolveAmsgInteractionLock([{role:'assistant',metadata:{source:'call'}}], false)).toBe(null);
    expect(resolveAmsgInteractionLock([{role:'assistant',metadata:{source:'call'}}], true)).toBe('call');
  });
  it('用户改回线上对话后解除线下锁', () => {
    expect(resolveAmsgInteractionLock([
      {role:'assistant',metadata:{source:'date'}},
      {role:'user',metadata:{source:'chat'}},
    ], false)).toBe(null);
  });
  it('隐藏系统提示不视作离开', () => {
    expect(resolveAmsgInteractionLock([
      {role:'user',metadata:{source:'date'}},
      {role:'user',metadata:{hidden:true,proactiveHint:true}},
    ], false, true)).toBe('date');
  });
  it('只有确实发送的线上预约才结束同一场见面，旧场次不会误关新场次', () => {
    const db = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => db.get(key) ?? null,
      setItem: (key: string, value: string) => { db.set(key, value); },
      removeItem: (key: string) => { db.delete(key); },
    });
    setAmsgActiveDate('char-a', true, 'first');
    // 只排任务不触发结束（直到收件箱明确收到正文）。
    expect(isAmsgActiveDate('char-a')).toBe(true);
    setAmsgActiveDate('char-a', true, 'second');
    expect(endAmsgDateFromScheduledMessage('char-a', 'first', 2000)).toBe(false);
    expect(getAmsgActiveDateEncounterId('char-a')).toBe('second');
    expect(endAmsgDateFromScheduledMessage('char-a', 'second', 4000)).toBe(true);
    expect(isAmsgActiveDate('char-a')).toBe(false);
    expect(getAmsgDateEndedAt('char-a')).toBe(4000);
    expect(endAmsgDateFromScheduledMessage('char-a', 'second', 4000)).toBe(false);
  });

});
