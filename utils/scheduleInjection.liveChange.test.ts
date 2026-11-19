import { describe, expect, it } from 'vitest';
import { buildScheduleInjection } from './scheduleInjection';
import { extractScheduleChangeDirectives } from './scheduleChangeParse';

const schedule = {
    slots: [
        { startTime: '09:00', activity: '录歌', description: '录音棚试唱' },
        { startTime: '14:00', activity: '健身', description: '下午去健身房' },
        { startTime: '20:00', activity: '玩游戏' },
    ],
};

describe('schedule injection / same-turn modification', () => {
    it('gives the complete daily agenda and a real action tag in live chat', () => {
        const prompt = buildScheduleInjection(schedule, undefined, new Date(2026, 10, 19, 12), {
            includeFullDay: true, includeClock: true, includeChangeInstruction: true,
        });
        expect(prompt).toContain('09:00 录歌');
        expect(prompt).toContain('14:00 健身');
        expect(prompt).toContain('20:00 玩游戏');
        expect(prompt).toContain('ACTION:CHANGE_SCHEDULE');
        expect(prompt).toContain('没有变化就不要写标签');
        const result = extractScheduleChangeDirectives('那我们下午逛街去！\n[[ACTION:CHANGE_SCHEDULE | 14:00 | 和对方逛街]]');
        expect(result.cleanedText).toBe('那我们下午逛街去！');
        expect(result.directives).toEqual([{ startTime: '14:00', activity: '和对方逛街' }]);
    });
    it('does not teach edits when not requested or when exact clock is off', () => {
        expect(buildScheduleInjection(schedule, undefined, undefined, { includeChangeInstruction: false }))
            .not.toContain('ACTION:CHANGE_SCHEDULE');
        const noClock = buildScheduleInjection(schedule, undefined, undefined, {
            includeClock: false, includeChangeInstruction: true,
        });
        expect(noClock).toContain('健身');
        expect(noClock).not.toContain('14:00');
        expect(noClock).not.toContain('ACTION:CHANGE_SCHEDULE');
    });
    it('does not offer editing without an existing schedule', () => {
        expect(buildScheduleInjection(null, undefined, undefined, { includeChangeInstruction: true })).toBe('');
    });
});
