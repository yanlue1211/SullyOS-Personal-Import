import { describe, expect, it } from 'vitest';
import { resolveAmsgInteractionLock } from './amsgInteractionGuard';

describe('2.0 云端交互锁', () => {
  it('普通私聊没有锁', () => {
    expect(resolveAmsgInteractionLock([{role:'user', metadata:{source:'chat'}}], false)).toBe(null);
  });
  it('上轮约会或剧情保持在同一空间，不按久未讲话踢去线上', () => {
    expect(resolveAmsgInteractionLock([
      {role:'user', metadata:{source:'chat'}},
      {role:'user', metadata:{source:'date'}},
      {role:'assistant', metadata:{source:'date'}},
    ], false)).toBe('date');
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
    ], false)).toBe('date');
  });
});
