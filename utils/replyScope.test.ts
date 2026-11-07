import { describe, expect, it } from 'vitest';
import { buildReplyScopeRule } from './replyScope';

describe('multi-tool reply scope (upstream 84d10385db)', () => {
  it('user-triggered chats treat all tool calls as one reply', () => {
    const rule = buildReplyScopeRule('user');
    expect(rule).toContain('从用户最新发来的那条消息开始');
    expect(rule).toContain('每调用一次工具、拿到一次结果');
    expect(rule).not.toContain('主动消息到点了');
  });
  it('scheduled sends do not mistake an old user turn for this new reply', () => {
    const rule = buildReplyScopeRule('scheduled');
    expect(rule).toContain('从你收到这份说明开始');
    expect(rule).not.toContain('用户最新发来的那条消息');
  });
});
