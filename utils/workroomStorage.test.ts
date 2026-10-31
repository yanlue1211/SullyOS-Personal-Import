import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { forceCloseDatabase } from 'fake-indexeddb';
import { DB, openDB } from './db';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { WORKROOM_STORES, transactionDone } from '../features/workroom/schema';
import { exportWorkroomBackup, restoreWorkroomBackup, streamWorkroomBackup, validateWorkroomBackup } from '../features/workroom/backup';
import { assembleV2Backup, writeV2Backup, type ZipFileWriter, type ZipFileReader } from './backupFormat';

const code = { html: '<button id="dog">小狗</button><img src="data:image/png;base64,AAAA">', css: 'body{color:blue}', js: 'window.workroom.loadState()' };
async function make(charId = 'a') {
    const work = await W.create(charId, '小狗饲养屋', '喂食、散步');
    const draft = await W.saveDraft(charId, work.id, code, 0, null);
    const version = await W.publish(charId, work.id, draft.revision);
    return { work, version };
}
beforeEach(async () => {
    const db = await openDB();
    const tx = db.transaction([...WORKROOM_STORES, 'characters'], 'readwrite');
    const done = transactionDone(tx);
    for (const store of [...WORKROOM_STORES, 'characters']) tx.objectStore(store).clear();
    tx.objectStore('characters').put({ id: 'a', name: '阿源' });
    tx.objectStore('characters').put({ id: 'b', name: 'Claude' });
    await done;
});

describe('造物间持久化、版本和角色隔离', () => {
    it('经新的 DB 读取路径恢复作品和进度，不依赖 React 内存', async () => {
        const { work, version } = await make();
        const initial = await W.loadState('a', work.id, version.id);
        await W.saveState('a', work.id, version.id, initial.revision, { level: 3, dog: '糯米' });
        forceCloseDatabase(await openDB());
        await new Promise(resolve => setTimeout(resolve, 0));
        const loaded = await W.get('a', work.id);
        expect(loaded.versions[0].html).toBe(code.html);
        expect((await W.loadState('a', work.id, version.id)).data).toEqual({ level: 3, dog: '糯米' });
        expect(await W.list('b')).toEqual([]);
        await expect(W.get('b', work.id)).rejects.toThrow('不属于');
        await expect(W.saveState('b', work.id, version.id, 2, {})).rejects.toThrow('不属于');
    });
    it('拒绝草稿覆盖和并发进度覆盖，发布失败不丢旧版本', async () => {
        const { work, version } = await make();
        await W.saveDraft('a', work.id, code, 0, version.id);
        await expect(W.saveDraft('a', work.id, code, 0, version.id)).rejects.toThrow('其他窗口');
        await W.saveState('a', work.id, version.id, 1, { level: 2 });
        await expect(W.saveState('a', work.id, version.id, 1, { level: 0 })).rejects.toThrow('其他窗口');
        await expect(W.publish('a', work.id, 1, 2)).rejects.toThrow('迁移');
        expect((await W.get('a', work.id)).work.currentVersionId).toBe(version.id);
        expect((await W.get('a', work.id)).versions).toHaveLength(1);
    });
    it('兼容更新沿用进度，格式变化保留旧进度，回退后旧进度可继续', async () => {
        const { work, version } = await make();
        await W.saveState('a', work.id, version.id, 1, { level: 3 });
        await W.saveDraft('a', work.id, code, 0, version.id);
        const v2 = await W.publish('a', work.id, 1);
        expect((await W.loadState('a', work.id, v2.id)).data).toEqual({ level: 3 });
        await W.saveDraft('a', work.id, code, 0, v2.id);
        const v3 = await W.publish('a', work.id, 1, 2, { points: 30 });
        await expect(W.saveState('a', work.id, v2.id, 2, {})).rejects.toThrow('版本已变化');
        await W.rollback('a', work.id, version.id, v3.id);
        expect((await W.loadState('a', work.id, version.id)).data).toEqual({ level: 3 });
        await expect(W.rollback('a', work.id, v2.id, v3.id)).rejects.toThrow('版本已变化');
    });
    it('相同事件重试不重复记录，删除作品不影响其他角色', async () => {
        const { work, version } = await make();
        const other = await make('b');
        const a = await W.recordEvent('a', work.id, version.id, 'feed-1', '喂食一次');
        const b = await W.recordEvent('a', work.id, version.id, 'feed-1', '重复回传');
        expect(a).toEqual(b);
        await W.delete('a', work.id);
        expect(await W.list('a')).toEqual([]);
        expect((await W.get('b', other.work.id)).versions).toHaveLength(1);
    });
    it('删除角色在同一事务清理其作品、进度和版本', async () => {
        await make();
        await make('b');
        await DB.deleteCharacter('a');
        const backup = await exportWorkroomBackup(await openDB());
        expect(backup.workroomWorks.map(w => w.charId)).toEqual(['b']);
        for (const rows of Object.values(backup)) expect(rows.every((row: {charId: string}) => row.charId === 'b')).toBe(true);
    });
    it('拒绝非 JSON、超限、不可迁移状态及临时代码资源', async () => {
        const { work, version } = await make();
        for (const bad of [NaN, undefined, new Date(), { file: 'blobref:private' }, { huge: 'a'.repeat(256001) }]) {
            await expect(Promise.resolve().then(() => W.saveState('a', work.id, version.id, 1, bad))).rejects.toThrow();
        }
        await expect(Promise.resolve().then(() => W.saveDraft('a', work.id, { ...code, html: '<img src="blob:temporary">' }, 0, version.id))).rejects.toThrow('临时资源');
    });
});

describe('造物间完整备份往返', () => {
    it('真实 v2 分片打包、解包、DB.importFullData 后作品、代码、草稿、进度和事件完整', async () => {
        const { work, version } = await make();
        await W.saveState('a', work.id, version.id, 1, { level: 7 });
        await W.saveDraft('a', work.id, { ...code, js: '// 下次增加散步' }, 0, version.id);
        await W.recordEvent('a', work.id, version.id, 'walk-1', '带小狗散步');
        const zip = new JSZip();
        const stores = await streamWorkroomBackup(await openDB(), zip as unknown as ZipFileWriter);
        await writeV2Backup(zip as unknown as ZipFileWriter, { version: 3, timestamp: Date.now() }, { mode: 'full', createdAt: Date.now(), assetCount: 0, prewrittenStores: stores });
        const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
        const restored = await assembleV2Backup(loaded as unknown as ZipFileReader, JSON.parse(await loaded.file('manifest.json')!.async('string')));
        const before = await exportWorkroomBackup(await openDB());
        await W.delete('a', work.id);
        await DB.importFullData(restored as any);
        expect(await exportWorkroomBackup(await openDB())).toEqual(before);
        expect((await W.loadState('a', work.id, version.id)).data).toEqual({ level: 7 });
        expect((await W.get('a', work.id)).versions[0].html).toBe(code.html);
    });
    it('旧备份缺少模块时保留现有作品；媒体补丁不替换作品', async () => {
        const { work } = await make();
        await DB.importFullData({ version: 3, timestamp: Date.now() });
        await DB.importFullData({ version: 3, timestamp: Date.now(), collaborationBackupMode: 'media_only', workroomWorks: [] } as any);
        expect((await W.get('a', work.id)).work.id).toBe(work.id);
    });
    it('部分表、孤立版本、跨角色归属与丢失状态在写库前被拒绝', async () => {
        const { work } = await make();
        const original = await exportWorkroomBackup(await openDB());
        expect(() => validateWorkroomBackup({ workroomWorks: [] })).toThrow('缺少');
        await expect(DB.importFullData({ ...original, characters: [] } as any)).rejects.toThrow('角色不存在');
        for (const change of [
            (b: typeof original) => { b.workroomWorks[0].currentVersionId = 'missing'; },
            (b: typeof original) => { b.workroomVersions[0].charId = 'b'; },
            (b: typeof original) => { b.workroomStates = []; },
        ]) {
            const corrupt = structuredClone(original); change(corrupt);
            await expect(DB.importFullData({ ...corrupt, characters: [{ id: 'replacement' }] } as any)).rejects.toThrow();
            expect((await W.get('a', work.id)).work.id).toBe(work.id);
            expect((await DB.getAllCharacters()).map(c => c.id).sort()).toEqual(['a', 'b']);
        }
    });
    it('恢复写入遇到同步克隆异常时整笔回滚，不留下已清空的作品库', async () => {
        await make();
        const before = await exportWorkroomBackup(await openDB());
        const bad = structuredClone(before);
        (bad.workroomStates[0] as any).uncloneable = () => {};
        await expect(restoreWorkroomBackup(await openDB(), bad)).rejects.toThrow();
        expect(await exportWorkroomBackup(await openDB())).toEqual(before);
    });
    it('流式多表导出保持同一读取快照，并发保存不会混入半新半旧进度', async () => {
        const { work, version } = await make();
        const zip = new JSZip();
        const snapshot = streamWorkroomBackup(await openDB(), zip as unknown as ZipFileWriter);
        const update = W.saveState('a', work.id, version.id, 1, { level: 10 });
        const stores = await snapshot;
        await update;
        await writeV2Backup(zip as unknown as ZipFileWriter, {}, { prewrittenStores: stores });
        const restored = await assembleV2Backup(zip as unknown as ZipFileReader, JSON.parse(await zip.file('manifest.json')!.async('string')));
        expect(restored.workroomStates[0].data).toEqual({});
        expect((await W.loadState('a', work.id, version.id)).data).toEqual({ level: 10 });
    });
    it('旧版 DB.exportFullData 同样包含全部造物间表', async () => {
        const { work } = await make();
        const full = await DB.exportFullData();
        expect(full.workroomWorks?.[0].id).toBe(work.id);
        expect(full.workroomVersions).toHaveLength(1);
        expect(full.workroomStates).toHaveLength(1);
        expect(full.workroomEvents).toHaveLength(1);
    });
});
