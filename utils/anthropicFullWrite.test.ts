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
        // The active character policy is supplied first when a request has a charId.
        expect(shouldUseAnthropicFullWrite({url, init: init(), candidates: [full, {...full, anthropicCacheMode: 'optimized'}]})).toBe(true);
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
        // Only request-local technical marker plus cache tags may differ.
        const withoutMarker = structuredClone(result);
        withoutMarker.tools[0].description = withoutMarker.tools[0].description.replace(/\n\[request-cache-write-scope:[^\]]+\]$/, '');
        expect(stripCache(withoutMarker)).toEqual(stripCache(normal));
        expect(result.tools[0].description).toMatch(/request-cache-write-scope/);
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
        const withoutMarker = structuredClone(out);
        withoutMarker.system = undefined;
        expect(stripCache({...withoutMarker, system: undefined})).toEqual({...native, system: undefined});
        // With no genuine user turn before the signed tool result, changing
        // the system would invalidate a signature; the helper safely skips it.
        expect(out).not.toHaveProperty('system');
    });
});

describe('no-read preference: turn-scoped prefix cache busting', () => {
    const latestMessage = (text: string) => ({role: 'user', content: [{type: 'text', text}]});
    const signed = {type: 'thinking', thinking: 'internal', signature: 'signed-by-upstream'};

    it('changes the earliest tool prefix on each NEW human turn but not the tool schema or names', () => {
        const history = {
            system: [{type: 'text', text: '固定人设与世界书'}],
            tools: [{name: 'schedule_active_message', description: '原始排程工具', input_schema: {type: 'object', properties: {time: {type: 'string'}}}}],
            messages: [latestMessage('第一次发言')],
        };
        const a = JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages', {method: 'POST', body: JSON.stringify(history)})?.body));
        const b = JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages', {method: 'POST',
            body: JSON.stringify({...history, messages: [...history.messages, {role: 'assistant', content: [{type: 'text', text: '回应'}]}, latestMessage('第二次发言')]})})?.body));
        expect(a.tools[0].description).not.toEqual(b.tools[0].description);
        expect(a.tools[0].name).toBe('schedule_active_message');
        expect(a.tools[0].input_schema).toEqual(history.tools[0].input_schema);
        expect(a.system).toEqual(history.system);
        expect(a.messages[0].content[0].text).toBe('第一次发言');
        expect(a.messages[0].content[0].cache_control).toEqual({type: 'ephemeral'});
        expect(b.messages.at(-1).content[0].cache_control).toEqual({type: 'ephemeral'});
    });

    it('keeps the SAME cache salt throughout a signed-thinking tool continuation', () => {
        const original = {
            system: [{type: 'text', text: '角色说明'}],
            tools: [{name: 'lookup', description: '查询', input_schema: {type: 'object', properties: {}}}],
            messages: [latestMessage('帮我查一下')],
        };
        const first = JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages',
            {method: 'POST', body: JSON.stringify(original)})?.body));
        const next = JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages', {method: 'POST',
            body: JSON.stringify({...original, messages: [
                ...original.messages,
                {role: 'assistant', content: [signed, {type: 'tool_use', id: 'tool-1', name: 'lookup', input: {}}]},
                {role: 'user', content: [{type: 'tool_result', tool_use_id: 'tool-1', content: [{type: 'text', text: '结果'}]}]},
            ]})})?.body));
        expect(first.tools[0].description).toBe(next.tools[0].description);
        expect(next.messages[1].content[0]).toEqual(signed);
        expect(next.messages[2].content[0].cache_control).toEqual({type: 'ephemeral'});
    });

    it('ignores late system reminders when carrying a signed tool response forward', () => {
        const first = {
            tools: [{name: 'schedule_active_message', description: '排程', input_schema: {type: 'object', properties: {}}}],
            system: [{type: 'text', text: '人设'}],
            messages: [{role: 'user', content: [
                {type: 'text', text: '记得提醒我'},
                {type: 'text', text: '<system-reminder>上轮动态时间</system-reminder>'},
            ]}],
        };
        const following = {...first, messages: [
            {role: 'user', content: [{type: 'text', text: '记得提醒我'}]},
            {role: 'assistant', content: [signed, {type: 'tool_use', id: 't', name: 'schedule_active_message', input: {}}]},
            {role: 'user', content: [{type: 'tool_result', tool_use_id: 't', content: [{type: 'text', text: 'success'}]}]},
        ]};
        const native = (b: any) => JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages',
            {method: 'POST', body: JSON.stringify(b)})?.body));
        const a = native(first), b = native(following);
        expect(a.tools[0].description).toBe(b.tools[0].description);
        expect(a.messages[0].content[0].text).toBe('记得提醒我');
        expect(b.messages[1].content[0]).toEqual(signed);
    });

    it('does not modify the signed prefix of an older thinking block from before a new user turn', () => {
        const original = {
            system: [{type: 'text', text: '原有系统'}],
            tools: [{name: 'lookup', description: '原有工具', input_schema: {type: 'object', properties: {}}}],
            messages: [
                latestMessage('旧消息'), {role: 'assistant', content: [signed, {type: 'text', text: '旧回复'}]},
                latestMessage('新消息'),
            ],
        };
        const out = JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages',
            {method: 'POST', body: JSON.stringify(original)})?.body));
        expect(out.system).toEqual(original.system);
        expect(out.tools).toEqual(original.tools);
        expect(out.messages[1].content[0]).toEqual(signed);
        expect(out.messages[2].content[0].cache_control).toEqual({type: 'ephemeral'});
    });

    it('puts the per-turn marker before system when there are no tools and strips earlier checkpoints', () => {
        const base = {
            system: [{type: 'text', text: '人设', cache_control: {type: 'ephemeral', ttl: '1h'}}],
            messages: [latestMessage('第一轮')],
            cache_control: {type: 'ephemeral'},
        };
        const a = JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages',
            {method: 'POST', body: JSON.stringify(base)})?.body));
        const b = JSON.parse(String(withFullWriteNativeCache('https://relay.test/v1/messages',
            {method: 'POST', body: JSON.stringify({...base, messages: [latestMessage('第二轮')]})})?.body));
        expect(a.system[0].text).not.toEqual(b.system[0].text);
        expect(a.system[0].text).toContain('人设');
        expect(a.system[0]).not.toHaveProperty('cache_control');
        expect(a).not.toHaveProperty('cache_control');
        expect(a.messages[0].content[0].cache_control).toEqual({type: 'ephemeral'});
    });
});
