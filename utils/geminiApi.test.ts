import { describe, expect, it, vi } from 'vitest';
import { fetchLlm, anthropicContinuation, installAnthropicFetch } from './anthropicApi';
import { convertGeminiStream, fromGeminiMessage, geminiUsage, toGeminiRequest } from './geminiApi';
import { isGeminiEndpoint, llmApiType, normalizeLlmBaseUrl } from './llmEndpoint';
import { resolveDialogueApi, pickDialogueApi } from './characterApi';
import { configFromPreset } from './apiPresetSwitch';
import { toCredentialValue } from './amsgLlmCredentials';
import { safeResponseJson } from './safeApi';
import { callLlm as sdkCallLlm, extractAssistantMessage } from '@rei-standard/amsg-shared';

const native = 'https://relay.test/v1beta/models';
const reply = (parts: any[] = [{ text: '你好呀' }], usageMetadata: any = { promptTokenCount: 100, candidatesTokenCount: 5, totalTokenCount: 105 }) => ({
    responseId: 'r1', modelVersion: 'gemini-test', candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata,
});
function sse(events: any[], width = 1) {
    const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
    let i = 0;
    return new Response(new ReadableStream({ pull(c) { if (i >= bytes.length) c.close(); else { c.enqueue(bytes.slice(i, i + width)); i += width; } } }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('Gemini native transport', () => {
    it('keeps endpoint, preset, character and cloud credentials atomic and switches back cleanly', () => {
        for (const value of ['https://relay.test', 'https://relay.test/v1', 'https://relay.test/v1beta', native, 'https://relay.test/v1/chat/completions', 'https://relay.test/v1/messages']) {
            expect(normalizeLlmBaseUrl(value, 'gemini')).toBe(native);
        }
        expect(normalizeLlmBaseUrl(native, 'openai')).toBe('https://relay.test/v1');
        expect(normalizeLlmBaseUrl(native, 'anthropic')).toBe('https://relay.test/v1/messages');
        expect(normalizeLlmBaseUrl('https://relay.test/proxy/v1', 'gemini')).toBe('https://relay.test/proxy/v1beta/models');
        expect(isGeminiEndpoint('https://open.test/v1/models')).toBe(false);
        const api = pickDialogueApi({ baseUrl: 'https://relay.test/v1', apiKey: 'key', model: '[渠道] gemini-4-argon', apiType: 'gemini' });
        expect(api.baseUrl).toBe(native); expect(llmApiType(api)).toBe('gemini');
        expect(configFromPreset({ id: 'p', name: 'p', config: api })).toMatchObject(api);
        expect(toCredentialValue(api)).toEqual({ apiUrl: native, apiKey: 'key', primaryModel: api.model });
        expect(resolveDialogueApi(api, { dialogueApi: { baseUrl: 'https://other.test/v1', apiKey: '', model: 'other' } })).toMatchObject({ apiType: 'openai', apiKey: '', model: 'other' });
    });

    it('keeps history and dynamic context in place without changing originals or adding cache controls', async () => {
        const body = { model: 'gemini-test', max_tokens: 900, messages: [
            { role: 'system', content: 'stable worldbook' }, { role: 'user', content: 'history 1' },
            { role: 'system', name: 'sully_history_context', content: '朋友圈历史' }, { role: 'assistant', content: 'history 2' },
            { role: 'user', content: 'latest user' }, { role: 'system', content: 'current time, recalled memories, current song' },
        ] };
        const original = structuredClone(body), out = await toGeminiRequest(body);
        expect(body).toEqual(original);
        expect(out.systemInstruction.parts[0].text).toBe('stable worldbook');
        expect(JSON.stringify(out.systemInstruction)).not.toContain('current time');
        expect(out.contents).toEqual([
            { role: 'user', parts: [{ text: 'history 1' }, { text: '<system-reminder>\n朋友圈历史\n</system-reminder>' }] },
            { role: 'model', parts: [{ text: 'history 2' }] },
            { role: 'user', parts: [{ text: 'latest user' }, { text: '<system-reminder>\ncurrent time, recalled memories, current song\n</system-reminder>' }] },
        ]);
        expect(out.generationConfig.maxOutputTokens).toBe(900); expect(JSON.stringify(out)).not.toContain('cache_control');
    });

    it('preserves signed parallel tool parts and matches tool responses to names and native IDs', async () => {
        const signed = [{ text: '查一下', thought: true, thoughtSignature: 'signed-secret' },
            { functionCall: { name: 'lookup', args: { q: 'A' }, id: 'native-A' }, thoughtSignature: 'sig-A' },
            { functionCall: { name: 'lookup', args: { q: 'B' }, id: 'native-B' } }];
        const response = fromGeminiMessage(reply(signed)); const message = response.choices[0].message;
        const assistant = { role: 'assistant', content: message.content, tool_calls: message.tool_calls, ...anthropicContinuation(message) };
        const body = { model: 'gemini-test', messages: [{ role: 'user', content: '查A和B' }, assistant,
            { role: 'tool', tool_call_id: 'native-A', content: 'result A' }, { role: 'tool', tool_call_id: 'native-B', content: 'result B' }] };
        const out = await toGeminiRequest(body);
        expect(out.contents[1].parts).toEqual(signed);
        expect(out.contents[2].parts.map((p: any) => p.functionResponse)).toEqual([
            { name: 'lookup', id: 'native-A', response: { result: 'result A' } }, { name: 'lookup', id: 'native-B', response: { result: 'result B' } },
        ]);
        expect(message.content).toBe(''); expect(message.reasoning_content).toBe('查一下');
    });

    it('maps tool policies, JSON schema and thinking without forwarding Claude fields', async () => {
        const out = await toGeminiRequest({ model: 'gemini-4-argon', messages: [{ role: 'user', content: 'test' }],
            tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false } } }],
            tool_choice: { type: 'function', function: { name: 'lookup' } }, response_format: { type: 'json_schema', json_schema: { schema: { type: 'object' } } },
            thinking: { type: 'enabled', budget_tokens: 1000 }, reasoning_effort: 'medium' });
        expect(out.tools[0].functionDeclarations[0].parametersJsonSchema.additionalProperties).toBe(false);
        expect(out.toolConfig.functionCallingConfig).toEqual({ mode: 'ANY', allowedFunctionNames: ['lookup'] });
        expect(out.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' }, thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' } });
        expect(out).not.toHaveProperty('thinking');
    });

    it('uses real relay billing counts even when outer cache count is zero, counting thoughts once', () => {
        const usage = geminiUsage({ promptTokenCount: 32786, candidatesTokenCount: 84, totalTokenCount: 32870, cachedContentTokenCount: 0,
            billing_usage: { source: 'oai_chat', openai_usage: { prompt_tokens: 32786, completion_tokens: 84, total_tokens: 32870, prompt_tokens_details: { cached_tokens: 30727 } } } });
        expect(usage).toMatchObject({ prompt_tokens: 32786, completion_tokens: 84, total_tokens: 32870, prompt_tokens_details: { cached_tokens: 30727 } });
        expect(geminiUsage({ promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 10, totalTokenCount: 115, cachedContentTokenCount: 40 })).toMatchObject({ completion_tokens: 15, total_tokens: 115, prompt_tokens_details: { cached_tokens: 40 } });
    });

    it('sends native auth/encoded model and retains caller cancellation without changing OpenAI requests', async () => {
        const transport = vi.fn().mockResolvedValue(Response.json(reply()));
        const controller = new AbortController();
        const result = await fetchLlm(native + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer private-key' }, signal: controller.signal,
            body: JSON.stringify({ model: '[反重力量] gemini-4-argon [不补]', messages: [{ role: 'user', content: 'hello' }] }) }, transport);
        const [url, options] = transport.mock.calls[0];
        expect(url).toContain('/v1beta/models/%5B'); expect(url).toContain(':generateContent');
        expect(options.headers.get('x-goog-api-key')).toBe('private-key'); expect(options.headers.has('authorization')).toBe(false);
        expect(options.signal).toBe(controller.signal); expect(await result.json()).toMatchObject({ choices: [{ message: { content: '你好呀' } }] });
        transport.mockClear().mockResolvedValue(Response.json({ unchanged: true }));
        const init = { method: 'POST', body: '{"model":"gemini","messages":[]}' };
        await fetchLlm('https://other.test/v1/chat/completions', init, transport);
        expect(transport).toHaveBeenCalledWith('https://other.test/v1/chat/completions', init);
    });

    it('normalizes official model resources but preserves relay display IDs', async () => {
        const transport = vi.fn().mockResolvedValueOnce(Response.json({ models: [{ name: 'models/gemini-test' }] }))
            .mockResolvedValueOnce(Response.json({ data: [{ id: '[渠道] gemini-test' }] }));
        const a = await fetchLlm(native + '/models', { headers: { Authorization: 'Bearer key' } }, transport);
        expect((await a.json()).data[0].id).toBe('gemini-test'); expect(transport.mock.calls[0][0]).toBe(native);
        const b = await fetchLlm(native + '/models', {}, transport); expect((await b.json()).data[0].id).toBe('[渠道] gemini-test');
    });

    it('converts data images and loads URL images without sending model credentials to image hosts', async () => {
        const transport = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
        const out = await toGeminiRequest({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }, { type: 'image_url', image_url: { url: 'https://image.test/a.png' } }] }] }, transport);
        expect(out.contents[0].parts).toEqual([{ inlineData: { mimeType: 'image/png', data: 'AQID' } }, { inlineData: { mimeType: 'image/png', data: 'AQID' } }]);
        expect(transport.mock.calls[0]).toEqual(['https://image.test/a.png', { signal: undefined }]);
    });

    it('assembles arbitrary UTF-8 fragments, tools, signatures and late usage through the real SSE parser', async () => {
        const first = reply([{ text: '你' }, { text: '想法', thought: true }]); delete (first.candidates[0] as any).finishReason;
        const last = reply([{ text: '好' }, { functionCall: { name: 'lookup', args: { city: '北京' } }, thoughtSignature: 'signed' }], { promptTokenCount: 9000, candidatesTokenCount: 30, cachedContentTokenCount: 8000, totalTokenCount: 9030 });
        const result = await safeResponseJson(convertGeminiStream(sse([first, last])));
        expect(result.choices[0].message).toMatchObject({ content: '你好', reasoning_content: '想法', tool_calls: [{ function: { name: 'lookup', arguments: '{"city":"北京"}' } }] });
        expect(result.choices[0].message.gemini_content.at(-1).thoughtSignature).toBe('signed');
        expect(anthropicContinuation(result.choices[0].message)).toHaveProperty('gemini_content');
        expect(result.usage.prompt_tokens_details.cached_tokens).toBe(8000); expect(result.choices[0].finish_reason).toBe('tool_calls');
    });

    it('rejects truncated/error streams and blocked replies instead of claiming completion', async () => {
        const incomplete = reply(); delete (incomplete.candidates[0] as any).finishReason;
        await expect(convertGeminiStream(sse([incomplete])).text()).rejects.toThrow('提前结束');
        await expect(convertGeminiStream(sse([{ error: { message: 'upstream failure' } }])).text()).rejects.toThrow('upstream failure');
        expect(() => fromGeminiMessage({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow('SAFETY');
        expect(fromGeminiMessage({ ...reply(), candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }] }).choices[0].finish_reason).toBe('length');
    });

    it('propagates cancellation to the upstream stream reader', async () => {
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(reply())}\n\n`)); }, cancel }));
        const reader = convertGeminiStream(response).body!.getReader(); await reader.read(); await reader.cancel('user stopped');
        expect(cancel).toHaveBeenCalledWith('user stopped');
    });

    it('does not retry or hide native HTTP errors', async () => {
        const transport = vi.fn().mockResolvedValue(new Response('quota exhausted', { status: 429 }));
        const response = await fetchLlm(native + '/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gemini', messages: [{ role: 'user', content: 'x' }] }) }, transport);
        expect(response.status).toBe(429); expect(await response.text()).toBe('quota exhausted'); expect(transport).toHaveBeenCalledTimes(1);
    });

    it('preserves native signatures through the real cloud SDK tool continuation', async () => {
        const original = globalThis.fetch;
        const signed = [{ functionCall: { name: 'lookup', args: { q: 'A' }, id: 'A' }, thoughtSignature: 'sig-A' }];
        const transport = vi.fn().mockResolvedValueOnce(Response.json(reply(signed))).mockResolvedValueOnce(Response.json(reply()));
        try {
            globalThis.fetch = transport; installAnthropicFetch(false);
            const payload = { apiUrl: native, apiKey: 'secret', primaryModel: 'gemini-test', messages: [{ role: 'user', content: 'hello' }], tools: [{ type: 'function' as const, function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }] };
            const first = await sdkCallLlm(payload, { requireContent: false });
            const second = await sdkCallLlm({ ...payload, messages: [...payload.messages, extractAssistantMessage(first.response), { role: 'tool', tool_call_id: 'A', content: 'test result' }] }, { requireContent: false });
            expect(second.content).toBe('你好呀');
            const sent = JSON.parse((transport.mock.calls[1][1] as any).body);
            expect(sent.contents[1].parts).toEqual(signed);
            expect(sent.contents[2].parts[0].functionResponse).toEqual({ name: 'lookup', id: 'A', response: { result: 'test result' } });
        } finally { globalThis.fetch = original; }
    });
});
