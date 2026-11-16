import type { CharacterProfile } from '../types';
import { isAmsg2EnabledForChar } from './amsg2Tasks';
import { isAmsg2GlobalReady, createAmsg2ToolSession, executeAmsg2ToolWithOutcome } from './amsg2ToolBridge';
import { buildSendAtExample, extractFireScheduleTextCalls } from './amsgFireSchedule';
import { getAmsgActiveDateEncounterId } from './amsgInteractionGuard';
import { resolveCharTimeZone } from './timezone';

type ToolBase = Parameters<typeof createAmsg2ToolSession>[0];
type InPersonScheduleOutcome = Awaited<ReturnType<typeof executeAmsg2ToolWithOutcome>>['outcome'];

/**
 * 只向用户展示固定中文原因，不透传 Worker / 供应商的原始错误信息：
 * 它们可能夹带后台地址、令牌、模型上下文等敏感字段。
 */
export function explainInPersonScheduleFailure(outcome: InPersonScheduleOutcome): string {
    if (outcome.status === 'duplicate') return '同一轮已经约过这条时间，重复预约未创建';
    if (outcome.status === 'rejected') {
        switch (outcome.reason) {
            case 'unanswered_limit':
                return '未回复期间的连发额度已满；请确认「主动频率」里的「不限」已经保存';
            case 'min_gap':
                return '预约时间与现有任务太接近，请检查「两次之间至少隔多久」';
            case 'recurring_not_allowed':
                return '角色没有获得安排每天/每周重复消息的权限';
            default:
                return '当前预约未能通过规则校验，请检查主动频率与待执行任务';
        }
    }
    // 用户界面要告诉用户是哪道限额拦的，但绝不暴露原始错误正文。
    const error = outcome.message ?? '';
    if (/已经排好了\s*\d+\s*次主动消息|任务名额已满|排程任务.*上限/.test(error)) {
        return '同时挂着的预约任务达到名额上限；「不限连发」并不会取消这项限制';
    }
    if (/Failed to fetch|network|fetch failed|timeout|超时|503|502|CORS/i.test(error)) {
        return '连接云端 Worker 失败，请检查网络和主动消息 2.0 的连接状态';
    }
    if (/时间|send_at|future|past|太近|at least|invalid/i.test(error)) {
        return '预约时间无效或离现在太近，请调整到将来的有效时间';
    }
    return '云端创建任务失败；不是已经确认的三次连发拦截，请检查连接与待执行任务';
}

export interface InPersonScheduleContext {
    prompt: string;
    actors: CharacterProfile[];
    encounters: Map<string, string>;
    requireActorId: boolean;
}

/** 两种真实见面共用同一许可与执行链路；虚构、未开启 2.0、重掷不开放。 */
export async function prepareInPersonScheduling(
    actors: CharacterProfile[], realMeeting: boolean, allowScheduling = true, expectedEncounters?: Map<string, string>,
): Promise<InPersonScheduleContext> {
    const capturedEncounters = new Map<string, string>();
    const eligible = realMeeting && allowScheduling
        ? actors.filter(actor => {
            const encounter = getAmsgActiveDateEncounterId(actor.id);
            if (encounter) capturedEncounters.set(actor.id, encounter);
            return isAmsg2EnabledForChar(actor) && encounter
                && (!expectedEncounters || expectedEncounters.get(actor.id) === encounter);
        }) : [];
    const enabled = eligible.length && await isAmsg2GlobalReady() ? eligible : [];
    const context: InPersonScheduleContext = {
        prompt: '', actors: enabled, requireActorId: actors.length > 1,
        encounters: new Map(enabled.map(actor => [actor.id, capturedEncounters.get(actor.id)!])),
    };
    if (!enabled.length) return context;
    const actorInfo = enabled.map(actor => {
        const tzId = resolveCharTimeZone(actor) || Intl.DateTimeFormat().resolvedOptions().timeZone;
        return `角色 ${JSON.stringify(actor.name)}，character_id=${JSON.stringify(actor.id)}，时区 ${tzId}，明天此刻示例 ${buildSendAtExample(Date.now(), {tzId})}`;
    }).join('\n');
    context.prompt = [
        '【线下会话的未来主动联系工具】',
        '你此刻仍然和对方在同一线下场景。主动消息 2.0 排下的所有任务，都是未来要真正通过线上聊天发给对方的消息，不是线下提醒、当面台词或待办事项。',
        '只有你确实打算在将来那个时刻与对方分开、通过线上消息主动联系，才允许排程（例如你明早 06:30 出门，届时想发消息报备）。',
        '现在能够当面说的事就直接当面说，不要为了提醒带伞、讲一句当面就能讲的话而预约明天的线上通知。',
        '排程本身不代表见面已经结束；若预约到点后你决定真的发送线上消息，这次线下见面才算结束。到点保留你原本的自主判断，可以选择不发。',
        '排程时，在正常线下回复之外独占一行输出 schedule_active_message({"character_id":"上方对应角色ID","send_at":"YYYY-MM-DDTHH:mm:ss","mode":"auto","prompt_hint":"到时想说什么","expire_policy":"expire"})。',
        '仅允许上方列出的角色使用；多人陪伴必须明确 character_id，不得冒用其他参与者、用户或虚构 NPC。',
        actorInfo,
        'send_at 用对应角色所在时区的墙钟时间，不带时区后缀，必须晚于当前时间至少一分钟。剧情里的虚构日期不能代替现实的发送时间。',
        '遵守用户已有的频率、重复、到点必发权限，不可自行越过。',
        '整轮最多预约两条。没有自然理由就不要预约；工具调用不属于剧情台词、旁白，不写进任何正文或小剧场模块。',
    ].join('\n');
    return context;
}

/** 总是剥离执行语法；只有本轮获准的角色能实际创建，场次结束后的迟到回复不能再排。 */
export async function applyInPersonSchedules(
    raw: string, context: InPersonScheduleContext,
    base: Omit<ToolBase, 'char'>,
    report: (ok: boolean, reason?: string) => void,
): Promise<string> {
    const calls = extractFireScheduleTextCalls(raw);
    let content = raw;
    for (const call of calls) content = content.replace(call.matched, '').trim();
    const sessions = new Map<string, ReturnType<typeof createAmsg2ToolSession>>();
    for (const call of calls.slice(0, 2)) {
        const id = typeof call.args.character_id === 'string' ? call.args.character_id : '';
        const actor = id ? context.actors.find(actor => actor.id === id)
            : !context.requireActorId && context.actors.length === 1 ? context.actors[0] : undefined;
        if (!actor || !base.userProfile) { if (context.actors.length) report(false, '当前角色没有这一轮的预约权限'); continue; }
        const encounter = context.encounters.get(actor.id);
        if (!encounter || getAmsgActiveDateEncounterId(actor.id) !== encounter) { report(false, '见面场次已改变，旧回复不能继续排程'); continue; }
        let session = sessions.get(actor.id);
        if (!session) { session = createAmsg2ToolSession({...base, char: actor}); sessions.set(actor.id, session); }
        // 不接收模型自造的内部参数，也不允许角色在这里建循环任务。
        try {
            const {outcome} = await executeAmsg2ToolWithOutcome('schedule_active_message', {
                send_at: call.args.send_at, mode: call.args.mode, prompt_hint: call.args.prompt_hint,
                expire_policy: call.args.expire_policy, recurrence: 'none', __dateExitEncounterId: encounter,
            }, session);
            if (outcome.status === 'done') report(true);
            else report(false, explainInPersonScheduleFailure(outcome));
        } catch { report(false, '预约执行中断，请检查云端连接'); }
    }
    // 旧版把第 3 条及以后静默抛掉：用户只见到“没预约上”，完全看不到是
    // 单轮最多两次的限制，容易误以为是三次连发限制。仍保留两条安全护栏，明确告知。
    if (calls.length > 2) report(false, '同一轮线下回复最多创建 2 个预约，其余没有执行');
    return content;
}
