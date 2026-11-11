/** Regression coverage for the verified 2026-10-19 integration defects. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { amsgHooks, amsgFireSettled, offloadOversizedPush, runFireRenewTool, runFireScheduleTool } from './index';
import { buildXhsSessionPayload } from './agentic';
import { parseInstantInputRef } from './instantInput';
import { buildToolConfig, buildToolPack, AMSG_TOOL_CONFIG_KEY, AMSG_TOOL_PACK_KEY } from '../../../utils/amsgToolPack';
import { AMSG_FIRE_PACK_KEY, AMSG_SELF_LOG_KEY, FIRE_PACK_VERSION, BEFORE_SPEAK_LINES, AMSG_SILENT_MARK, createSelfLog, appendSelfLogTask, unpackStateValue } from '../../../utils/amsgFirePack';
import { AMSG_LIMITS_KEY } from '../../../utils/amsgLimits';
import { buildAmsg2NoticesText } from '../../../utils/amsg2TaskContext';
import { isPendingTask } from '../../../utils/amsg2Tasks';

const now = Date.parse('2026-10-18T10:00:00Z');
const charId = 'audit-char';
const uuid = '11111111-1111-4111-8111-111111111111';
const makeTask = (index: number, at: number) => ({
  taskUuid: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
  clientTaskId: `client-${index}`, mode: 'auto', source: 'character',
  status: 'scheduled', recurrenceType: 'none', firstSendTime: new Date(at).toISOString(),
  createdAt: at - 60_000, expirePolicy: 'expire',
}) as any;

async function start(over: {
  enabled?: boolean; config?: any; pending?: any[]; selfLog?: any; sharedValue?: string; awaySceneLock?: 'date' | 'call';
  presence?: any; builtAt?: number; limits?: Record<string, unknown>; chatMessages?: any[]; nowMs?: number; task?: any; remote?: any[]; template?: string; failNextSchedule?: boolean;
} = {}) {
  const nowMs = over.nowMs ?? now;
  const pack = {
    v: FIRE_PACK_VERSION, template: over.template ?? '角色设定 {{AMSG_TASK_INSTRUCTION}}',
    lastUserMessageAt: null, tzId: 'Asia/Tokyo', userTzId: 'Asia/Tokyo', targetName: '用户',
    builtAt: over.builtAt ?? now - 60_000, pendingTasks: over.pending ?? [], scene: null,
    awaySceneLock: over.awaySceneLock ?? null,
    selfScheduleEnabled: over.enabled ?? true,
    chat: { builtAt: now, messages: over.chatMessages ?? [{ role: 'user', content: '你好' }] },
  };
  const rows = [
    ...(over.presence ? [{key:"chat_presence",value:JSON.stringify(over.presence)}] : []),
    { key: AMSG_FIRE_PACK_KEY, value: over.sharedValue ?? JSON.stringify(pack) },
    { key: AMSG_TOOL_PACK_KEY, value: JSON.stringify(buildToolPack({ id: charId, name: '角色' } as any)) },
    { key: AMSG_LIMITS_KEY, value: JSON.stringify({ v: 1, selfScheduleEnabled: over.enabled ?? true, maxUnansweredSends: 0, minSendGapMinutes: 0, ...over.limits }) },
    ...(over.selfLog ? [{ key: AMSG_SELF_LOG_KEY, value: JSON.stringify(over.selfLog) }] : []),
  ];
  const scheduleTask = vi.fn<NonNullable<Parameters<typeof runFireScheduleTool>[1]>>(async (options) => {
    if (over.failNextSchedule) throw new Error('simulated unavailable scheduler');
    if (!options.uuid) throw new Error('Expected a deterministic self-scheduled task UUID');
    return { created: true, id: 2, uuid: options.uuid, nextSendAt: options.firstSendTime };
  });
  const ctx: any = {
    task: over.task ?? { id: 1, uuid, contactName: '角色', nextSendAt: new Date(nowMs).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgClientTaskId: 'instant-client', amsgInstantChat: true, amsgMode: 'instant' } },
    userId: 'audit-user', now: new Date(nowMs), scratch: {}, scheduleTask,
    ...(over.remote ? { listTasks: async () => ({ tasks: over.remote, pagination: { hasMore: false } }) } : {}),
    renewTask: vi.fn(async (_uuid: string, sendAt: string) => ({ renewed: true, nextSendAt: sendAt })),
    cancelTask: vi.fn(async () => ({ cancelled: true })),
    readState: vi.fn(async (namespace: string) => namespace.startsWith('amsg:char:') ? rows : [
      { key: AMSG_TOOL_CONFIG_KEY, value: JSON.stringify(over.config ?? buildToolConfig(undefined)) },
    ]),
    writeState: vi.fn(async () => ({ upserted: 1, skipped: 0, deleted: 0 })),
  };
  const plan: any = await amsgHooks.onBeforeFire(ctx);
  return { ctx, plan, stash: ctx.scratch.fire, scheduleTask, pack };
}

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); });

describe('amsg2 audit regressions', () => {
  it('date presence does not defer or discard ordinary scheduled contact', async () => {
    const task = {id:60,uuid,contactName:'角色',nextSendAt:new Date(now).toISOString(),recurrenceType:'none',
      metadata:{charId,amsgMode:'auto',amsgClientTaskId:'ordinary',amsgTaskInstruction:'出门后报备',amsgExpirePolicy:'expire'}};
    const result = await start({task,presence:{v:1,charId,scene:'date',activeAt:now,lastUserMessageAt:null},
      limits:{awaySceneLock:'date',awayDateEncounterId:'e'}});
    expect(result.plan.defer).toBeUndefined();
    expect(result.plan.skip).toBeUndefined();
    const output:any = await amsgHooks.onLLMOutput({...result.ctx,taskId:60,sessionId:'date-ordinary',
      iteration:0,metadata:task.metadata,llmOutputText:'我出门啦。'});
    expect(output.decision).toBe('finish');
  });

  it('optional date reminder defers while present; after leaving sends once without scheduling tools or ending the date', async () => {
    const task = {id:61,uuid,contactName:'角色',nextSendAt:new Date(now).toISOString(),recurrenceType:'none',
      metadata:{charId,amsgMode:'auto',amsgClientTaskId:'reminder',amsgDateLeave:true,amsgDateLeaveDelayMinutes:5,
        amsgTaskInstruction:'见面离开提醒',amsgExpirePolicy:'force'}};
    const limits={dateLeaveEnabled:true,awaySceneLock:'date',awayDateEncounterId:'e',dailySendCap:1};
    const present=await start({task,limits,presence:{v:1,charId,scene:'date',activeAt:now,lastUserMessageAt:null}});
    expect(present.plan).toEqual({defer:{afterMs:5*60_000}});
    const left=await start({task,limits,presence:{v:1,charId,scene:'date',activeAt:now-5*60_000,lastUserMessageAt:null},
      template:BEFORE_SPEAK_LINES.join('\n')+'\n{{AMSG_TASK_INSTRUCTION}}'});
    expect(left.plan.skip).toBeUndefined();
    expect(JSON.stringify(left.plan.tools ?? [])).not.toContain('schedule_active_message');
    expect(JSON.stringify(left.plan.messages)).not.toContain('【开口之前】');
    expect(left.stash.dateExitEncounterId).toBeNull();
    expect(left.scheduleTask).not.toHaveBeenCalled();
    // Returned to the date while generating: suppress the stale reminder.
    left.ctx.readState.mockResolvedValue([
      {key:AMSG_LIMITS_KEY,value:JSON.stringify({v:1,selfScheduleEnabled:true,...limits})},
      {key:'chat_presence',value:JSON.stringify({v:1,charId,scene:'date',activeAt:now,lastUserMessageAt:null})},
    ]);
    const returned:any = await amsgHooks.onLLMOutput({...left.ctx,taskId:61,sessionId:'reminder-return',iteration:0,
      metadata:task.metadata,llmOutputText:'我还在这儿。'});
    expect(returned.decision).toBe('skip-push');
  });

  it('date reminder disabled or ended is skipped before generation', async () => {
    const task={id:62,uuid,nextSendAt:new Date(now).toISOString(),recurrenceType:'none',
      metadata:{charId,amsgMode:'auto',amsgClientTaskId:'off-reminder',amsgDateLeave:true,amsgDateLeaveDelayMinutes:5,
        amsgTaskInstruction:'见面离开提醒',amsgExpirePolicy:'force'}};
    for (const limits of [{dateLeaveEnabled:false,awaySceneLock:'date'},{dateLeaveEnabled:true,awaySceneLock:null}]) {
      const result=await start({task,limits,presence:{v:1,charId,scene:'date',activeAt:now-5*60_000,lastUserMessageAt:null}});
      expect(result.plan).toEqual({skip:true});
      expect(result.stash).toBeUndefined();
    }
  });

  it('ordinary scheduled contact sees meeting context and can choose silence or depart without a hard lock', async () => {
    const task = { id: 51, uuid: '99999999-9999-4999-8999-999999999999', contactName: '角色',
      nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: {charId, amsgMode: 'auto', amsgClientTaskId: 'ordinary-before-date',
        amsgTaskInstruction: '六点半起床轻手轻脚出门后报备', amsgExpirePolicy: 'expire'} };
    const result = await start({task, limits:{awaySceneLock:'date', awayDateEncounterId:'meet-current'}});
    expect(result.plan.skip).toBeUndefined();
    expect(JSON.stringify(result.plan.messages)).toContain('六点半起床');
    expect(JSON.stringify(result.plan.messages)).toContain('切换应用、锁屏');
    expect(JSON.stringify(result.plan.messages)).toContain('线下见面尚未明确结束');
    expect(result.scheduleTask).not.toHaveBeenCalled();
    const silent: any = await amsgHooks.onLLMOutput({...result.ctx, taskId:51, sessionId:'date-silent',
      iteration:0, metadata:task.metadata, contactName:'角色', llmOutputText:AMSG_SILENT_MARK});
    expect(silent.decision).toBe('skip-push');
    expect(result.stash.dateExitHadVisibleMessage).not.toBe(true);

    const departing = await start({task, limits:{awaySceneLock:'date', awayDateEncounterId:'meet-current'}});
    const speech: any = await amsgHooks.onLLMOutput({...departing.ctx, taskId:51, sessionId:'date-depart',
      iteration:0, metadata:task.metadata, contactName:'角色', llmOutputText:'我出门啦，你接着睡。'});
    expect(speech.decision).toBe('finish');
    expect(speech.pushPayloads[0].metadata.amsgDateEndedEncounterId).toBe('meet-current');
    await amsgFireSettled({status:'sent',sentCount:1,scratch:departing.ctx.scratch,writeState:departing.ctx.writeState} as any);
    const entries = vi.mocked(departing.ctx.writeState).mock.calls.flatMap(([, values]:any[])=>values);
    expect(JSON.parse(entries.find((e:any)=>e.key===AMSG_LIMITS_KEY).value)).toMatchObject({awaySceneLock:null});
  });

  it('B-mode quiet slot waits until the quiet end and schedules the next tick at that time', async () => {
    const task = {
      id: 30, uuid: '33333333-3333-4333-8333-333333333333',
      contactName: '角色', nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: {
        charId, amsgClientTaskId: 'away-old', amsgAwayMessage: true, amsgAwayDelayMinutes: 120,
        amsgTaskInstruction: '主动私聊', amsgExpirePolicy: 'force',
      },
    };
    const result = await start({
      task, limits: { awayEnabled: true, awayDelayMinutes: 120,
        awayQuietHours: { enabled: true, startTime: '18:00', endTime: '20:00' } },
    });
    expect(result.plan).toEqual({ defer: { afterMs: 60 * 60_000 } });
    expect(result.scheduleTask).not.toHaveBeenCalled();
    const afterQuiet = await start({
      task, nowMs: now + 60 * 60_000,
      limits: { awayEnabled: true, awayDelayMinutes: 120,
        awayQuietHours: { enabled: true, startTime: '18:00', endTime: '20:00' } },
    });
    expect(afterQuiet.plan.skip).toBeUndefined();
    expect(afterQuiet.scheduleTask).toHaveBeenCalledTimes(1);
    const next = afterQuiet.scheduleTask.mock.calls[0][0];
    expect(next.messageSubtype).toBe('chat');
    expect(next.metadata?.amsgAwayMessage).toBe(true);
    expect(next.metadata?.amsgSelfScheduled).toBeUndefined();
    expect(Date.parse(next.firstSendTime)).toBe(now + 3 * 60 * 60_000);
  });

  it('同一个 B 空闲节拍被 Worker 重试时只会请求同一个下一节拍 UUID', async () => {
    const task = {
      id: 44, uuid: '99999999-9999-4999-8999-999999999999',
      contactName: '角色', nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgClientTaskId: 'away-retry', amsgAwayMessage: true,
        amsgAwayDelayMinutes: 120, amsgTaskInstruction: '自由分享生活', amsgExpirePolicy: 'force' },
    };
    const first = await start({ task, limits: { awayEnabled: true, awayDelayMinutes: 120 } });
    const retry = await start({ task, limits: { awayEnabled: true, awayDelayMinutes: 120 } });
    expect(first.scheduleTask).toHaveBeenCalledTimes(1);
    expect(retry.scheduleTask).toHaveBeenCalledTimes(1);
    const [next1] = first.scheduleTask.mock.calls[0];
    const [next2] = retry.scheduleTask.mock.calls[0];
    expect(next1.uuid).toBe(next2.uuid);
    expect(next1.firstSendTime).toBe(next2.firstSendTime);
    expect(next1.uuid).not.toBe(task.uuid);
    expect(Date.parse(next1.firstSendTime)).toBe(now + 120 * 60_000);
  });

  it('服务停摆多节拍后恢复时，只续排未来一个节拍且不补发旧正文', async () => {
    const task = {
      id: 45, uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      nextSendAt: new Date(now - 10 * 3600_000).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgClientTaskId: 'away-old-lost', amsgAwayMessage: true,
        amsgAwayDelayMinutes: 120, amsgTaskInstruction: '自由分享生活', amsgExpirePolicy: 'force' },
    };
    const result = await start({ task, limits: { awayEnabled: true, awayDelayMinutes: 120 } });
    expect(result.scheduleTask).toHaveBeenCalledTimes(1);
    const [next] = result.scheduleTask.mock.calls[0];
    expect(Date.parse(next.firstSendTime)).toBeGreaterThan(now);
    expect(Date.parse(next.firstSendTime)).toBeLessThanOrEqual(now + 120 * 60_000);
    expect(result.plan).toEqual({ skip: true });
  });

  it('云端续排失败时延后原任务重试，不因 B方案零生成重试而断链或烧模型', async () => {
    const task = {
      id: 46, uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      contactName: '角色', nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgClientTaskId: 'away-scheduler-failure', amsgAwayMessage: true,
        amsgAwayDelayMinutes: 120, amsgTaskInstruction: '分享生活', amsgExpirePolicy: 'force' },
    };
    const failing = await start({ task, failNextSchedule: true, limits: { awayEnabled: true } });
    expect(failing.scheduleTask).toHaveBeenCalledTimes(1);
    expect(failing.plan).toEqual({ defer: { afterMs: 5 * 60_000 } });
    expect(failing.stash).toBeUndefined(); // 还没进入正文/模型生成阶段。
    const recovered = await start({ task, limits: { awayEnabled: true } });
    expect(recovered.scheduleTask).toHaveBeenCalledTimes(1);
    expect(recovered.plan.skip).toBeUndefined();
    expect(recovered.plan.defer).toBeUndefined();
    expect(recovered.stash).toBeDefined();
    expect(recovered.scheduleTask.mock.calls[0][0].uuid).toBe(
      failing.scheduleTask.mock.calls[0][0].uuid,
    );
  });

  it('B-mode due tick gives the original autonomous silent choice without a second model call', async () => {
    const task = {
      id: 43, uuid: '88888888-8888-4888-8888-888888888888',
      contactName: '角色', nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgClientTaskId: 'away-previous', amsgAwayMessage: true,
        amsgAwayDelayMinutes: 120, amsgTaskInstruction: '分享生活', amsgExpirePolicy: 'force' },
    };
    const withDecision = await start({ task, limits: { awayEnabled: true },
      template: [BEFORE_SPEAK_LINES.join('\n'), '{{AMSG_TASK_INSTRUCTION}}'].join('\n'),
    });
    expect(withDecision.plan.skip).toBeUndefined();
    expect(withDecision.scheduleTask).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(withDecision.plan.messages)).toContain(AMSG_SILENT_MARK);
  });

  it('B-mode meeting lock skips idle message but leaves character-scheduled messages alone', async () => {
    const task = { id: 31, uuid: '44444444-4444-4444-8444-444444444444',
      nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgAwayMessage: true, amsgAwayDelayMinutes: 120, amsgClientTaskId: 'away-previous',
        amsgTaskInstruction: '私聊', amsgExpirePolicy: 'force' } };
    const awayResult = await start({ task, awaySceneLock: 'date', limits: { awayEnabled: true } });
    expect(awayResult.plan).toEqual({ skip: true });
    expect(awayResult.scheduleTask).toHaveBeenCalledTimes(1);
    const own = await start({ awaySceneLock: 'date', limits: {
      awayQuietHours: { enabled: true, startTime: '00:00', endTime: '00:00' },
    } });
    expect(own.plan.skip).toBeUndefined();
  });

  it('scheduled online speech ends only the matching persisted in-person encounter after delivery', async () => {
    const task = { id: 49, uuid: '66666666-6666-4666-8666-666666666666',
      contactName: '角色', nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgMode: 'auto', amsgClientTaskId: 'online-after-meeting',
        amsgSelfScheduled: true, amsgDateExitEncounterId: 'meet-123',
        amsgTaskInstruction: '出门后线上发消息', amsgExpirePolicy: 'expire' } };
    const { ctx, plan, stash } = await start({ task, limits: {
      awaySceneLock: 'date', awayDateEncounterId: 'meet-123',
    } });
    expect(plan.skip).toBeUndefined();
    expect(stash.dateExitEncounterId).toBe('meet-123');
    stash.selfLogTexts = ['出门啦'];
    stash.dateExitHadVisibleMessage = true;
    await amsgFireSettled({ status: 'sent', sentCount: 1, scratch: ctx.scratch,
      writeState: ctx.writeState } as any);
    const calls = vi.mocked(ctx.writeState).mock.calls;
    const update = calls.flatMap(([, entries]: any[]) => entries).find((entry: any) => entry.key === AMSG_LIMITS_KEY);
    expect(update).toBeTruthy();
    expect(JSON.parse(update.value)).toMatchObject({ awaySceneLock: null, awayDateEncounterId: null, awayDateEndedAt: now });
  });

  it('no spoken online message or a stale encounter cannot release the meeting lock', async () => {
    const task = { id: 50, uuid: '77777777-7777-4777-8777-777777777777',
      contactName: '角色', nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgMode: 'auto', amsgClientTaskId: 'online-after-meeting',
        amsgSelfScheduled: true, amsgDateExitEncounterId: 'meet-old',
        amsgTaskInstruction: '出门后线上发消息', amsgExpirePolicy: 'expire' } };
    const missing = await start({ task, limits: { awaySceneLock: 'date', awayDateEncounterId: 'meet-old' } });
    missing.stash.selfLogTexts = ['这条没发'];
    missing.stash.dateExitHadVisibleMessage = true;
    await amsgFireSettled({ status: 'skipped', sentCount: 0, scratch: missing.ctx.scratch,
      writeState: missing.ctx.writeState } as any);
    expect(vi.mocked(missing.ctx.writeState).mock.calls.flatMap(([, entries]: any[]) => entries)
      .some((entry: any) => entry.key === AMSG_LIMITS_KEY)).toBe(false);

    const old = await start({ task, limits: { awaySceneLock: 'date', awayDateEncounterId: 'meet-new' } });
    expect(old.stash.dateExitEncounterId).toBeNull();
    old.stash.selfLogTexts = ['出门啦'];
    old.stash.dateExitHadVisibleMessage = true;
    await amsgFireSettled({ status: 'sent', sentCount: 1, scratch: old.ctx.scratch,
      writeState: old.ctx.writeState } as any);
    expect(vi.mocked(old.ctx.writeState).mock.calls.flatMap(([, entries]: any[]) => entries)
      .some((entry: any) => entry.key === AMSG_LIMITS_KEY)).toBe(false);
  });

  it('disabling idle messages in cloud limits stops chained tasks without generating or rearming', async () => {
    const task = { id: 32, uuid: '55555555-5555-4555-8555-555555555555',
      nextSendAt: new Date(now).toISOString(), recurrenceType: 'none',
      metadata: { charId, amsgAwayMessage: true, amsgAwayDelayMinutes: 120, amsgTaskInstruction: '私聊',
        amsgExpirePolicy: 'force' } };
    const result = await start({ task, limits: { awayEnabled: false } });
    expect(result.plan).toEqual({ skip: true });
    expect(result.scheduleTask).not.toHaveBeenCalled();
  });

  it('native tools OFF survives an empty MCP list and suppresses native tool declarations', async () => {
    const config = buildToolConfig(undefined, { servers: [], useNativeTools: false });
    expect(config.mcpUseNativeTools).toBe(false);
    const { plan } = await start({ config });
    expect(plan.tools).toBeUndefined();
  });

  it('disabled scheduling never executes a code-example scheduling call', async () => {
    const { ctx, plan, scheduleTask } = await start({ enabled: false });
    expect(plan.tools).toBeUndefined();
    const output: any = await amsgHooks.onLLMOutput({
      ...ctx, taskId: 1, sessionId: 'audit-session', iteration: 0,
      metadata: ctx.task.metadata, contactName: '角色',
      llmOutputText: '下面只是调用示例：\n```js\nschedule_active_message({"send_at":"2026-10-18T10:30:00Z"})\n```',
    });
    expect(output.decision).not.toBe('tool-request');
    expect(scheduleTask).not.toHaveBeenCalled();
  });

  it('enabled scheduling ignores fenced and inline examples while accepting an explicit bare call', async () => {
    const { ctx, scheduleTask } = await start();
    const example: any = await amsgHooks.onLLMOutput({
      ...ctx, taskId: 1, sessionId: 'example', iteration: 0, metadata: ctx.task.metadata, contactName: '角色',
      llmOutputText: '示例：`schedule_active_message({"send_at":"2026-10-18T10:30:00Z"})`\n```js\nschedule_active_message({"send_at":"2026-10-18T10:30:00Z"})\n```',
    });
    expect(example.decision).not.toBe('tool-request');
    expect(scheduleTask).not.toHaveBeenCalled();
    const explicit: any = await amsgHooks.onLLMOutput({
      ...ctx, taskId: 1, sessionId: 'explicit', iteration: 0, metadata: ctx.task.metadata, contactName: '角色',
      llmOutputText: 'schedule_active_message({"send_at":"2026-10-18T10:30:00Z"})',
    });
    expect(explicit.decision).toBe('tool-request');
  });

  it('execution rejects scheduling even when a caller supplies a tool call after the user disabled it', async () => {
    const { ctx, scheduleTask } = await start({ enabled: false });
    const result = await amsgHooks.executeToolCalls([{
      id: 'blocked', function: { name: 'schedule_active_message', arguments: '{"send_at":"2026-10-18T10:30:00Z"}' },
    }], ctx);
    expect(result[0].content).toContain('schedule_disabled');
    expect(scheduleTask).not.toHaveBeenCalled();
  });

  it('bound instant input refreshes scheduled context while retaining the legacy shared chat', async () => {
    const base = await start();
    const bound = { ...base.pack, builtAt: now, template: 'LATEST_SCHEDULED_HISTORY', lastUserMessageAt: now,
      chat: { builtAt: now, messages: [{ role: 'user', content: 'BOUND_INSTANT_INPUT' }] } };
    const next = await start({ task: { ...base.ctx.task, taskInput: { firePack: bound, firePackUpdatedAt: now } } });
    expect(JSON.stringify(next.plan.messages)).toContain('BOUND_INSTANT_INPUT');
    const writes = next.ctx.writeState.mock.calls.flatMap((call: any[]) => call[1]);
    const shared = writes.find((entry: any) => entry.key === AMSG_FIRE_PACK_KEY);
    expect(shared?.updatedAt).toBe(now);
    expect(JSON.parse(shared.value)).toMatchObject({ template: 'LATEST_SCHEDULED_HISTORY', lastUserMessageAt: now,
      chat: { messages: [{ role: 'user', content: '你好' }] } });
  });

  it('a corrupt shared snapshot cannot reject an intact bound instant input', async () => {
    const base = await start();
    const bound = { ...base.pack, chat: { builtAt: now, messages: [{ role: 'user', content: 'INTACT_BOUND_INPUT' }] } };
    const next = await start({ sharedValue: 'gz1:not-valid-gzip',
      task: { ...base.ctx.task, taskInput: { firePack: bound } } });
    expect(JSON.stringify(next.plan.messages)).toContain('INTACT_BOUND_INPUT');
    expect(next.ctx.writeState.mock.calls.flatMap((call: any[]) => call[1]).some((entry: any) => entry.key.startsWith('chat_fail:'))).toBe(false);
  });

  it('a missing bound input never falls back to another round in the shared snapshot', async () => {
    const base = await start();
    await expect(start({ task: { ...base.ctx.task, taskInput: { firePackRef: {
      namespace: 'amsg:instant-input', key: uuid,
    } } } })).rejects.toThrow('即时输入缺失');
  });

  it('an older bound task cannot replace a newer shared pack or re-enable disabled scheduling', async () => {
    const base = await start();
    const old = { ...base.pack, builtAt: now - 120_000,
      chat: { builtAt: now - 120_000, messages: [{ role: 'user', content: 'OLDER_BOUND_INPUT' }] } };
    const next = await start({ enabled: false, builtAt: now,
      task: { ...base.ctx.task, taskInput: { firePack: old, firePackUpdatedAt: now - 120_000 } } });
    expect(JSON.stringify(next.plan.messages)).toContain('OLDER_BOUND_INPUT');
    expect(next.plan.tools).toBeUndefined();
    expect(next.ctx.writeState.mock.calls.flatMap((call: any[]) => call[1]).some((entry: any) => entry.key === AMSG_FIRE_PACK_KEY)).toBe(false);
    expect((await runFireScheduleTool(next.stash, next.scheduleTask, { send_at: '2026-10-18T12:00:00Z' }, now)).reason).toBe('schedule_disabled');
  });

  it('a transfer-only output emits a durable action result without marking the reply failed', async () => {
    const { ctx } = await start();
    const emitResult = vi.fn(async () => ({ messageId: 'actions-result', pushed: false }));
    const output = await amsgHooks.onLLMOutput({
      ...ctx, emitResult, taskId: 1, taskUuid: ctx.task.uuid, sessionId: 'actions', iteration: 0,
      metadata: ctx.task.metadata, contactName: '角色', llmOutputText: '[[ACTION:TRANSFER:520]]',
    });
    expect(output.decision).toBe('skip-push');
    expect(emitResult).toHaveBeenCalledWith(expect.objectContaining({
      resultKind: 'assistant-actions', notification: { show: false },
      push: expect.objectContaining({ metadata: expect.objectContaining({ directives: [{ type: 'transfer', amount: 520 }] }) }),
    }));
    expect(ctx.writeState.mock.calls.flatMap((call: any[]) => call[1]).some((entry: any) => entry.key.startsWith('chat_fail:'))).toBe(false);
  });

  it('failed action-result persistence fails the fire so it can be retried', async () => {
    const { ctx } = await start();
    await expect(amsgHooks.onLLMOutput({
      ...ctx, emitResult: async () => { throw new Error('result storage unavailable'); },
      taskId: 1, taskUuid: ctx.task.uuid, sessionId: 'actions-fail', iteration: 0,
      metadata: ctx.task.metadata, contactName: '角色', llmOutputText: '[[ACTION:TRANSFER:520]]',
    })).rejects.toThrow('result storage unavailable');
  });

  it('the authoritative task list removes stale snapshots and keeps a still-pending overdue task', async () => {
    const ghost = makeTask(30, now + 3_600_000);
    const late = makeTask(31, now - 86_400_000);
    const { stash } = await start({ pending: [ghost], remote: [{
      uuid: late.taskUuid, charId, clientTaskId: late.clientTaskId, status: 'pending',
      nextSendAt: late.firstSendTime, recurrenceType: 'none', messageType: 'auto',
      metadata: { charId, amsgSelfScheduled: true, amsgExpirePolicy: 'expire' },
    }, { uuid: 'other-char', charId: 'unrelated', status: 'pending', nextSendAt: late.firstSendTime },
    { uuid: 'instant-task', charId, status: 'pending', nextSendAt: late.firstSendTime, metadata: { amsgInstantChat: true } }] });
    expect(stash.pendingTaskCount).toBe(1);
    expect(stash.pendingTasks.map((task: any) => task.taskUuid)).toEqual([late.taskUuid]);
    expect(stash.plannedSelfSends).toBe(1);
  });

  it('self-scheduled follow-ups from instant chat stay visible and counted', async () => {
    const { stash, scheduleTask } = await start();
    await runFireScheduleTool(stash, scheduleTask, { send_at: '2026-10-18T12:00:00Z' }, now);
    expect(scheduleTask.mock.calls[0][0].messageSubtype).toBe('chat');
    const legacy = makeTask(40, now + 3_600_000);
    const next = await start({ remote: [{
      uuid: legacy.taskUuid, charId, clientTaskId: legacy.clientTaskId, status: 'pending',
      nextSendAt: legacy.firstSendTime, recurrenceType: 'none', messageType: 'auto',
      messageSubtype: 'instant-chat',
      metadata: { charId, amsgSelfScheduled: true, amsgExpirePolicy: 'expire' },
    }, {
      uuid: 'instant-task', charId, status: 'pending', nextSendAt: legacy.firstSendTime,
      messageSubtype: 'instant-chat', metadata: { charId, amsgInstantChat: true },
    }] });
    expect(next.stash.pendingTasks.map((task: any) => task.taskUuid)).toEqual([legacy.taskUuid]);
    expect(next.stash.plannedSelfSends).toBe(1);
    expect(JSON.stringify(next.plan.messages)).toContain(legacy.taskUuid.slice(0, 8));
  });

  it('native transport OFF retains execution permission for an explicit text scheduling call', async () => {
    const { plan, ctx } = await start({ config: buildToolConfig(undefined, { servers: [], useNativeTools: false }) });
    expect(plan.tools).toBeUndefined();
    expect(plan.allowedToolNames).toContain('schedule_active_message');
    const output = await amsgHooks.onLLMOutput({ ...ctx, taskId: 1, sessionId: 'text-allowed', iteration: 0,
      metadata: ctx.task.metadata, contactName: '角色', llmOutputText: 'schedule_active_message({"send_at":"2026-10-18T12:00:00Z"})' });
    expect(output.decision).toBe('tool-request');
  });

  it('expired snapshot tasks do not occupy live task slots', async () => {
    const expired = Array.from({ length: 5 }, (_, i) => makeTask(i + 1, now - 86_400_000));
    expect(expired.every(task => !isPendingTask(task, now))).toBe(true);
    let selfLog = createSelfLog(now - 60_000, null);
    for (const task of expired) selfLog = appendSelfLogTask(selfLog, task);
    const { stash, scheduleTask, plan } = await start({ selfLog });
    expect(stash.pendingTaskCount).toBe(0);
    expect(JSON.stringify(plan.messages)).not.toContain('00000001');
    const result = await runFireScheduleTool(stash, scheduleTask, { send_at: '2026-10-18T11:00:00Z' }, now);
    expect(result.ok).toBe(true);
    expect(scheduleTask).toHaveBeenCalledOnce();
  });

  it('a fresh fire pack preserves live cloud-created tasks until adoption', async () => {
    const task = makeTask(8, now + 3_600_000);
    const selfLog = appendSelfLogTask(createSelfLog(now - 120_000, null), task);
    const { stash, plan } = await start({ selfLog, builtAt: now - 60_000 });
    expect(stash.pendingTasks).toEqual([task]);
    expect(JSON.stringify(plan.messages)).toContain('00000008');
  });

  it('an offline self-scheduling chain releases already-fired predecessors', async () => {
    let selfLog: any;
    let task: any;
    for (let step = 0; step <= 6; step += 1) {
      const clock = now + step * 2 * 3_600_000;
      vi.mocked(Date.now).mockReturnValue(clock);
      const { ctx, stash, scheduleTask } = await start({ nowMs: clock, task, selfLog });
      const result = await runFireScheduleTool(stash, scheduleTask, {
        send_at: new Date(clock + 2 * 3_600_000).toISOString(),
      }, clock);
      if (step === 6) {
        expect(result.ok).toBe(true);
        expect(stash.pendingTaskCount).toBe(0);
        break;
      }
      expect(result.ok).toBe(true);
      const next = stash.scheduledTasks[0];
      const finish: any = await amsgHooks.onLLMOutput({
        ...ctx, iteration: 0, taskId: 1, metadata: ctx.task.metadata,
        sessionId: `chain-${step}`, llmOutputText: '晚点再和你聊。',
      });
      expect(finish.decision).toBe('finish');
      await amsgFireSettled({ status: 'sent', sentCount: 1, scratch: ctx.scratch, writeState: ctx.writeState });
      const entries = ctx.writeState.mock.calls.flatMap((call: any[]) => call[1]);
      selfLog = JSON.parse(entries.findLast((entry: any) => entry.key === AMSG_SELF_LOG_KEY).value);
      task = {
        id: step + 2, uuid: next.taskUuid, contactName: '角色', nextSendAt: next.firstSendTime,
        recurrenceType: 'none', metadata: scheduleTask.mock.calls[0][0].metadata,
      };
    }
  });

  it('self-scheduled children carry a compact no-chat input reference, even with a large template', async () => {
    const { ctx, stash, scheduleTask } = await start();
    stash.firePack.template = '完整角色历史'.repeat(120_000);
    const result = await runFireScheduleTool(stash, scheduleTask, { send_at: '2026-10-18T12:00:00Z' }, now);
    expect(result.ok).toBe(true);
    const child = scheduleTask.mock.calls[0][0];
    expect(new TextEncoder().encode(JSON.stringify(child)).length).toBeLessThan(10_000);
    const ref = parseInstantInputRef(child.taskInput?.firePackRef);
    expect(ref).not.toBeNull();
    if (!ref) throw new Error('Expected a valid immutable input reference');
    const input = ctx.writeState.mock.calls.flatMap((call: any[]) => call[1]).find((entry: any) => entry.key === ref.key);
    const pack = JSON.parse(await unpackStateValue(JSON.parse(input.value).packedFirePack));
    expect(pack.chat).toBeUndefined();
    expect(pack.template).toBe(stash.firePack.template);
  });

  it('a scheduled task with current shared context does not need its expired fallback input', async () => {
    const base = await start();
    const next = await start({ task: { ...base.ctx.task,
      metadata: { ...base.ctx.task.metadata, amsgInstantChat: false, amsgMode: 'auto', amsgTaskInstruction: '晚点问问近况' },
      taskInput: { firePackRef: { namespace: 'amsg:instant-input', key: uuid } },
    } });
    expect(next.plan.messages).toBeTruthy();
    expect(next.ctx.readState.mock.calls.every((call: any[]) => call[0] !== 'amsg:instant-input')).toBe(true);
  });

  it('a newly uploaded pack retains an unadopted task from the real scheduling hook', async () => {
    const first = await start();
    const result = await runFireScheduleTool(first.stash, first.scheduleTask, { send_at: '2026-10-18T12:00:00Z' }, now);
    expect(result.ok).toBe(true);
    await amsgFireSettled({ status: 'skipped', scratch: first.ctx.scratch, writeState: first.ctx.writeState });
    const entries = first.ctx.writeState.mock.calls.flatMap((call: any[]) => call[1]);
    const selfLog = JSON.parse(entries.findLast((entry: any) => entry.key === AMSG_SELF_LOG_KEY).value);
    expect(selfLog.tasks).toHaveLength(1);
    // A new client snapshot can arrive before that task's adoption payload is consumed.
    const next = await start({ selfLog, builtAt: now });
    expect(next.stash.pendingTasks).toHaveLength(1);
    expect(first.scheduleTask).toHaveBeenCalledOnce();
  });

  it('renew enforces the same ten-minute gap as schedule', async () => {
    const target = makeTask(9, now + 3_600_000);
    const neighbor = makeTask(10, now + 20 * 60_000);
    const { stash, ctx, scheduleTask } = await start({ pending: [target, neighbor], limits: { minSendGapMinutes: 10 } });
    const sendAt = new Date(now + 22 * 60_000).toISOString();
    const scheduled = await runFireScheduleTool(stash, scheduleTask, { send_at: sendAt }, now);
    expect(scheduled.ok).toBe(false);
    expect(scheduled.reason).toBe('min_gap');
    const renewed = await runFireRenewTool(stash, ctx, { task_id: target.taskUuid, send_at: sendAt }, now);
    expect(renewed.ok).toBe(false);
    expect(renewed.reason).toBe('min_gap');
    expect(ctx.renewTask).not.toHaveBeenCalled();
    // The in-flight pending view also keeps the old timestamp after a successful renewal.
    expect(stash.pendingTasks.find((task: any) => task.taskUuid === target.taskUuid).firstSendTime).toBe(target.firstSendTime);
  });

  it('a skipped one-off is taught to create a new task rather than renew a missing target', async () => {
    const expired = makeTask(11, now - 3_600_000);
    const text = buildAmsg2NoticesText([{
      id: `${expired.taskUuid}:${now - 3_600_000}`, charId, occurrenceMs: now - 3_600_000,
      mode: 'auto', recurrenceType: 'none', reason: 'declined', createdAt: now,
    } as any], 'Asia/Tokyo');
    expect(text).toContain('schedule_active_message');
    expect(text).not.toContain('renew_active_message');
    const { stash, ctx, plan } = await start({ chatMessages: [{ role: 'system', content: text }, { role: 'user', content: '晚点再说' }] });
    expect(JSON.stringify(plan.messages)).toContain('00000011');
    const result = await runFireRenewTool(stash, ctx, { task_id: '00000011', send_at: '2026-10-18T11:00:00Z' }, now);
    expect(result.ok).toBe(false);
    expect(ctx.renewTask).not.toHaveBeenCalled();
    expect(ctx.scheduleTask).not.toHaveBeenCalled();
  });

  it('a subsequent schedule call sees the renewed time and rejects a one-minute conflict', async () => {
    const target = makeTask(12, now + 60 * 60_000);
    const { stash, ctx, scheduleTask } = await start({ pending: [target], limits: { minSendGapMinutes: 10 } });
    expect((await runFireRenewTool(stash, ctx, {
      task_id: target.taskUuid, send_at: new Date(now + 90 * 60_000).toISOString(),
    }, now)).ok).toBe(true);
    const next = await runFireScheduleTool(stash, scheduleTask, {
      send_at: new Date(now + 91 * 60_000).toISOString(),
    }, now);
    expect(next.ok).toBe(false);
    expect(next.reason).toBe('min_gap');
    expect(scheduleTask).not.toHaveBeenCalled();
  });

  it('oversized XHS data uses an owner-scoped immutable attachment when the SDK supports it', async () => {
    const storeAttachment = vi.fn(async () => ({ version: 1 as const, namespace: 'amsg:attachments', key: 'unique-ref',
      taskUuid: uuid, occurrenceMs: now, expiresAt: now + 30 * 86_400_000 }));
    const xhsSession = { notes: [{ note: { desc: '正文'.repeat(3000) } }] };
    const output: any = await offloadOversizedPush({ message: '卡片', metadata: { amsgOccurrenceMs: now, xhsSession } },
      undefined, charId, 'client-task', 0, storeAttachment);
    expect(output.metadata.xhsSession).toBeUndefined();
    expect(output.metadata.xhsSessionAttachment).toMatchObject({ key: 'unique-ref', taskUuid: uuid, occurrenceMs: now });
    expect(storeAttachment).toHaveBeenCalledWith(JSON.stringify(xhsSession), { owner: { type: 'character', id: charId }, kind: 'sidechannel' });
  });

  it('the final output hook routes oversized reasoning through the SDK attachment writer', async () => {
    const { ctx } = await start();
    const ref = { version: 1, namespace: 'amsg:attachments', key: 'reasoning-unique', taskUuid: uuid,
      occurrenceMs: now, expiresAt: now + 30 * 86_400_000 };
    const storeAttachment = vi.fn(async () => ref);
    const output: any = await amsgHooks.onLLMOutput({ ...ctx, storeAttachment, taskId: 1,
      sessionId: 'attachment-session', iteration: 0, metadata: ctx.task.metadata, contactName: '角色',
      llmOutputText: '我在这里。', llmResponse: { choices: [{ message: {
        content: '我在这里。', reasoning_content: '想起今天的事。'.repeat(600),
      } }] },
    });
    expect(output.decision).toBe('finish');
    expect(output.pushPayloads[0].metadata.amsgReasoningAttachment).toEqual(ref);
    expect(storeAttachment).toHaveBeenCalledOnce();
  });

  it('two occurrences of a recurring task retain independent XHS sidechannel values', async () => {
    const state = new Map<string, string>();
    const writeState: any = async (_namespace: string, entries: any[]) => {
      for (const entry of entries) state.set(entry.key, entry.value);
      return { upserted: entries.length, skipped: 0, deleted: 0 };
    };
    const payload = (day: string) => {
      const notes = Array.from({ length: 8 }, (_, index) => ({
        noteId: `${day}-${index}`, title: '今天路过的一家小店，记下这个角落',
        desc: '店里的书和下午的阳光都很好，下次还想来坐一会儿。'.repeat(6),
        author: '旅行记录', authorId: `author-${index}`, likes: 32,
        coverUrl: `https://images.example.com/note-${index}.jpg`,
      }));
      const xhsSession = buildXhsSessionPayload(notes.map((_, index) => ({ type: 'xhs_share', idx: index + 1 })), notes, []);
      expect(xhsSession!.notes.every(item => item.note.desc.length <= 120)).toBe(true);
      return { message: `分享${day}的笔记`, metadata: {
        amsgOccurrenceMs: day === '第一天' ? now : now + 86_400_000, xhsSession,
      } };
    };
    const first: any = await offloadOversizedPush(payload('第一天'), writeState, charId, 'same-recurring-task');
    const second: any = await offloadOversizedPush(payload('第二天'), writeState, charId, 'same-recurring-task');
    expect(first.metadata.xhsSessionRef).not.toBe(second.metadata.xhsSessionRef);
    expect(first.metadata.xhsSessionRef).toBeTruthy();
    expect(JSON.parse(state.get(first.metadata.xhsSessionRef)!).notes[0].note.noteId).toBe('第一天-0');
  });

  it('one-off instant-chat deletes its consumed amsg:instant-input key on terminal settlement', async () => {
    const base = await start();
    const inputKey = '22222222-2222-4222-8222-222222222222';
    const envelopeValue = JSON.stringify({
      v: 1,
      charId,
      packedFirePack: JSON.stringify(base.pack),
    });
    const readState = vi.fn(async (namespace: string) => {
      if (namespace === 'amsg:instant-input') return [{ key: inputKey, value: envelopeValue }];
      return base.ctx.readState(namespace);
    });
    const writeState = vi.fn(async () => ({ upserted: 1, skipped: 0, deleted: 1 }));
    const ctx: any = {
      ...base.ctx,
      scratch: {},
      readState,
      writeState,
      task: {
        ...base.ctx.task,
        taskInput: {
          firePackRef: { namespace: 'amsg:instant-input', key: inputKey },
          firePackUpdatedAt: now,
        },
      },
    };
    await amsgHooks.onBeforeFire(ctx);

    // Non-terminal failure (willRetry: true) must NOT delete the input yet
    await amsgFireSettled({
      status: 'failed',
      willRetry: true,
      sentCount: 0,
      scratch: ctx.scratch,
      writeState,
    } as any);
    expect(writeState).not.toHaveBeenCalledWith('amsg:instant-input', [{ key: inputKey, value: null }]);

    // Terminal settlement deletes the consumed instant-input key exactly once
    await amsgFireSettled({
      status: 'sent',
      sentCount: 1,
      scratch: ctx.scratch,
      writeState,
    } as any);
    expect(writeState).toHaveBeenCalledWith('amsg:instant-input', [{ key: inputKey, value: null }]);
  });
});
