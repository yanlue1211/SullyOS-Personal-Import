import { describe, expect, it } from 'vitest';
import { buildIdolScheduleVariationPrompt } from './scheduleIdolPrompt';

describe('idol daily schedule prompt', () => {
    it('selects idol cards and keeps all four natural variation causes', () => {
        const text = buildIdolScheduleVariationPrompt({ systemPrompt: '张真源，时代少年团成员，喜欢音乐剧与运动。' } as any);
        expect(text).toContain('工作/主任务');
        expect(text).toContain('被动小扰动');
        expect(text).toContain('自己临时改变主意');
        expect(text).toContain('天气场地');
        expect(text).toContain('临时邀约');
        expect(text).toContain('1—2个时段');
        expect(text).toContain('下午逛街');
        expect(text).toContain('音乐剧演员');
        expect(text).toContain('播音主持');
    });
    it('does not inject idol duties into an unrelated card', () => {
        expect(buildIdolScheduleVariationPrompt({ systemPrompt: '一个异世界炼金术师' } as any)).toBe('');
        expect(buildIdolScheduleVariationPrompt({ systemPrompt: '' } as any)).toBe('');
    });
});
