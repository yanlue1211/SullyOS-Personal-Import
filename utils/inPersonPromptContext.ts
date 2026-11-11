/** Insert per-turn scheduling after history and before the existing final response principles. */
export function insertInPersonScheduleContext(messages: Array<{role: string; content: any}>, prompt: string): void {
    if (!prompt.trim()) return;
    messages.splice(Math.max(0, messages.length - 1), 0, {role: 'system', content: prompt});
}
