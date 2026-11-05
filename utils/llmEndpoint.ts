export type LlmApiType = 'openai' | 'anthropic' | 'gemini';

export function isGeminiEndpoint(value: string): boolean {
    try { return /\/v1(?:beta|alpha)\/models(?:\/(?:chat\/completions|models))?\/?$/.test(new URL(value).pathname); }
    catch { return false; }
}

/** Native endpoints are self-describing, including in the legacy three-field amsg credential. */
export function isAnthropicEndpoint(value: string): boolean {
    try { return /\/messages(?:\/(?:chat\/completions|models))?\/?$/.test(new URL(value).pathname); }
    catch { return false; }
}

export function normalizeLlmBaseUrl(value: string, type?: LlmApiType): string {
    const base = value.trim().replace(/\/+$/, '');
    if (!base) return base;
    if (!type) return base;
    try {
        const url = new URL(base);
        if (type === 'gemini') {
            url.pathname = url.pathname.replace(/\/(?:messages(?:\/chat\/completions)?|chat\/completions)\/?$/, '').replace(/\/+$/, '');
            url.pathname = url.pathname.replace(/\/v1(?:beta|alpha)?(?:\/models(?:\/models)?)?$/, '');
            url.pathname = url.pathname.replace(/\/+$/, '') + '/v1beta/models';
        } else if (type === 'anthropic') {
            url.pathname = url.pathname.replace(/\/v1(?:beta|alpha)\/models(?:\/(?:chat\/completions|models))?\/?$/, '/v1');
            url.pathname = url.pathname.replace(/\/(?:messages(?:\/chat\/completions)?|chat\/completions|models)\/?$/, '').replace(/\/+$/, '');
            if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
            url.pathname += '/messages';
        } else {
            url.pathname = url.pathname.replace(/\/v1(?:beta|alpha)\/models(?:\/(?:chat\/completions|models))?\/?$/, '/v1');
            url.pathname = url.pathname.replace(/\/messages(?:\/chat\/completions)?\/?$/, '');
        }
        return url.href.replace(/\/$/, '');
    } catch { return base; }
}

export function nativeRequestUrl(value: string): string {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/messages\/chat\/completions\/?$/, '/messages').replace(/\/messages\/models\/?$/, '/models');
    return url.href;
}

export const llmApiType = (api: {apiType?: LlmApiType; baseUrl: string}): LlmApiType =>
    api.apiType ?? (isAnthropicEndpoint(api.baseUrl) ? 'anthropic' : isGeminiEndpoint(api.baseUrl) ? 'gemini' : 'openai');
