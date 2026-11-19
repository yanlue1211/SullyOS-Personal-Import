import { describe, expect, it } from 'vitest';
import { toAnthropicRequest } from './anthropicApi';
import { shouldUseAnthropicFullWrite, withFullWriteNativeCache } from './anthropicFullWrite';

const url = 'https://relay.test/v1/messages/chat/completions';
const full = { baseUrl: 'https://relay.test/v1/messages', apiType: 'anthropic' as const,
    apiKey: 'secret', model: 'claude-4', anthropicCacheMode: 'full-write' as const };
const body = (last = '最新用户消息') => ({
    model: 'claude-4',
    messages: [
        { role: 'system', content: '角色、世界书、记忆' },
        ...Array.from({length: 24}, (_, i) => ({role: i % 2 ? 'assistant' : 'user', content: 'history ' + i})),
        {role: 'system', content: '本轮动态召回和歌曲'},
        {role: 'user', content: last},
    ],
    tools: [{type: 'function', function: {name: 'lookup'}}],
});
const init = (b: any = body()) => ({method: 'POST', headers: {Authorization: 'Bearer secret'}, body: JSON.stringify(b)});
const stripCache = (value: any): any => Array.isArray(value) ? value.map(stripCache)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
        .filter(([k]) => k !== 'cache_control').map(([k, v]) => [k, stripCache(v)])) : value;

describe('Anthropic full-write mode', () => {
    it('matches exactly one channel, and an active normal config wins over a saved experimental preset', () => {
        expect(shouldUseAnthropicFullWrite({url, init: init(), candidates: [full]})).toBe(true);
        expect(shouldUseAnthropicFullWrite({url, init: init(), candidates: [{...full, anthropicCacheMode: 'optimized'}, full]})).toBe(false);
        expect(shouldUseAnthropicFullWrite({url, init: init(), candidates: [{...full, apiKey: 'not-secret'}]})).toBe(false);
        expect(shouldUseAnthropicFullWrite({url, init: init({...body(), model: 'other'}), candidates: [full]})).toBe(false);
        expect(shouldUseAnthropicFullWrite({url: 'https://open.test/v1/chat/completions', init: init(), candidates: [full]})).toBe(false);
    });

    it('moves ALL native checkpoints to the final message with no content change', () => {
        const normal = toAnthropicRequest(body());
        const normalBlocks = [...(normal.system || []), ...(normal.tools || []),
            ...normal.messages.flatMap((m: any) => m.content)];
        expect(normalBlocks.filter((b: any) => b.cache_control).length).toBeGreaterThan(1);
        const originalInit = {method: 'POST', body: JSON.stringify(normal)};
        const updated = withFullWriteNativeCache('https://relay.test/v1/messages', originalInit);
        const result = JSON.parse(String(updated?.body));
        const allBlocks = [...(result.system || []), ...(result.tools || []),
            ...result.messages.flatMap((m: any) => m.content)];
        const tagged = allBlocks.filter((b: any) => b.cache_control);
        expect(tagged).toHaveLength(1);
        expect(tagged[0]).toBe(result.messages.at(-1).content.at(-1));
        expect(tagged[0].text).toBe('最新用户消息');
        expect(tagged[0].cache_control).toEqual({type: 'ephemeral'});
        expect(stripCache(result)).toEqual(stripCache(normal));
        expect(JSON.parse(String(originalInit.body))).toEqual(normal);
    });

    it('includes tool results but does not tamper with signed assistant thinking', () => {
        const native = {messages: [
            {role: 'assistant', content: [
                {type: 'thinking', thinking: 'private', signature: 'signed'},
                {type: 'tool_use', id: 't', name: 'lookup', input: {}}]},
            {role: 'user', content: [{type: 'tool_result', tool_use_id: 't', content: [{type: 'text', text: 'returned'}]}]},
        ]};
        const out = JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages',
            {method: 'POST', body: JSON.stringify(native)})?.body));
        expect(out.messages[0].content[0]).not.toHaveProperty('cache_control');
        expect(out.messages.at(-1).content[0].cache_control).toEqual({type: 'ephemeral'});
        expect(stripCache(out)).toEqual(native);
    });
});
