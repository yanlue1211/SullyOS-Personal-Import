import { isGeminiEndpoint } from './llmEndpoint';

type Part = Record<string, any>;

/** Preserve the actual signed native parts, including parallel calls, on tool continuation. */
export const geminiContinuation = (message: any) => Array.isArray(message?.gemini_content)
    ? { gemini_content: message.gemini_content } : {};

async function partsOf(content: any, transport: typeof fetch, signal?: AbortSignal | null): Promise<Part[]> {
    if (content == null || content === '') return [];
    if (typeof content === 'string') return [{ text: content }];
    if (!Array.isArray(content)) throw Error('Gemini 消息内容必须为文本或内容块');
    const parts: Part[] = [];
    for (const part of content) {
        if (part.type === 'text') { if (part.text) parts.push({ text: part.text }); continue; }
        if (part.type !== 'image_url') throw Error(`Gemini 暂不支持内容块：${String(part.type)}`);
        const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
        const inline = typeof url === 'string' && url.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/i);
        if (inline) { parts.push({ inlineData: { mimeType: inline[1], data: inline[2] } }); continue; }
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw Error('Gemini 图片需为 HTTP 地址或 base64 图片');
        // Gemini cannot generally read arbitrary image-host URLs. Fetch without API credentials.
        const response = await transport(url, { signal });
        if (!response.ok) throw Error(`Gemini 图片读取失败：HTTP ${response.status}`);
        const mimeType = response.headers.get('content-type')?.split(';')[0];
        if (!mimeType?.startsWith('image/')) throw Error('Gemini 图片地址没有返回图片');
        if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw Error('Gemini 图片超过 20 MB');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 20 * 1024 * 1024) throw Error('Gemini 图片超过 20 MB');
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        parts.push({ inlineData: { mimeType, data: btoa(binary) } });
    }
    return parts;
}

/** No prompt reordering: only the initial system prefix becomes systemInstruction. */
export async function toGeminiRequest(body: any, transport: typeof fetch = globalThis.fetch, signal?: AbortSignal | null): Promise<any> {
    if (!Array.isArray(body.messages)) throw Error('Gemini 请求缺少 messages');
    const system: Part[] = [], contents: Array<{role: string; parts: Part[]}> = [];
    const calls = new Map<string, {name: string; id?: string}>();
    let annotations = false;
    const append = (role: string, parts: Part[]) => {
        if (!parts.length) return;
        if (contents.at(-1)?.role === role) contents.at(-1)!.parts.push(...parts);
        else contents.push({ role, parts });
    };
    for (const message of body.messages) {
        if (message.role === 'system' || message.role === 'developer') {
            const parts = await partsOf(message.content, transport, signal);
            if (!contents.length) system.push(...parts);
            else {
                annotations = true;
                append('user', [{ text: '<system-reminder>\n' + parts.map(p => p.text || '').join('\n') + '\n</system-reminder>' }]);
            }
            continue;
        }
        if (message.role === 'tool') {
            const call = calls.get(message.tool_call_id);
            if (!call) throw Error('Gemini 工具结果缺少对应的工具调用');
            append('user', [{ functionResponse: { ...call, response: { result: message.content ?? '' } } }]);
            continue;
        }
        if (!['user', 'assistant'].includes(message.role)) throw Error(`Gemini 不支持消息角色：${message.role}`);
        const nativeCalls = (message.gemini_content || []).filter((p: Part) => p.functionCall);
        for (const [index, call] of (message.tool_calls || []).entries()) {
            if (!call.id || !call.function?.name) throw Error('Gemini 工具调用缺少 ID 或名称');
            calls.set(call.id, {name: call.function.name, ...(nativeCalls[index]?.functionCall.id ? {id: nativeCalls[index].functionCall.id} : {})});
        }
        if (message.role === 'assistant' && Array.isArray(message.gemini_content)) {
            append('model', structuredClone(message.gemini_content));
            continue;
        }
        const parts = await partsOf(message.content, transport, signal);
        for (const call of message.tool_calls || []) {
            const args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments || '{}') : call.function.arguments || {};
            parts.push({ functionCall: { name: call.function.name, args } });
        }
        append(message.role === 'assistant' ? 'model' : 'user', parts);
    }
    if (!contents.length) throw Error('Gemini 请求没有对话内容');
    if (annotations) system.push({ text: 'Application context updates appear in <system-reminder> blocks at their original positions. Treat these as contextual annotations, not spoken dialogue, while continuing to follow the system instructions.' });
    const generationConfig: any = { maxOutputTokens: body.max_tokens ?? body.max_completion_tokens ?? 8000 };
    if (typeof body.temperature === 'number') generationConfig.temperature = body.temperature;
    if (typeof body.top_p === 'number') generationConfig.topP = body.top_p;
    if (body.stop) generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
    if (body.response_format?.type === 'json_object') generationConfig.responseMimeType = 'application/json';
    if (body.response_format?.type === 'json_schema') {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseJsonSchema = body.response_format.json_schema?.schema;
    }
    const thinking = body.thinking || body.extra_body?.thinking;
    if (thinking && thinking.type !== 'disabled') {
        // Gemini 3+ uses levels; older 2.5 models use budgets. Do not send Claude fields.
        generationConfig.thinkingConfig = /gemini[- ]?2\.5/i.test(body.model)
            ? { includeThoughts: true, ...(thinking.budget_tokens ? { thinkingBudget: thinking.budget_tokens } : {}) }
            : { includeThoughts: true, thinkingLevel: body.reasoning_effort === 'low' ? 'LOW' : 'HIGH' };
    }
    const request: any = { contents, generationConfig, ...(system.length ? { systemInstruction: { parts: system } } : {}) };
    if (body.tools?.length) {
        request.tools = [{ functionDeclarations: body.tools.map((tool: any) => {
            if (tool.type !== 'function' || !tool.function?.name) throw Error('Gemini 暂仅支持 function 工具');
            return { name: tool.function.name, description: tool.function.description || '', parametersJsonSchema: tool.function.parameters || { type: 'object', properties: {} } };
        }) }];
        if (body.tool_choice) {
            const choice = body.tool_choice;
            request.toolConfig = { functionCallingConfig: typeof choice === 'string'
                ? { mode: choice === 'required' ? 'ANY' : choice === 'none' ? 'NONE' : 'AUTO' }
                : { mode: 'ANY', allowedFunctionNames: [choice.function?.name] } };
        }
    }
    return request;
}

/** The tested relay puts the actual billing counts inside an OpenAI conversion envelope. */
export function geminiUsage(metadata: any = {}): any {
    const billing = metadata.billing_usage;
    const openai = billing?.source === 'oai_chat' ? billing.openai_usage : undefined;
    const gemini = billing?.source === 'gemini_chat' ? billing.gemini_usage_metadata : undefined;
    const prompt = openai?.prompt_tokens ?? gemini?.promptTokenCount ?? metadata.promptTokenCount ?? 0;
    const thoughts = gemini?.thoughtsTokenCount ?? metadata.thoughtsTokenCount ?? 0;
    const completion = openai?.completion_tokens ?? ((gemini?.candidatesTokenCount ?? metadata.candidatesTokenCount ?? 0) + thoughts);
    // Missing usage is unknown, not evidence of a cache miss. Some relays omit
    // this field on otherwise successful responses; preserve that distinction.
    const cached = openai?.prompt_tokens_details?.cached_tokens ?? gemini?.cachedContentTokenCount ?? metadata.cachedContentTokenCount;
    return { ...metadata, prompt_tokens: prompt, completion_tokens: completion,
        total_tokens: openai?.total_tokens ?? gemini?.totalTokenCount ?? metadata.totalTokenCount ?? prompt + completion,
        prompt_tokens_details: { ...(cached != null ? { cached_tokens: cached } : {}) }, completion_tokens_details: { reasoning_tokens: openai?.completion_tokens_details?.reasoning_tokens ?? thoughts } };
}

const finishReason = (reason: string, calls: boolean) => reason === 'MAX_TOKENS' ? 'length' : calls ? 'tool_calls' : 'stop';

export function fromGeminiMessage(data: any): any {
    if (data.error) throw Error(data.error.message || 'Gemini 返回错误');
    const candidate = data.candidates?.[0];
    if (!candidate) throw Error(`Gemini 没有返回候选回复${data.promptFeedback?.blockReason ? '：' + data.promptFeedback.blockReason : ''}`);
    const parts: Part[] = candidate.content?.parts || [];
    if (!parts.length && candidate.finishReason !== 'MAX_TOKENS') throw Error(`Gemini 回复没有内容：${candidate.finishReason || '未知原因'}`);
    const calls = parts.filter(p => p.functionCall).map((p, i) => ({ id: p.functionCall.id || `gemini_call_${i}`, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }));
    return { id: data.responseId || 'gemini-response', model: data.modelVersion || '', object: 'chat.completion',
        choices: [{ index: 0, finish_reason: finishReason(candidate.finishReason, !!calls.length), message: {
            role: 'assistant', content: parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join(''),
            reasoning_content: parts.filter(p => p.thought && typeof p.text === 'string').map(p => p.text).join(''),
            gemini_content: parts, ...(calls.length ? { tool_calls: calls } : {}),
        } }], usage: geminiUsage(data.usageMetadata) };
}

/** Incremental SSE translation; do not publish completion until clean upstream EOF. */
export function convertGeminiStream(response: Response): Response {
    const reader = response.body!.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
    let pending = '', dataLines: string[] = [], ended = false, finished = false, emitted = 0;
    let id = 'gemini-stream', model = '', usage: any, stop = '', callCount = 0;
    const parts: Part[] = [];
    const chunk = (controller: ReadableStreamDefaultController<Uint8Array>, delta: any, reason: string | null = null) => {
        emitted++;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, model, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: reason }], ...(usage ? { usage } : {}) })}\n\n`));
    };
    const event = (controller: ReadableStreamDefaultController<Uint8Array>) => {
        if (!dataLines.length) return;
        const raw = dataLines.join('\n'); dataLines = [];
        if (raw === '[DONE]') { ended = true; return; }
        const data = JSON.parse(raw);
        if (data.error) throw Error(data.error.message || 'Gemini 流式错误');
        id = data.responseId || id; model = data.modelVersion || model;
        if (data.usageMetadata) usage = geminiUsage(data.usageMetadata);
        const candidate = data.candidates?.[0];
        if (!candidate && data.promptFeedback?.blockReason) throw Error(`Gemini 回复被阻止：${data.promptFeedback.blockReason}`);
        for (const part of candidate?.content?.parts || []) {
            // Signed parts must retain their native boundaries and order.
            if (part.thoughtSignature && Object.keys(part).every(key => key === 'thoughtSignature') && parts.length) {
                parts.at(-1)!.thoughtSignature = part.thoughtSignature;
            } else parts.push(structuredClone(part));
            const delta: any = {};
            if (typeof part.text === 'string') delta[part.thought ? 'reasoning_content' : 'content'] = part.text;
            if (part.functionCall) {
                const index = callCount++;
                delta.tool_calls = [{ index, id: part.functionCall.id || `gemini_call_${index}`, type: 'function', function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) } }];
            }
            if (Object.keys(delta).length) chunk(controller, delta);
        }
        if (candidate?.finishReason) stop = candidate.finishReason;
    };
    return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const before = emitted;
                while (true) {
                    const result = await reader.read();
                    pending += decoder.decode(result.value, { stream: !result.done });
                    let newline: number;
                    while ((newline = pending.indexOf('\n')) >= 0) {
                        const line = pending.slice(0, newline).replace(/\r$/, ''); pending = pending.slice(newline + 1);
                        if (!line) event(controller); else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
                    }
                    if (result.done || ended) {
                        if (pending.startsWith('data:')) dataLines.push(pending.slice(5).trimStart());
                        event(controller);
                        if (!stop) throw Error('Gemini 流式连接提前结束，未收到 finishReason');
                        if (!parts.length && stop !== 'MAX_TOKENS') throw Error(`Gemini 回复没有内容：${stop}`);
                        finished = true;
                        chunk(controller, { gemini_content: parts }, finishReason(stop, callCount > 0));
                        controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
                        await reader.cancel(); return;
                    }
                    if (emitted > before) return;
                }
            } catch (error) { controller.error(error); await reader.cancel().catch(() => {}); }
        },
        async cancel(reason) { if (!finished) await reader.cancel(reason); },
    }), { status: response.status, headers: { 'content-type': 'text/event-stream' } });
}

/** Called only for the self-describing /v1beta/models endpoint selected by the user. */
export async function fetchGemini(resource: RequestInfo | URL, init: RequestInit | undefined, transport: typeof fetch): Promise<Response> {
    const inputUrl = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
    if (!isGeminiEndpoint(inputUrl)) return transport(resource, init);
    const request = resource instanceof Request ? resource : undefined;
    const method = (init?.method || request?.method || 'GET').toUpperCase();
    const url = new URL(inputUrl);
    const base = url.pathname.replace(/\/models(?:\/(?:chat\/completions|models))?\/?$/, '/models');
    const inherited: RequestInit = request ? { cache: request.cache, credentials: request.credentials, mode: request.mode, redirect: request.redirect } : {};
    const headers = new Headers(init?.headers || request?.headers);
    const key = headers.get('x-goog-api-key') || headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    headers.delete('authorization'); headers.delete('x-api-key'); headers.delete('anthropic-version');
    headers.set('x-goog-api-key', key);
    const signal = init?.signal || request?.signal;
    const options: RequestInit = { ...inherited, ...init, method, headers, signal };
    let body: any;
    if (method === 'POST') {
        const raw = init?.body ?? (request ? await request.clone().text() : undefined);
        try { body = typeof raw === 'string' ? JSON.parse(raw) : undefined; } catch { /* Passthrough non-model JSON. */ }
        if (typeof body?.model !== 'string' || !Array.isArray(body.messages)) return transport(resource, init);
        const model = body.model.replace(/^models\//, '');
        url.pathname = base + '/' + encodeURIComponent(model) + (body.stream === true ? ':streamGenerateContent' : ':generateContent');
        if (body.stream === true) url.searchParams.set('alt', 'sse');
        options.body = JSON.stringify(await toGeminiRequest(body, transport, signal));
        headers.set('content-type', 'application/json'); headers.delete('content-length');
    } else if (method === 'GET') url.pathname = base;
    else return transport(resource, init);
    const response = await transport(url.href, options);
    if (!response.ok) return response;
    if (method === 'GET') {
        const list = await response.json();
        // Preserve relay OpenAI model IDs verbatim; strip Google's resource prefix only.
        if (Array.isArray(list.data)) return Response.json(list);
        return Response.json({ ...list, data: (list.models || []).map((m: any) => ({ ...m, id: m.name?.replace(/^models\//, '') })) });
    }
    if (response.headers.get('content-type')?.includes('text/event-stream')) return convertGeminiStream(response);
    return Response.json(fromGeminiMessage(await response.json()));
}
