/** Anthropic-native prompt cache lifetime, shared by dialogue API presets and characters on this device. */
export type AnthropicCacheTtl = '5m' | '1h';
const STORAGE_KEY = 'sully_anthropic_prompt_cache_ttl';

export function getAnthropicCacheTtl(): AnthropicCacheTtl {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === '1h' ? '1h' : '5m';
    } catch {
        return '5m';
    }
}

export function setAnthropicCacheTtl(value: AnthropicCacheTtl): void {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, value);
    } catch {
        // Private browsing/storage denial: keep the safe 5-minute fallback.
    }
}
