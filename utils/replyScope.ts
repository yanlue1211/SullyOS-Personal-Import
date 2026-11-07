/**
 * Define the scope of one reply across multiple model requests and tool results.
 * Keep this dependency-free: both browser chat and Cloudflare Worker use it.
 * Adapted from upstream qegj567-cloud/SullyOS 84d10385db.
 */
export type ReplyTrigger = 'user' | 'scheduled';

export const buildReplyScopeRule = (trigger: ReplyTrigger): string => {
    const start = trigger === 'user'
        ? '从用户最新发来的那条消息开始'
        : '从你收到这份说明开始（你之前安排的主动消息到点了）';
    return `[这次回复的范围：${start}，到你给出一条不再调用工具的正文为止。`
        + '这期间你每调用一次工具、拿到一次结果，都只是这次回复里的一步，不是新的一次；'
        + '你在这期间写下的话都算这次回复的一部分，后面不必重复。]';
};
