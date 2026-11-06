import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./db', () => ({ DB: { findGalleryImageBySourceMessageId: vi.fn(), saveGalleryImage: vi.fn() } }));
import { DB } from './db';
import { consumePhotoChoices } from './photoChoice';
import type { Message } from '../types';
const photo = { id: 42, charId: 'c', role: 'user', type: 'image', content: 'blobref:original', timestamp: 10 } as Message;
beforeEach(() => { vi.resetAllMocks(); });
describe('character photo choices', () => {
    it('does nothing without a choice; saves original reference once for repeated commands', async () => {
        expect(await consumePhotoChoices('好看', 'c', [photo])).toBe('好看');
        expect(DB.saveGalleryImage).not.toHaveBeenCalled();
        expect(await consumePhotoChoices('留着[[SAVE_PHOTO: 42]][[SAVE_PHOTO: 42]]', 'c', [photo])).toBe('留着');
        expect(DB.saveGalleryImage).toHaveBeenCalledTimes(1);
        expect(DB.saveGalleryImage).toHaveBeenCalledWith(expect.objectContaining({ sourceMessageId: 42, url: photo.content }));
    });
    it('rejects invented ids, another character, assistant images and emojis', async () => {
        for (const invalid of [{ ...photo, charId: 'other' }, { ...photo, role: 'assistant' }, { ...photo, type: 'emoji' }]) {
            await consumePhotoChoices('[[SAVE_PHOTO: 42]][[SAVE_PHOTO: 999]]', 'c', [invalid as Message]);
        }
        expect(DB.saveGalleryImage).not.toHaveBeenCalled();
    });
    it('replay is idempotent and storage failure never discards the reply', async () => {
        vi.mocked(DB.findGalleryImageBySourceMessageId).mockResolvedValueOnce({ id: 'exists' } as any);
        await consumePhotoChoices('[[SAVE_PHOTO: 42]]', 'c', [photo]);
        expect(DB.saveGalleryImage).not.toHaveBeenCalled();
        vi.mocked(DB.saveGalleryImage).mockRejectedValueOnce(new Error('quota'));
        expect(await consumePhotoChoices('正文[[SAVE_PHOTO: 42]]', 'c', [photo])).toBe('正文');
    });
});
