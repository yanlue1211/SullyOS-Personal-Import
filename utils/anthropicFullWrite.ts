import type { APIConfig } from '../types';
import { isAnthropicEndpoint, llmApiType, normalizeLlmBaseUrl } from './llmEndpoint';

type CacheEndpoint = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model' | 'apiType' | 'anthropicCacheMode'>;

/** Select the first matching configured channel. Credentials never enter logs or URLs. */
export function shouldUseAnthropicFullWrite(input: {
    url: string;
    init?: RequestInit;
    candidates: Array<CacheEndpoint | null | undefined>;
}): boolean {
    if (!isAnthropicEndpoint(input.url) || !input.init || typeof input.init.body !== 'string') return false;
    try {
        const body = JSON.parse(input.init.body);
        if (typeof body.model !== 'string' || !Array.isArray(body.messages)) return false;
        const headers = new Headers(input.init.headers);
        const key = headers.get('x-api-key') || headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
        if (!key) return false;
        const url = new URL(input.url);
        url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '');
        const endpoint = normalizeLlmBaseUrl(url.href, 'anthropic');
        const matched = input.candidates.find(config => config
            && llmApiType(config) === 'anthropic'
            && normalizeLlmBaseUrl(config.baseUrl, 'anthropic') === endpoint
            && config.apiKey === key && config.model === body.model);
        return matched?.anthropicCacheMode === 'full-write';
    } catch {
        return false;
    }
}

/**
 * A cache write at the last message can still READ a previous write: Claude
 * checks earlier breakpoints inside a 20-block lookback window. A per-turn
 * marker at the FIRST cacheable prefix makes each NEW user turn distinct while
 * keeping tool continuations on that same turn's marker.
 *
 * Derive the marker from model-visible context THROUGH the last genuine user
 * turn, not the current tool reply, dynamic system reminder or wall clock:
 * - every new human turn changes the prefix;
 * - follow-up tool requests from that turn keep the prefix required by signed
 * thinking blocks;
 * - nothing is persisted into stored dialogue, memory or user settings.
 *
 * Old signed thinking already preceding the newest genuine user turn has no
 * matching marker: do not alter its signed prefix or risk a Claude 400.
 */
function lastHumanUserIndex(messages: any[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
        if (message.content.some((block: any) => {
            if (block?.type === 'image' || block?.type === 'document') return true;
            return block?.type === 'text'
                && typeof block.text === 'string'
                && block.text.trim() !== ''
                && !block.text.startsWith('<system-reminder>');
        })) return i;
    }
    return -1;
}

function hasEarlierSignedThinking(messages: any[], lastUser: number): boolean {
    return messages.slice(0, lastUser).some(message =>
        Array.isArray(message.content) && message.content.some((block: any) =>
            (block?.type === 'thinking' && typeof block.signature === 'string' && !!block.signature)
                || block?.type === 'redacted_thinking'));
}

function cacheTurnMarker(messages: any[], lastUser: number): string {
    const prefix = JSON.stringify(messages.slice(0, lastUser + 1), (key, value) =>
        key === 'cache_control' ? undefined : value);
    // Two 32-bit folds make accidental collisions over long conversations unlikely.
    // This is a cache discriminator, NOT a credential, hash of a user identity or
    // security token. Never log or store the input.
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < prefix.length; i++) {
        const code = prefix.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193) >>> 0;
        b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
    }
    return `${a.toString(36)}-${b.toString(36)}-${prefix.length.toString(36)}`;
}

function breakEarlierCachePrefix(body: any): void {
    const userIndex = lastHumanUserIndex(body.messages);
    if (userIndex < 0 || hasEarlierSignedThinking(body.messages, userIndex)) return;

    const marker = `[request-cache-write-scope:${cacheTurnMarker(body.messages, userIndex)}]`;
    // Anthropic cache order is tools → system → messages. A system-only marker
    // would still allow earlier tools to be read if tools are present.
    if (Array.isArray(body.tools) && body.tools.length > 0) {
        const firstTool = body.tools[0];
        if (firstTool && typeof firstTool === 'object') {
            firstTool.description = `${firstTool.description || ''}\n${marker}`;
            return;
        }
    }
    if (Array.isArray(body.system) && body.system.length > 0) {
        const firstText = body.system.find((part: any) => part?.type === 'text' && typeof part.text === 'string');
        if (firstText) {
            firstText.text = `${marker}\n${firstText.text}`;
            return;
        }
        body.system.unshift({ type: 'text', text: marker });
    } else if (typeof body.system === 'string') {
        body.system = [{ type: 'text', text: `${marker}\n${body.system}` }];
    } else {
        body.system = [{ type: 'text', text: marker }];
    }
}

/**
 * Called by the browser network transport AFTER native Anthropic conversion.
 * Remove old cache tags and insert a changing technical prefix marker (on the
 * first tool definition, otherwise the first system block), only when that
 * cannot invalidate previous signed-thinking blocks.
 * Then put exactly one ephemeral 5m checkpoint as late as safely possible.
 * Tools and context are otherwise preserved; the marker is request-local.
 * If a preserved-thinking signature would become invalid, skip the marker.
 * No official API flag can guarantee that a third-party relay won't read.
 */
export function withFullWriteNativeCache(resource: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
    const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
    if (!isAnthropicEndpoint(url) || (init?.method || 'GET').toUpperCase() !== 'POST'
        || typeof init?.body !== 'string') return init;
    try {
        const body = JSON.parse(init.body);
        if (!Array.isArray(body.messages) || body.messages.length === 0) return init;
        const cacheable = (block: any) => block && ['text', 'image', 'document', 'tool_result'].includes(block.type);
        // Prefer the last cacheable block in the final message. If the final
        // message has only a signed tool_use/thinking block, write at the latest
        // earlier eligible message instead of restoring old stable checkpoints.
        const checkpoint = [...body.messages].reverse().flatMap((message: any) =>
            Array.isArray(message.content) ? [...message.content].reverse() : []).find(cacheable);
        for (const block of [
            ...(Array.isArray(body.system) ? body.system : []),
            ...(Array.isArray(body.tools) ? body.tools : []),
            ...body.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []),
        ]) {
            if (block && typeof block === 'object') delete block.cache_control;
        }
        delete body.cache_control; // Never combine with top-level automatic caching.
        breakEarlierCachePrefix(body);
        if (checkpoint) checkpoint.cache_control = { type: 'ephemeral' };
        return { ...init, body: JSON.stringify(body) };
    } catch {
        return init;
    }
}
