import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';

// 旧版 [schedule_message] 只在浏览器里存定时消息，杀后台不可靠；
// 用户已明确退役此功能，不能继续教任何模型使用。
// 云端 2.0 的 schedule_active_message 由前台工具注入（与此提示词无关）。
const char = { id: 'char-sched', name: '阿一' } as any;
const charWithAmsg2 = { ...char, activeMsg2Config: { enabled: true } };
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

describe('旧本地预约教学退役', () => {
    const cases = [
        ['普通聊天·2.0 未配置', undefined, char],
        ['普通聊天·2.0 关闭', undefined, { ...char, activeMsg2Config: { enabled: false } }],
        ['普通聊天·2.0 开启', undefined, charWithAmsg2],
        ['即时对话·2.0 关闭', { timelyByWorker: true }, char],
        ['即时对话·2.0 开启', { timelyByWorker: true }, charWithAmsg2],
        ['云端打包', { forFirePack: true }, charWithAmsg2],
    ] as const;

    for (const [label, opts, targetChar] of cases) {
        it(`${label} 不再提供本地预约标签，但保留其他聊天指令`, async () => {
            const stable = await buildStable(opts, targetChar);
            expect(stable).not.toContain('[schedule_message');
            expect(stable).not.toContain('定时发送消息');
            expect(stable).toContain('[[ACTION:POKE]]');
            expect(stable).toContain('[[ACTION:ADD_EVENT');
        });
    }
});
