import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { DB, openDB } from './db';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { WORKROOM_STORES, transactionDone } from '../features/workroom/schema';
import { drainWorkroomOutbox } from '../features/workroom/delivery';
import { exportWorkroomBackup, streamWorkroomBackup } from '../features/workroom/backup';
import { writeV2Backup, assembleV2Backup, type ZipFileWriter, type ZipFileReader } from './backupFormat';
import { ChatPrompts } from './chatPrompts';
import { formatMessageForPrompt, formatMessageWithTime, isMessageSemanticallyRelevant } from './messageFormat';
import { extractMemoriesFromBuffer } from './memoryPalace/extraction';

beforeEach(async () => {
    const db = await openDB();
    const tx = db.transaction(['characters', 'messages', ...WORKROOM_STORES], 'readwrite');
    const done = transactionDone(tx);
    for (const name of ['characters', 'messages', ...WORKROOM_STORES]) tx.objectStore(name).clear();
    tx.objectStore('characters').put({ id: 'a', name: '阿源', workroomLinkEnabled: true });
    tx.objectStore('characters').put({ id: 'b', name: 'Claude' });
    await done;
    localStorage.removeItem('mp_lastMsgId_a');
});
const code = { html: '<p>小狗</p>', css: '', js: '// PRIVATE_CODE_ONLY' };
async function build() {
    const work = await W.create('a', '小狗饲养屋', '喂食和散步');
    const user = await W.appendTurn('a', work.id, 'user', '想让小狗吃饱后会摇尾巴。');
    const reply = await W.commitReply('a', work.id, { userTurnId: user.id, expectedVersionId: null, expectedDraftRevision: 0,
        text: '我把摇尾巴加进草稿了。', code });
    const version = await W.publish('a', work.id, 1);
    await W.recordEvent('a', work.id, version.id, 'feed-once', '给小狗喂食，小狗升到三级。');
    return { work, version, user, reply };
}

describe('造物间事件真实聊天投递', () => {
    it('并发和重复补投只有一份聊天记录；交流、卡片进入共享文本入口', async () => {
        await build();
        await Promise.all([drainWorkroomOutbox('a'), drainWorkroomOutbox('a')]);
        await drainWorkroomOutbox('a');
        const rows = await DB.getMessagesByCharId('a', true);
        expect(rows).toHaveLength(4);
        expect(rows.filter(m => m.type === 'workroom_card')).toHaveLength(2);
        expect(rows.every(isMessageSemanticallyRelevant)).toBe(true);
        const text = rows.map(m => formatMessageForPrompt(m, '阿源', 'User')).join('\n');
        const history = ChatPrompts.buildMessageHistory(rows, 20, { id: 'a', name: '阿源', workroomLinkEnabled: false } as any, { name: 'User' } as any, []);
        for (const phrase of ['会摇尾巴', '加进草稿', '作品完成', '小狗升到三级']) {
            expect(text).toContain(phrase);
            expect(JSON.stringify(history.apiMessages)).toContain(phrase);
            expect(rows.map(m => formatMessageWithTime(m, '阿源', 'User', () => '时间')).join('\n')).toContain(phrase);
        }
        expect(text).not.toContain('PRIVATE_CODE_ONLY');
        expect(await DB.getMessagesByCharId('b', true)).toEqual([]);
    });
    it('联动关闭后不补发尚未投递的互动，已保存卡片不被删除', async () => {
        const { work, version } = await build();
        await drainWorkroomOutbox('a');
        const char = await DB.getCharacter('a');
        await DB.saveCharacter({ ...char!, workroomLinkEnabled: false });
        await W.recordEvent('a', work.id, version.id, 'walk', '又散步一次');
        await drainWorkroomOutbox('a');
        const rows = await DB.getMessagesByCharId('a', true);
        expect(rows).toHaveLength(4);
        expect(rows.map(m => m.content).join('\n')).not.toContain('又散步一次');
        expect(rows.map(m => m.content).join('\n')).toContain('小狗升到三级');
    });
    it('错误角色不能投递；用户删除已投递卡片后不自动复活', async () => {
        await build();
        const event = (await exportWorkroomBackup(await openDB())).workroomEvents[0];
        expect(await DB.deliverWorkroomPending('b', 'workroom_events', event.id)).toBeNull();
        await drainWorkroomOutbox('a');
        const db = await openDB(), tx = db.transaction('messages', 'readwrite'), done = transactionDone(tx);
        tx.objectStore('messages').clear(); await done;
        await drainWorkroomOutbox('a');
        expect(await DB.getMessagesByCharId('a', true)).toEqual([]);
    });
    it('真实 ZIP 恢复后创作交流、聊天卡片和可读文本完整，不重复投递', async () => {
        await build(); await drainWorkroomOutbox('a');
        const original = await DB.getMessagesByCharId('a', true);
        const turns = (await exportWorkroomBackup(await openDB())).workroomTurns;
        const zip = new JSZip();
        const stores = await streamWorkroomBackup(await openDB(), zip as unknown as ZipFileWriter);
        await writeV2Backup(zip as unknown as ZipFileWriter, { messages: original, version: 3 }, { prewrittenStores: stores });
        const unpacked = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
        const data = await assembleV2Backup(unpacked as unknown as ZipFileReader, JSON.parse(await unpacked.file('manifest.json')!.async('string')));
        await DB.importFullData(data as any);
        await drainWorkroomOutbox('a');
        expect(await DB.getMessagesByCharId('a', true)).toEqual(original);
        expect((await exportWorkroomBackup(await openDB())).workroomTurns).toEqual(turns);
    });
    it('五种卡片协议经真实持久化、ZIP 与恢复后都保留可读材料', async () => {
        const { work } = await build();
        const db = await openDB(), tx = db.transaction('workroom_events', 'readwrite'), done = transactionDone(tx);
        for (const kind of ['inspiration', 'shared', 'accepted'] as const) {
            const id = `fixture-${kind}`;
            tx.objectStore('workroom_events').add({ id, charId: 'a', workId: work.id, delivery: 'pending', event: {
                version: 1, eventId: id, charId: 'a', charName: '阿源', kind, subjectId: work.id,
                title: work.title, summary: work.summary, detail: `协议测试事件：${kind}`, timestamp: Date.now(),
                ...(kind === 'inspiration' ? {} : { sourceAuthorName: 'Claude', shareId: 'fixture-share' }),
            } });
        }
        await done; await drainWorkroomOutbox('a');
        const before = await DB.getMessagesByCharId('a', true);
        expect(before.filter(m => m.type === 'workroom_card')).toHaveLength(5);
        const zip = new JSZip();
        await writeV2Backup(zip as unknown as ZipFileWriter, { ...await exportWorkroomBackup(await openDB()), messages: before });
        const reader = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
        await DB.importFullData(await assembleV2Backup(reader as unknown as ZipFileReader, JSON.parse(await reader.file('manifest.json')!.async('string'))) as any);
        await drainWorkroomOutbox('a');
        const after = await DB.getMessagesByCharId('a', true);
        expect(after).toEqual(before);
        const material = after.map(m => formatMessageForPrompt(m, '阿源', 'User')).join('\n');
        for (const label of ['灵感邀请', '作品完成', '互动进度', '作品分享', '作品收藏']) expect(material).toContain(label);
    });
    it('兼容 v75 无创作交流表的旧造物间备份，畸形交流归属在写库前拒绝', async () => {
        await build();
        const backup = await exportWorkroomBackup(await openDB());
        const invalid = structuredClone(backup); invalid.workroomTurns[0].charId = 'b';
        await expect(DB.importFullData(invalid as any)).rejects.toThrow('跨角色');
        expect((await exportWorkroomBackup(await openDB())).workroomTurns).toHaveLength(2);
        const legacy = { ...backup, workroomTurns: undefined };
        await DB.importFullData(legacy as any);
        expect((await exportWorkroomBackup(await openDB())).workroomWorks).toEqual(backup.workroomWorks);
        expect((await exportWorkroomBackup(await openDB())).workroomTurns).toEqual([]);
    });
    it('卡片真实进入记忆提取 API 的输入，仍允许提取器判断无须长期记忆', async () => {
        await build(); await drainWorkroomOutbox('a');
        const rows = await DB.getMessagesByCharId('a', true);
        const calls: any[] = [];
        vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
            calls.push(JSON.parse(options.body));
            return new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200 });
        }));
        try {
            const result = await extractMemoriesFromBuffer(rows, 'a', '阿源', { baseUrl: 'https://model.invalid/v1', apiKey: 'test', model: 'test' }, undefined, 'User');
            expect(result.memories).toEqual([]);
            const text = JSON.stringify(calls);
            for (const phrase of ['会摇尾巴', '加进草稿', '作品完成', '小狗升到三级']) expect(text).toContain(phrase);
            expect(text).not.toContain('PRIVATE_CODE_ONLY');
        } finally { vi.unstubAllGlobals(); }
    });
});
