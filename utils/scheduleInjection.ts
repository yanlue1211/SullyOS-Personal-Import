/**
 * 日程 → prompt 文本的纯渲染层。
 *
 * 零运行时依赖（只 import type），浏览器与 Cloudflare Worker 共用同一份：
 *  - 前台聊天走 ContextBuilder.buildScheduleInjection（转发到这里）；
 *  - 主动消息到点生成走 utils/amsgFireScene.ts，由 worker 在 fire 时刻按角色时区调用。
 *
 * 放在这里而不是 utils/context.ts：那个模块拖着 DB / 记忆宫殿等一堆浏览器依赖，
 * worker 引不动。两边各写一份的话，角色在聊天里和到点生成时会说出不一样的作息。
 */

import type { DailySchedule, ScheduleSlot } from '../types';

/**
 * 渲染真正会读到的那部分日程。
 *
 * 单独立一个类型是给主动消息用的：fire_pack 只带这些字段上云。整份 DailySchedule 里
 * 还挂着每个时段缓存的小剧场（整段演出台词）和 coverImage（可能是 base64 看板图），
 * 那些渲染一个字都用不到，带上去就是白占几十上百 KB 的云端状态。
 */
export type RenderableSchedule = Pick<DailySchedule, 'slots' | 'flowNarrative'>;

export interface ScheduleInjectionOptions {
    /** ChatApp 主请求需要让角色看到今天的整张表；主动消息到点场景仍只看当前与下一条。 */
    includeFullDay?: boolean;
    /**
     * 教不教角色改自己的日程。前台聊天和主动消息到点生成都能落地——后者的标签由
     * worker classifier 摘成 change_schedule directive 随 push 回来，客户端落库
     * （不摘的话会被 sanitize 连 raw 一起剥掉，见 utils/scheduleChangeParse.ts）。
     * 措辞对两边都成立：主动消息里没有「完整日程表」可指，所以只让它抄上面出现过的时段。
     */
    includeChangeInstruction?: boolean;
    /**
     * 能不能报钟点（默认能）。角色关掉「时间感知」时传 false：日程照给——那是这个
     * 功能自己的开关——但 `07:00` 这种精确钟点属于时间感知的范畴，不该从日程块漏出去。
     * 跟天气块的处理对齐（那边天气照给、只抽掉 timeLine）。
     * 关掉钟点时也不教改日程：那条指令拿时段当定位符，角色看不到时刻就写不出来。
     */
    includeClock?: boolean;
}

/** 意识流独白按一天三档取：早 / 午 / 晚。 */
export function getFlowNarrativeKey(hour: number): 'morning' | 'afternoon' | 'evening' {
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
}

/** 几点之前算「还在前一夜里」。凌晨 0-5 点属于昨晚的尾巴，不是今天的早晨。 */
const PRE_DAWN_END_HOUR = 5;

/** 当前时刻落在哪一条日程上，以及紧接着的下一条。都可能为 null（表还没开始 / 表是空的）。 */
export const resolveScheduleSlots = (
    schedule: RenderableSchedule | null,
    now: Date,
): { current: ScheduleSlot | null; next: ScheduleSlot | null } => {
    if (!schedule?.slots?.length) return { current: null, next: null };
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (let i = schedule.slots.length - 1; i >= 0; i--) {
        const [h, m] = schedule.slots[i].startTime.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        if (currentMinutes >= h * 60 + m) {
            return {
                current: schedule.slots[i],
                next: i < schedule.slots.length - 1 ? schedule.slots[i + 1] : null,
            };
        }
    }
    // 今天第一条还没到点：没有「当前」，只有「稍后先做什么」。
    return { current: null, next: schedule.slots[0] };
};

/**
 * 构建日程注入文本
 *
 * 两段式，独立叠加：
 * 1) 当前时段硬事实——每轮都注入，不受 evolvedNarrative 影响
 * 2) 意识流独白——evolvedNarrative > flowNarrative > 当前 slot innerThought
 */
export const buildScheduleInjection = (
    schedule: RenderableSchedule | null,
    evolvedNarrative?: string,
    now: Date = new Date(),
    options: ScheduleInjectionOptions = {},
): string => {
    if (!schedule || !schedule.slots || schedule.slots.length === 0) return '';
    return '[今日日程 · 初步安排]\n' + schedule.slots.map(slot => `${options.includeClock === false ? '' : slot.startTime + ' '}${slot.activity}${slot.description ? '：' + slot.description : ''}`).join('\n')
        + '\n这是今天最初的大致安排，不是已发生事实或必须照表执行的指令。根据实际对话、临时事件和角色意愿灵活调整；不要为了符合日程打断话题或反复催促用户。这是你自己的生活安排，不是给对方列的待办；涉及对方的事顺口带过即可，不用追着问进展。';
};
