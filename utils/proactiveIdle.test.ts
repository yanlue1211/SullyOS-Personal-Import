// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProactiveChat } from './proactiveChat';
import { DB } from './db';
import { getProactiveUserActivity, recordProactiveUserActivity } from './proactiveActivity';
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T00:00:00Z')); });
afterEach(() => { ProactiveChat.reconcile([]); vi.useRealTimers(); });
describe('proactive 1.0 inactivity', () => {
    it('user replies restart only that character’s inactivity interval', async () => {
        const fired: string[] = [];
        ProactiveChat.start('idle-a', 60); ProactiveChat.start('idle-b', 60);
        ProactiveChat.onTrigger(id => { fired.push(id); });
        await vi.advanceTimersByTimeAsync(50 * 60_000);
        recordProactiveUserActivity({ charId: 'idle-a', role: 'user' }, Date.now());
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(fired).toEqual(['idle-b']);
        await vi.advanceTimersByTimeAsync(49 * 60_000);
        expect(fired).toEqual(['idle-b']);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fired).toEqual(['idle-b', 'idle-a']);
    });
    it('date/call/real companionship replies count; hidden hints, other roles and group chat do not', async () => {
        vi.useRealTimers();
        const now = Date.now();
        for (const source of ['date', 'call', 'story_theater_memory']) {
            const charId = `idle-${source}`;
            await DB.saveMessage({ charId, role: 'user', type: 'text', content: '回应', timestamp: now, metadata: { source } });
            expect(getProactiveUserActivity(charId)).toBe(now);
        }
        for (const patch of [{ metadata: { proactiveHint: true } }, { metadata: { hidden: true } }, { role: 'assistant' }, { groupId: 'group' }]) {
            await DB.saveMessage({ charId: 'idle-excluded', role: 'user', type: 'text', content: '提示', ...patch } as any);
            expect(getProactiveUserActivity('idle-excluded')).toBe(0);
        }
    });
});
