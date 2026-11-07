import { describe, expect, it } from 'vitest';
import { toAnthropicRequest } from './anthropicApi';
import { buildToolResultMessage, normalizeToolCallsForCompat, toolTurnContinuation } from './toolCallCompat';

describe('tool call compatibility', () => {
    it('为 Gemini 的空调用 ID 生成稳定 ID，并把工具名放回结果消息', () => {
        const calls = normalizeToolCallsForCompat([{
            id: '',
            type: 'function',
            function: { name: 'lover_connect', arguments: '{}' },
        }], 'mcp_0');

        expect(calls[0].id).toBe('call_mcp_0_lover_connect_0');

        const result = buildToolResultMessage(calls[0], '{"ok":true}');
        expect(result).toEqual({
            role: 'tool',
            name: 'lover_connect',
            tool_call_id: calls[0].id,
            content: '{"ok":true}',
        });
    });

    it('保留有效调用 ID，并避免并行调用出现重复 ID', () => {
        const calls = normalizeToolCallsForCompat([
            { id: 'call-1', function: { name: 'first_tool', arguments: '{}' } },
            { id: 'call-1', function: { name: 'second_tool', arguments: '{}' } },
        ], 'mcp_1');

        expect(calls[0].id).toBe('call-1');
        expect(calls[1].id).toBe('call_mcp_1_second_tool_1');
    });
    it('OpenAI 兼容思考模型工具循环回传非空 reasoning_content，空值不增加字段', () => {
        const toolCalls = [{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{"q":"A"}' } }];
        const reply = { role: 'assistant', content: '', tool_calls: toolCalls, reasoning_content: '查完 A 再答' };
        expect(toolTurnContinuation(reply)).toEqual({ reasoning_content: '查完 A 再答' });
        expect(toolTurnContinuation({ reasoning_content: '' })).toEqual({});
        expect(toolTurnContinuation({ reasoning_content: null })).toEqual({});
        expect(toolTurnContinuation(undefined)).toEqual({});
    });

    it('Anthropic 签名思考块被保留，OpenAI 兼容额外字段不影响原生转换', () => {
        const thinking = [{ type: 'thinking', thinking: '先查 A', signature: 'sig' }];
        const reply = {
            role: 'assistant', content: '', reasoning_content: '先查 A',
            anthropic_thinking: thinking,
            anthropic_content: [...thinking, { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'A' } }],
        };
        const continuation = toolTurnContinuation(reply);
        expect(continuation.anthropic_thinking).toEqual(thinking);
        const message = (extra: Record<string, any>) => ({
            model: 'claude-test',
            messages: [
                { role: 'user', content: '帮我查 A' },
                { role: 'assistant', content: '(调用工具中)',
                  tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'search', arguments: '{"q":"A"}' } }],
                  ...extra },
                { role: 'tool', tool_call_id: 'toolu_1', content: 'A 找到了' },
            ],
        });
        const { reasoning_content: _ignored, ...signedOnly } = continuation;
        expect(toAnthropicRequest(message(continuation)))
            .toEqual(toAnthropicRequest(message(signedOnly)));
    });

});
