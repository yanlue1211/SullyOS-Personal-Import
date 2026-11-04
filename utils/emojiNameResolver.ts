import type { Emoji, EmojiCategory } from '../types';

/** Only spelling/format corrections against the supplied visible library; never semantic guessing. */
const normalizeName = (value: string): string => value.normalize('NFKC').trim().toLowerCase()
    .replace(/^["'“”‘’「『【\[]+|["'“”‘’」』】\]]+$/gu, '')
    .replace(/[\s\u200b-\u200d\ufeff]+/gu, '');

const uniqueEmoji = (items: readonly Emoji[]): Emoji | undefined => {
    const urls = new Set(items.map(item => item.url));
    return items.length > 0 && urls.size === 1 ? items[0] : undefined;
};

function matchName(name: string, emojis: readonly Emoji[]): Emoji | undefined {
    const exact = emojis.filter(emoji => emoji.name === name && !!emoji.url);
    if (exact.length) return uniqueEmoji(exact);
    const normalized = normalizeName(name);
    if (!normalized) return undefined;
    return uniqueEmoji(emojis.filter(emoji => !!emoji.url && normalizeName(emoji.name) === normalized));
}

export function resolveEmojiForSend(rawName: string, emojis: readonly Emoji[], categories: readonly EmojiCategory[] = []): Emoji | undefined {
    const name = rawName.trim();
    // A real library name containing punctuation or a category-like prefix wins.
    const exact = emojis.filter(emoji => emoji.name === name && !!emoji.url);
    if (exact.length) return uniqueEmoji(exact);

    const separator = name.match(/^(.+?)\s*[:：]\s*(.+)$/u);
    if (separator) {
        const categoryName = normalizeName(separator[1]);
        const emojiName = separator[2].trim();
        const categoryIds = new Set(categories.map(category => category.id));
        const matchedIds = new Set(categories.filter(category => normalizeName(category.name) === categoryName).map(category => category.id));
        const scoped = emojis.filter(emoji => matchedIds.has(emoji.categoryId || '')
            || (categoryName === normalizeName('通用') && !emoji.categoryId)
            || (categoryName === normalizeName('其他') && !!emoji.categoryId && !categoryIds.has(emoji.categoryId)));
        // Explicit but unknown/ambiguous categories cannot escape into another category.
        return matchName(emojiName, scoped);
    }
    return matchName(name, emojis);
}

export function buildEmojiNameReminder(): string {
    return '\n[表情包名称校验] 若要发表情包，只能从本轮可用表情库逐字复制现有名称，用 [[SEND_EMOJI:准确名称]]，不得自拟、改写或照抄历史中的错误名称；没有合适的就正常用文字回复。\n';
}
