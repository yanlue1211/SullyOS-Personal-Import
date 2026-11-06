import type { Message } from '../types';
export const PROACTIVE_ACTIVITY_EVENT = 'proactive-user-activity';
const KEY = 'proactive_user_activity_v1';
const memory: Record<string, number> = {};
export function getProactiveUserActivity(charId: string): number {
    try { return Math.max(memory[charId] || 0, Number(JSON.parse(localStorage.getItem(KEY) || '{}')[charId]) || 0); }
    catch { return memory[charId] || 0; }
}
export function isProactiveUserReply(message: Pick<Message, 'role' | 'groupId' | 'metadata'>): boolean {
    return message.role === 'user' && !message.groupId && !message.metadata?.proactiveHint && !message.metadata?.hidden;
}
/** Called after commit only; includes online, date, call and real-companionship mirrors. */
export function recordProactiveUserActivity(message: Pick<Message, 'charId' | 'role' | 'groupId' | 'metadata'>, timestamp: number) {
    if (!isProactiveUserReply(message) || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now()) return;
    memory[message.charId] = Math.max(getProactiveUserActivity(message.charId), timestamp);
    try {
        const map = JSON.parse(localStorage.getItem(KEY) || '{}');
        map[message.charId] = memory[message.charId];
        localStorage.setItem(KEY, JSON.stringify(map));
    } catch { /* current-session fallback */ }
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent?.(new CustomEvent(PROACTIVE_ACTIVITY_EVENT, { detail: { charId: message.charId } }));
    }
}
