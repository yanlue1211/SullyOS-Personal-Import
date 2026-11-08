import { afterEach, expect, it, vi } from 'vitest';
import type { CharacterProfile, PhoneEvidence } from '../types';
import { DB } from './db';
import { dataUrlToBlob, deleteBlobRef, getBlobForRef, putImageBlob } from './blobRef';
import { archiveStoryManually } from './storyTheaterArchive';
import { createStoryTheaterDraft, normalizeStoryTheater, storyTheaterThreadId } from './storyTheater';
import { hasRomanticPair, updateHomeRomanticRelation } from '../apps/room3d/homeRomance';

/** Combined smoke test deliberately uses the real single-user fake IndexedDB.
 * Simulates the four independent PRs on the same underlying DB without creating
 * a second memory system, a new backend, a paid request or a data migration.
 */
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const api = { baseUrl: 'https://example.invalid/v1', apiKey: 'mock-only', model: 'mock-summary' };
let serial = 0;
afterEach(() => vi.unstubAllGlobals());

it('phone cards, protected album photo, theater summary and home relationships coexist without touching native memories', async () => {
    const suffix = ++serial;
    const charId = `fourway-character-${suffix}`;
    const entryId = `fourway-theater-${suffix}`;
    const assetId = `fourway-protected-image-${suffix}`;
    const nativeMemory = { id: `keep-memory-${suffix}`, content: '保留原生记忆', importance: 5 };
    const char = {
        id: charId, name: '安全测试角色',
        memories: [nativeMemory], phoneState: { records: [], sendToChat: true },
    } as unknown as CharacterProfile;
    await DB.saveCharacter(char);

    const ref = await putImageBlob(dataUrlToBlob(tinyPng));
    await DB.saveAsset(assetId, ref);
    await deleteBlobRef(ref);
    expect(await getBlobForRef(ref)).not.toBeNull();

    const phoneRow: PhoneEvidence = {
        id: `phone-row-${suffix}`, type: 'delivery',
        title: '点心到了', detail: '请到门口取餐', timestamp: Date.now(),
    };
    // The new private chat card and phone ledger must commit as one operation.
    await DB.savePhoneGeneration(charId, { records: [phoneRow] }, '外卖');
    const beforeStory = await DB.getMessagesByCharId(charId, true);
    expect(beforeStory).toHaveLength(1);
    expect(beforeStory[0].type).toBe('phone_card');

    await DB.saveStoryTheater(normalizeStoryTheater({
        ...createStoryTheaterDraft(), id: entryId, title: '雨夜归途',
        archiveMode: 'manual', writesToCharacterMemory: false,
    }));
    const threadId = storyTheaterThreadId(entryId);
    await DB.saveMessage({
        charId: threadId, role: 'user', type: 'text',
        content: '雨停了吗？', metadata: { source: 'story_theater', theaterId: entryId },
    });
    await DB.saveMessage({
        charId: threadId, role: 'assistant', type: 'text',
        content: '路灯亮起来了。', metadata: { source: 'story_theater', theaterId: entryId },
    });

    // Neither saving the phone row, nor writing the story layers calls any model.
    const mockedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{ message: { content: '雨停后回家。' }, finish_reason: 'stop' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', mockedFetch);
    expect(mockedFetch).not.toHaveBeenCalled();
    const archive = await archiveStoryManually(entryId, api);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(archive.archives).toHaveLength(1);

    const persistedChar = (await DB.getAllCharacters()).find(x => x.id === charId)!;
    expect(persistedChar.memories).toEqual([nativeMemory]);
    expect(persistedChar.phoneState!.records).toHaveLength(1);
    expect(persistedChar.phoneState!.records[0].systemMessageId).toBe(beforeStory[0].id);
    expect(await DB.getMessagesByCharId(charId, true)).toEqual(beforeStory);
    const originalTheater = await DB.getMessagesByCharId(threadId, true);
    expect(originalTheater).toHaveLength(2);
    expect(originalTheater.every(row => row.metadata?.theaterArchived)).toBe(true);

    // The relationship fix is in the home view only, not saved to native memory.
    const home = updateHomeRomanticRelation({}, 'user', charId, false);
    expect(hasRomanticPair(home, 'user', charId)).toBe(false);
    expect(hasRomanticPair(home, 'user', 'other-char')).toBe(true);
    expect(hasRomanticPair(home, charId, 'other-char')).toBe(false);
    expect((await DB.getAllCharacters()).find(x => x.id === charId)?.memories).toEqual([nativeMemory]);

    await DB.deleteAsset(assetId);
    await deleteBlobRef(ref);
    expect(await getBlobForRef(ref)).toBeNull();
});
