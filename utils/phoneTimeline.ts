import type { PhoneTurnTime } from '../types';

export function appendPhoneTurnTimes(
    previous: readonly (PhoneTurnTime | null)[] | undefined,
    previousCount: number,
    times: readonly number[],
    observedAt: number,
): (PhoneTurnTime | null)[] {
    const old = Array.from({ length: previousCount }, (_, i) => previous?.[i] ?? null);
    return [...old, ...times.map(occurredAt => ({
        id: crypto.randomUUID(),
        occurredAt,
        observedAt,
        ...(occurredAt < observedAt ? { backfilled: true as const } : {}),
    }))];
}

/** Relative minutes keep model-selected times independent of the device or character time zone. */
export function resolvePhoneTurnTimes(
    count: number, observedAt: number, earliest: number, minutesAgo: unknown,
): number[] {
    if (minutesAgo == null) return Array<number>(count).fill(observedAt);
    if (!Array.isArray(minutesAgo) || minutesAgo.length !== count) throw new Error('Invalid phone timeline');
    let floor = earliest;
    return minutesAgo.map(minutes => {
        if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error('Invalid phone activity offset');
        const time = observedAt - minutes * 60_000;
        if (time < floor || !Number.isFinite(time)) throw new Error('Phone activity is out of order');
        floor = time;
        return time;
    });
}

export function phoneTimeDivider(current?: PhoneTurnTime | null, previous?: PhoneTurnTime | null): string {
    if (!current || !Number.isFinite(current.occurredAt)) return '';
    const date = new Date(current.occurredAt);
    if (previous && date.toDateString() === new Date(previous.occurredAt).toDateString()
        && current.occurredAt - previous.occurredAt < 5 * 60_000) return '';
    return date.toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
