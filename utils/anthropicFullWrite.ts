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
 * Called by the browser network transport AFTER native Anthropic conversion.
 * Strip only cache annotations (not roles, blocks, messages or system content);
 * put exactly one ephemeral 5m cache checkpoint at the end of the last message.
 * Never tag signed thinking, redacted_thinking or assistant tool_use blocks.
 */
export function withFullWriteNativeCache(resource: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
    const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
    if (!isAnthropicEndpoint(url) || (init?.method || 'GET').toUpperCase() !== 'POST'
        || typeof init?.body !== 'string') return init;
    try {
        const body = JSON.parse(init.body);
        if (!Array.isArray(body.messages) || body.messages.length === 0) return init;
        const lastContent = body.messages.at(-1)?.content;
        if (!Array.isArray(lastContent)) return init;
        const cacheable = (block: any) => block && ['text', 'image', 'document', 'tool_result'].includes(block.type);
        const checkpoint = [...lastContent].reverse().find(cacheable);
        if (!checkpoint) return init; // no safe final checkpoint; keep the original request
        for (const block of [
            ...(Array.isArray(body.system) ? body.system : []),
            ...(Array.isArray(body.tools) ? body.tools : []),
            ...body.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []),
        ]) {
            if (block && typeof block === 'object') delete block.cache_control;
        }
        checkpoint.cache_control = { type: 'ephemeral' };
        return { ...init, body: JSON.stringify(body) };
    } catch {
        return init;
    }
}
