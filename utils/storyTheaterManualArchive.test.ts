import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { createStoryTheaterDraft, normalizeStoryTheater, storyTheaterThreadId } from './storyTheater';
import { archiveStoryManually } from './storyTheaterArchive';

const api = { baseUrl: 'https://fake.test/v1', apiKey: 'test', model: 'test' };
const response = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '雨停时，两人结伴回家。' } }] }), { status: 200 });
const fetchMock = vi.fn();
let serial = 0;
let entryId = '';
let userId = 0;
let assistantId = 0;
const current = async () => (await DB.getStoryTheaters()).find(x => x.id === entryId)!;
const source = async () => (await DB.getMessagesByCharId(storyTheaterThreadId(entryId), true)).filter(x => x.metadata?.source === 'story_theater');
const summarize = () => archiveStoryManually(entryId, api);

beforeEach(async () => {
    serial++;
    fetchMock.mockReset().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    entryId = `theater-manual-${serial}`;
    await DB.saveStoryTheater(normalizeStoryTheater({ ...createStoryTheaterDraft(), id: entryId,
        title: '雨夜车站', archiveMode: 'manual', writesToCharacterMemory: false,
    }));
    userId = await DB.saveMessage({ charId: storyTheaterThreadId(entryId), role: 'user', type: 'text',
        content: '雨快停了吗？', timestamp: 10, metadata: { source: 'story_theater', theaterId: entryId } });
    assistantId = await DB.saveMessage({ charId: storyTheaterThreadId(entryId), role: 'assistant', type: 'text',
        content: '远处的路灯亮起来了。', timestamp: 11, metadata: { source: 'story_theater', theaterId: entryId } });
});
afterEach(() => vi.unstubAllGlobals());

describe('isolated fictional theater manual archiving', () => {
    it('archives all pending layers including the latest assistant reply, and keeps the original text', async () => {
        const result = await summarize();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.archives).toHaveLength(1);
        expect(result.archives[0]).toMatchObject({
            strategy: 'summary', messageCount: 2, fromMessageId: userId,
            toMessageId: assistantId, summary: '雨停时，两人结伴回家。',
        });
        const rows = await source();
        expect(rows.map(row => row.content)).toEqual(['雨快停了吗？', '远处的路灯亮起来了。']);
        expect(rows.every(row => row.metadata?.theaterArchived)).toBe(true);
        expect((await current()).archives).toEqual(result.archives);
        await expect(summarize()).rejects.toThrow('没有待总结');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never generates automatically on new data or in the original auto archive mode', async () => {
        await DB.saveStoryTheater({ ...await current(), archiveMode: 'auto' });
        await expect(summarize()).rejects.toThrow('手动总结');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a partial user turn before making a paid request', async () => {
        await DB.saveMessage({ charId: storyTheaterThreadId(entryId), role: 'user', type: 'text',
            content: '再说两句？', timestamp: 12, metadata: { source: 'story_theater', theaterId: entryId } });
        await expect(summarize()).rejects.toThrow('完成本轮');
        expect(fetchMock).not.toHaveBeenCalled();
        expect((await current()).archives).toHaveLength(0);
    });

    it('rejects live edits and new replies arriving while the model is responding', async () => {
        fetchMock.mockImplementationOnce(async () => {
            await DB.saveMessage({ charId: storyTheaterThreadId(entryId), role: 'user',
                type: 'text', content: '新的推进', timestamp: 13,
                metadata: { source: 'story_theater', theaterId: entryId } });
            return response();
        });
        await expect(summarize()).rejects.toThrow('已在其他窗口变更');
        expect((await current()).archives).toHaveLength(0);
        expect((await source()).every(row => !row.metadata?.theaterArchived)).toBe(true);
    });

    it('refuses a changed theater while the request is in flight; preserves the edit', async () => {
        fetchMock.mockImplementationOnce(async () => {
            await DB.saveStoryTheater({ ...await current(), premise: '另一窗口的新内容' });
            return response();
        });
        await expect(summarize()).rejects.toThrow('已在其他窗口变更');
        expect((await current()).premise).toBe('另一窗口的新内容');
        expect((await source()).every(row => !row.metadata?.theaterArchived)).toBe(true);
    });

    it('coalesces repeated clicks into one request until completion', async () => {
        let release!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
        const first = summarize();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await expect(summarize()).rejects.toThrow('正在总结');
        release(response());
        await first;
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('writes the event box and flags atomically, rolling back on storage failure', async () => {
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
            if (this.name === 'story_theaters') throw new Error('磁盘写入失败');
            return original.apply(this, args);
        });
        try { await expect(summarize()).rejects.toThrow('磁盘写入失败'); }
        finally { spy.mockRestore(); }
        expect((await source()).every(row => !row.metadata?.theaterArchived)).toBe(true);
        expect((await current()).archives).toHaveLength(0);
    });

    it('keeps all content and makes no request if the API configuration is incomplete', async () => {
        await expect(archiveStoryManually(entryId, { baseUrl: '', apiKey: '', model: '' })).rejects.toThrow('API');
        expect(fetchMock).not.toHaveBeenCalled();
        expect((await current()).archives).toHaveLength(0);
    });
});
