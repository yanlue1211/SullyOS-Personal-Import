import { getAmsgActiveDateEncounterId, setAmsgActiveDate } from './amsgInteractionGuard';

/** 真实时间陪伴复用见面锁；虚构剧场不调用。暂离不释放。 */
export function beginStoryMeeting(charId: string, entryId: string): string {
    const prefix = `story:${entryId}:`;
    const existing = getAmsgActiveDateEncounterId(charId);
    const encounter = existing?.startsWith(prefix) ? existing : `${prefix}${crypto.randomUUID()}`;
    setAmsgActiveDate(charId, true, encounter);
    return encounter;
}

/** 只能结束本场，不能清掉后来开始的另一场普通见面或陪伴。 */
export function endStoryMeeting(charId: string, encounter: string): boolean {
    if (getAmsgActiveDateEncounterId(charId) !== encounter) return false;
    setAmsgActiveDate(charId, false);
    return true;
}
