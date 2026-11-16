import { afterEach, describe, expect, it, vi } from 'vitest';
import { endAmsgDateFromOnlineUserMessage, endAmsgDateFromScheduledMessage, getAmsgActiveDateEncounterId, getAmsgDateEndedAt, getAmsgCallEndedAt, getAmsgLastSceneEndedAt, isAmsgActiveDate, isAmsgActiveCall, resolveAmsgInteractionLock, setAmsgActiveDate, setAmsgActiveCall } from './amsgInteractionGuard';

describe('2.0 云端交互锁', () => {
  afterEach(() => vi.unstubAllGlobals());
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
  it('第一条成功保存的线上用户消息解除见面；重复消息不再次清锁；通话锁独立', () => {
    const db = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => db.get(key) ?? null,
      setItem: (key: string, value: string) => { db.set(key, value); },
      removeItem: (key: string) => { db.delete(key); },
    });
    setAmsgActiveDate('char-a', true, 'encounter-1');
    expect(endAmsgDateFromOnlineUserMessage('char-a', 9000)).toBe(true);
    expect(isAmsgActiveDate('char-a')).toBe(false);
    expect(getAmsgDateEndedAt('char-a')).toBe(9000);
    expect(endAmsgDateFromOnlineUserMessage('char-a', 10000)).toBe(false);
    expect(getAmsgDateEndedAt('char-a')).toBe(9000);
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


  it('真实挂断才写新的离开锚点；重启/重复关闭不凭旧通话标记伪造结束时间', () => {
    const db = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => db.get(key) ?? null,
      setItem: (key: string, value: string) => { db.set(key, value); },
      removeItem: (key: string) => { db.delete(key); },
    });
    const charId = 'call-explicit-hangup-20261116';
    setAmsgActiveCall(charId, false, 1000);
    expect(getAmsgCallEndedAt(charId)).toBeNull();
    setAmsgActiveCall(charId, true);
    expect(isAmsgActiveCall(charId)).toBe(true);
    setAmsgActiveCall(charId, false, 2000);
    expect(isAmsgActiveCall(charId)).toBe(false);
    expect(getAmsgCallEndedAt(charId)).toBe(2000);
    setAmsgActiveCall(charId, false, 3000);
    expect(getAmsgCallEndedAt(charId)).toBe(2000);
    setAmsgActiveCall(charId, true);
    setAmsgActiveCall(charId, false, 4000);
    expect(getAmsgCallEndedAt(charId)).toBe(4000);
  });

  it('见面与挂断的结束时间取较晚值，经旧 Worker limits 字段传输，不影响见面锁', () => {
    const db = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => db.get(key) ?? null,
      setItem: (key: string, value: string) => { db.set(key, value); },
      removeItem: (key: string) => { db.delete(key); },
    });
    const charId = 'mixed-away-end-20261116';
    setAmsgActiveDate(charId, true, 'meeting-A');
    setAmsgActiveDate(charId, false, undefined, 1500);
    expect(getAmsgLastSceneEndedAt(charId)).toBe(1500);
    setAmsgActiveCall(charId, true);
    setAmsgActiveCall(charId, false, 2400);
    expect(getAmsgLastSceneEndedAt(charId)).toBe(2400);
    setAmsgActiveDate(charId, true, 'meeting-B');
    expect(isAmsgActiveDate(charId)).toBe(true);
    expect(getAmsgLastSceneEndedAt(charId)).toBe(2400);
    setAmsgActiveDate(charId, false, undefined, 3200);
    expect(getAmsgLastSceneEndedAt(charId)).toBe(3200);
  });
});
