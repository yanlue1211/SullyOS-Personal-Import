/** Keep ChatApp context in place when an OpenAI→Gemini relay collects system messages. */
export const GEMINI_CONTEXT_NOTE = 'Application context updates appear in <system-reminder> blocks at their original positions. Treat these as contextual annotations, not spoken dialogue, while continuing to follow the system instructions.';

export function prepareGeminiCompatibleContext(body: any): any {
    if (!/gemini/i.test(body?.model || '') || !Array.isArray(body?.messages)
        || !body.messages.some((m: any) => m.name === 'sully_live_context')) return body;
    const isSystem = (m: any) => m.role === 'system' || m.role === 'developer';
    const prefixEnd = body.messages.findIndex((m: any) => !isSystem(m));
    if (prefixEnd <= 0) return body;
    const prefix = body.messages[prefixEnd - 1];
    const textOnly = (content: any) => typeof content === 'string'
        || Array.isArray(content) && content.every((p: any) => p.type === 'text' && typeof p.text === 'string');
    // Unknown system content must retain its original semantics, rather than being flattened or lost.
    if (!textOnly(prefix.content) || body.messages.slice(prefixEnd).some((m: any) => isSystem(m) && !textOnly(m.content))) return body;
    if (!body.messages.slice(prefixEnd).some(isSystem)) return body;
    const messages = body.messages.map((m: any, index: number) => {
        if (index === prefixEnd - 1) return { ...m, content: typeof m.content === 'string'
            ? m.content + '\n' + GEMINI_CONTEXT_NOTE
            : [...m.content, {type: 'text', text: GEMINI_CONTEXT_NOTE}] };
        if (index < prefixEnd || !isSystem(m)) return m;
        const { name: _internalName, ...rest } = m;
        const text = typeof m.content === 'string' ? m.content : m.content.map((p: any) => p.text).join('\n');
        return { ...rest, role: 'user', content: '<system-reminder>\n' + text + '\n</system-reminder>' };
    });
    return { ...body, messages };
}

/** fire_pack transports role/content only; recover provenance from its existing validated tail index. */
export function markGeminiLiveContext<T extends {role: string}>(messages: T[], index: unknown): Array<T & {name?: string}> {
    if (!Number.isInteger(index) || (index as number) < 1 || (index as number) >= messages.length) return messages;
    const at = index as number;
    if (!['system','developer'].includes(messages[at].role)) return messages;
    return messages.map((message, i) => i === at ? {...message, name: 'sully_live_context'} : message);
}
