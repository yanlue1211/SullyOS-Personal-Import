import type { Message } from '../types';
import { DB } from './db';
import { getLocalDateKey } from './localDate';

/** Consume only explicit choices for actual user images included in this reply's context. */
export async function consumePhotoChoices(raw: string, charId: string, context: Message[], notify: (message: string) => void = () => {}) {
    const ids = new Set<number>();
    const text = raw.replace(/\[\[SAVE_PHOTO\s*[:：]\s*([^\]]*)\]\]/gi, (_, value: string) => {
        if (/^\d+$/.test(value.trim())) ids.add(Number(value.trim()));
        return '';
    });
    for (const id of ids) {
        const message = context.find(m => m.id === id && m.charId === charId && !m.groupId && m.role === 'user' && m.type === 'image');
        if (!message || !/^(blobref:|data:image\/|https?:\/\/)/i.test(message.content)) continue;
        try {
            if (await DB.findGalleryImageBySourceMessageId(charId, id)) continue;
            await DB.saveGalleryImage({
                id: `chat-photo-${charId}-${id}`, charId, sourceMessageId: id,
                url: message.content, timestamp: message.timestamp,
                savedDate: getLocalDateKey(new Date()),
                chatContext: context.slice(Math.max(0, context.indexOf(message) - 10), context.indexOf(message)).map(m =>
                    `${m.role === 'user' ? '用户' : '角色'}: ${['image', 'emoji'].includes(m.type) ? '[图片]' : m.content.slice(0, 100)}`),
            });
            notify('TA 将图片保存至相册');
        } catch (error) {
            console.warn('[PhotoChoice] 保存失败，聊天继续', error);
            notify('图片未能存入相册');
        }
    }
    return text;
}
