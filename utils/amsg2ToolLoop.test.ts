// 回归守卫：本地聊天的工具循环以前只拿最后一轮的正文当回复。Claude 常在调排程工具的
// 同一轮就把话写了，工具结果回来后下一轮只出一两个 token——用户收到的就是一次空回
// （2026-09-23 现场：排程成功之后那轮只出了 2 个 token）。排程连着被打回时模型又会换个
// 参数一轮轮接着排，转到上限还是空回。下面钉住「话要留下来」和「撞墙就收尾」两件事。
import { describe, it, expect } from 'vitest';

import {
  AMSG2_MAX_STALLED_ROUNDS,
  createAmsg2StallTracker,
  extractToolRoundLeadIn,
  mergeToolRoundLeadIns,
  shouldFinishAmsg2ScheduleInOneCall,
  TOOL_ROUND_PLACEHOLDER,
} from './amsg2ToolLoop';

describe('工具轮里说过的话', () => {
  it('最后一轮空着 → 回复就是工具轮里写下的话', () => {
    expect(mergeToolRoundLeadIns(['好，那你先去吃饭～\n吃完跟我说'], '')).toBe('好，那你先去吃饭～\n吃完跟我说');
  });

  it('工具轮和最后一轮都写了 → 按顺序拼起来', () => {
    expect(mergeToolRoundLeadIns(['那你先去'], '回来找我')).toBe('那你先去\n回来找我');
  });

  it('最后一轮把前面的话又抄了一遍 → 不重复', () => {
    expect(mergeToolRoundLeadIns(['那你先去'], '那你先去\n回来找我')).toBe('那你先去\n回来找我');
    expect(mergeToolRoundLeadIns(['那你先去', '那你先去'], '')).toBe('那你先去');
  });

  it('去掉跨轮重叠与内联思考，保留短语气词和单独的闭合标签', () => {
    expect(mergeToolRoundLeadIns(['<think>内部</think>嗯\n晚点来找你'], '晚点来找你\n先吃饭')).toBe('嗯\n晚点来找你\n先吃饭');
    expect(mergeToolRoundLeadIns(['好'], '好的，我知道了')).toBe('好\n好的，我知道了');
    expect(mergeToolRoundLeadIns(['正文\n</div>'], '</div>\n后文')).toBe('正文\n</div>\n</div>\n后文');
  });

  it('历史里的占位被模型照抄进正文时不当回话', () => {
    expect(extractToolRoundLeadIn(TOOL_ROUND_PLACEHOLDER)).toBe('');
    expect(extractToolRoundLeadIn(null)).toBe('');
    expect(mergeToolRoundLeadIns([TOOL_ROUND_PLACEHOLDER], `${TOOL_ROUND_PLACEHOLDER}嗯`)).toBe('嗯');
  });
});

describe('排程连着撞墙就收尾', () => {
  const rejected = { tool: 'schedule_active_message', status: 'rejected' as const, reason: 'min_gap' };
  const done = { tool: 'schedule_active_message', status: 'done' as const };

  it(`连着 ${AMSG2_MAX_STALLED_ROUNDS} 轮都没办成 → 该收尾了`, () => {
    const tracker = createAmsg2StallTracker();
    expect(tracker.record([rejected])).toBe(false);
    expect(tracker.record([{ ...rejected, status: 'duplicate' as const }])).toBe(true);
  });

  it('中间办成过一件 → 重新数', () => {
    const tracker = createAmsg2StallTracker();
    tracker.record([rejected]);
    expect(tracker.record([rejected, done])).toBe(false);
    expect(tracker.record([rejected])).toBe(false);
  });

  it('这一轮没调主动消息工具（只调了别的） → 不算数', () => {
    const tracker = createAmsg2StallTracker();
    tracker.record([rejected]);
    expect(tracker.record([])).toBe(false);
    expect(tracker.stalledRounds).toBe(1);
  });
});


describe('纯预约成功且第一轮已有正文可省一轮 API', () => {
  const done = { tool: 'schedule_active_message', status: 'done' as const };
  const base = { toolNames: ['schedule_active_message'], outcomes: [done] };

  it('预约真正成功 + 模型已经说完 → 不必再调用模型', () => {
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: '行呀，过一会儿我再来找你～' })).toBe(true);
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: '<心声>要记得去联系</心声>晚点见～' })).toBe(true);
    expect(shouldFinishAmsg2ScheduleInOneCall({
      toolNames: ['schedule_active_message', 'schedule_active_message'],
      outcomes: [done, done], content: '午饭和晚饭我都记着啦。',
    })).toBe(true);
  });

  it('模型只给 tool_calls 或只给心声、占位 → 仍需第二轮生成正文', () => {
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: null })).toBe(false);
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: '(调用工具中)' })).toBe(false);
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: '<心声>得记着约好时间</心声>' })).toBe(false);
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: '<think>let me plan the time</think>' })).toBe(false);
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: '<状态>关系稳定</状态>' })).toBe(false);
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: '<thinking type="visible">thinking</thinking>' })).toBe(false);
  });

  it('预约打回 / 没完成 / 其他工具参与不能提前收尾', () => {
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, outcomes: [{ ...done, status: 'rejected' }], content: '我安排好了哦' })).toBe(false);
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, hasOtherTools: true, content: '已安排，一会找你' })).toBe(false);
    expect(shouldFinishAmsg2ScheduleInOneCall({
      toolNames: ['schedule_active_message', 'list_active_messages'],
      outcomes: [done, { tool: 'list_active_messages', status: 'done' }], content: '查一下再说哦',
    })).toBe(false);
    expect(shouldFinishAmsg2ScheduleInOneCall({ ...base, content: 'schedule_active_message({"send_at":"tomorrow"})' })).toBe(false);
  });
});
