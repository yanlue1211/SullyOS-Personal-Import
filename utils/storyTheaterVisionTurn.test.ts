import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { selectCurrentStoryMedia } from './storyTheaterVisionTurn';

const user = (id: number, hasImage = false): Message => ({
    id, charId: 'story-test', role: 'user', type: 'text',
    content: hasImage ? '[图片]' : '继续剧情',
    metadata: hasImage ? { realMedia: { kind: 'image' } } : {},
} as Message);
const assistant = (id: number): Message => ({
    id, charId: 'story-test', role: 'assistant', type: 'text',
    content: '回应',
    metadata: { realMedia: { kind: 'image' } },
} as Message);

describe('story theatre photo evidence scope', () => {
    const history = [user(1, true), assistant(2), user(3), assistant(4)];
    it('allows the image on its original user turn', () => {
        expect(selectCurrentStoryMedia(history, 1)?.id).toBe(1);
    });
    it('does not read an old photo again on an ordinary text turn', () => {
        expect(selectCurrentStoryMedia(history, 3)).toBeUndefined();
    });
    it('allows original-photo reroll or failed-turn retry', () => {
        expect(selectCurrentStoryMedia(history, 1)?.id).toBe(1);
    });
    it('never selects a photo from an assistant turn', () => {
        expect(selectCurrentStoryMedia(history, 2)).toBeUndefined();
    });
    it('does not re-inject historical media on continuing/opening without a user turn', () => {
        expect(selectCurrentStoryMedia(history, 0)).toBeUndefined();
        expect(selectCurrentStoryMedia(history, -1)).toBeUndefined();
    });
    it('selects a new image only on the newest image turn', () => {
        expect(selectCurrentStoryMedia([...history, user(5, true)], 5)?.id).toBe(5);
    });
});
