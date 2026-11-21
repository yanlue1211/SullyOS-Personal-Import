import { describe, expect, it } from 'vitest';
import { appendPhoneTurnTimes, phoneTimeDivider, resolvePhoneTurnTimes } from './phoneTimeline';

describe('phone conversation event times', () => {
    const observedAt = new Date(2026, 10, 13, 15, 40).getTime();
    const earliest = new Date(2026, 10, 10, 20, 35).getTime();

    it('separates observation from inferred activity and leaves old times unknown', () => {
        const events = resolvePhoneTurnTimes(2, observedAt, earliest, [2880, 0]);
        const saved = appendPhoneTurnTimes(undefined, 2, events, observedAt);
        expect(saved.slice(0, 2)).toEqual([null, null]);
        expect(saved[2]).toMatchObject({ occurredAt: observedAt - 2 * 86_400_000, observedAt, backfilled: true });
        expect(saved[3]).toMatchObject({ occurredAt: observedAt, observedAt });
        expect(saved[3]).not.toHaveProperty('backfilled');
        expect(saved[2]?.id).not.toBe(saved[3]?.id);
        expect(phoneTimeDivider(saved[3], saved[2])).toContain('13日');
        expect(phoneTimeDivider(saved[3], saved[3])).toBe('');
    });

    it('rejects reversed, future, overly early and mismatched model timestamps', () => {
        for (const offsets of [[0, 1], [0, -1], [100000, 0], [0]]) {
            expect(() => resolvePhoneTurnTimes(2, observedAt, earliest, offsets)).toThrow();
        }
    });
});
