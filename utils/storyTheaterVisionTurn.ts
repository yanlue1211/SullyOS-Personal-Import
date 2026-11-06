import type { Message } from '../types';

/**
 * Only attach real media from the user turn currently being answered.
 * The same photo must not be fed back to vision on every later story turn.
 * Rerolls/retries pass the original pending user turn ID.
 */
export function selectCurrentStoryMedia(messages: Message[], userMessageId: number): Message | undefined {
    if (!Number.isFinite(userMessageId) || userMessageId <= 0) return undefined;
    return messages.find(message =>
        message.id === userMessageId &&
        message.role === 'user' &&
        Boolean(message.metadata?.realMedia)
    );
}
