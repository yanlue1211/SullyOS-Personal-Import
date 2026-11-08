import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';

// `[schedule_message]` 排的是浏览器里的本地定时消息：存 IndexedDB，靠 OSContext 里一个
// 5 秒轮询的 React 定时器派发，App 关着就不存在。主动消息 2.0 到点生成走的是另一条路
// （worker 到点跑），它有自己的排程工具，说明由 worker 追加在 fire_pack 末尾。
//
// 两套一起摆在角色面前，它可能选错：Claude 调用 schedule_active_message,
// Gemini 却输出旧的 [schedule_message]，最后只能存到浏览器本地，关掉 App 就不可靠。
// 2.0 开着时，不论普通聊天还是即时对话，都不教旧本地标签。
// 2.0 关着时才继续教本地标签；fire_pack 一律不教。
// 这是互斥教学，不删除原来的本地定时功能。

const char = { id: 'char-sched', name: '阿一' } as any;
// 开着主动消息 2.0 的角色。判据与 worker 侧 fire_pack 的 selfScheduleEnabled 同源
// （isAmsg2EnabledForChar：activeMsg2Config.enabled === true 才算开）。
const charWithAmsg2 = { id: 'char-sched-amsg2', name: '阿一', activeMsg2Config: { enabled: true } } as any;
const userProfile = { name: '小明' } as any;

const buildStable = async (
    promptOptions?: { forFirePack?: boolean; timelyByWorker?: boolean },
    targetChar: any = char,
) => {
    const parts = await ChatPrompts.buildSystemPromptParts(
        targetChar, userProfile, [], [], [], [],
        undefined, undefined, undefined, undefined, undefined, undefined,
        promptOptions,
    );
    return parts.stable;
};

describe('行为规范 · [schedule_message] 的教学开关', () => {
    it('默认（前台聊天）照常教', async () => {
        const stable = await buildStable();
        expect(stable).toContain('[schedule_message | YYYY-MM-DD HH:MM:SS | fixed | 消息内容]');
        expect(stable).toContain('定时发送消息');
    });

    it('forFirePack（打包主动消息模板）时整条不出现', async () => {
        const stable = await buildStable({ forFirePack: true });
        expect(stable).not.toContain('schedule_message');
        expect(stable).not.toContain('定时发送消息');
        // 只拿掉这一条，同一段里的其他动作说明得留着
        expect(stable).toContain('[[ACTION:POKE]]');
        expect(stable).toContain('[[ACTION:ADD_EVENT');
    });

    it('即时对话（timelyByWorker）且角色开着 2.0 时不教（worker 会注入云端排程工具）', async () => {
        const stable = await buildStable({ timelyByWorker: true }, charWithAmsg2);
        expect(stable).not.toContain('[schedule_message');
        expect(stable).not.toContain('定时发送消息');
        // 只拿掉这一条，同一段里的其他动作说明得留着
        expect(stable).toContain('[[ACTION:POKE]]');
        expect(stable).toContain('[[ACTION:ADD_EVENT');
    });

    it('即时对话但角色 2.0 关着时照教（云端没有排程工具，本地标签是唯一的定时手段）', async () => {
        const stable = await buildStable({ timelyByWorker: true });
        expect(stable).toContain('[schedule_message | YYYY-MM-DD HH:MM:SS | fixed | 消息内容]');
        expect(stable).toContain('定时发送消息');
    });

    it('普通聊天且角色已开启 2.0：不能再教旧本地文本预约格式', async () => {
        const stable = await buildStable(undefined, charWithAmsg2);
        expect(stable).not.toContain('[schedule_message');
        expect(stable).not.toContain('定时发送消息');
        // 原有聊天格式、表情/日历指令等不受影响。
        expect(stable).toContain('[[ACTION:POKE]]');
        expect(stable).toContain('[[ACTION:ADD_EVENT');
    });

    it('普通聊天且角色关闭 2.0：本地定时功能仍可用', async () => {
        const stable = await buildStable(undefined, { ...charWithAmsg2, activeMsg2Config: { enabled: false } });
        expect(stable).toContain('[schedule_message | YYYY-MM-DD HH:MM:SS | fixed | 消息内容]');
    });

    it('角色未配置 2.0：维持旧版本地预约教学', async () => {
        const stable = await buildStable();
        expect(stable).toContain('[schedule_message');
    });
});
