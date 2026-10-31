import { createV2ArrayFieldWriter, type ZipFileWriter, type BackupManifest } from '../../utils/backupFormat';
import { readWorkroomEvent } from '../../utils/workroomEvent';
import {
    WORKROOM_FIELDS, WORKROOM_STORES, assertCode, cloneWorkroomState, idbResult, stateId,
    transactionDone, validInteger, validText, type WorkroomBackup,
} from './schema';

/** Validate the entire graph before any part of a device restore writes to IndexedDB. */
export function validateWorkroomBackup(input: Partial<WorkroomBackup>): WorkroomBackup | undefined {
    const fields = Object.values(WORKROOM_FIELDS);
    if (!fields.some(field => input[field] !== undefined)) return;
    // v75 backups predate creative discussion; absence means an empty turn table.
    if (input.workroomShares === undefined) input = {...input, workroomShares: []};
    if (input.workroomTurns === undefined) input = { ...input, workroomTurns: [] };
    if (fields.some(field => !Array.isArray(input[field]))) throw Error('造物间备份缺少数据表');
    const data = input as WorkroomBackup;
    for (const field of fields) {
        const ids = new Set<string>();
        for (const row of data[field]) {
            if ('notice' in row && row.notice !== undefined && (field !== 'workroomEvents' || !['pending','dismissed'].includes(row.notice as string) || !('event' in row) || row.event.kind !== 'completed')) throw Error('作品通知状态无效');
            if (!row || !validText(row.id, 1000) || ids.has(row.id) || !validText(row.charId, 200)) throw Error('造物间备份主键或角色归属无效');
            ids.add(row.id);
        }
    }
    const works = new Map(data.workroomWorks.map(w => [w.id, w]));
    const versions = new Map(data.workroomVersions.map(v => [v.id, v]));
    const numbers = new Set<string>();
    for (const work of works.values()) {
        if(work.lastError!==undefined&&!validText(work.lastError,2000))throw Error('运行错误记录无效');
        if(work.maintenanceRequests!==undefined&&(!Array.isArray(work.maintenanceRequests)||work.maintenanceRequests.length>20||work.maintenanceRequests.some(t=>!validText(t,2000))))throw Error('维护任务无效');
        const report=work.testReport;
        if(report&&(!validInteger(report.draftRevision)||!Number.isFinite(report.createdAt)||report.createdAt<=0||!Array.isArray(report.errors)||report.errors.length>20||report.errors.some(e=>!validText(e,2000))||typeof report.notes!=='string'||report.notes.length>2000))throw Error('测试记录无效');
        if (work.idea && (!['open','shelved','done'].includes(work.idea.status) || !validText(work.idea.invitationId,200))) throw Error('灵感状态无效');
        if (work.source && ['authorId','authorName','workId','versionId','shareId'].some(key => !validText((work.source as unknown as Record<string,unknown>)[key],200))) throw Error('作品来源无效');
        if (!validText(work.title, 300) || !validText(work.summary, 2000) || !Number.isFinite(work.createdAt) || work.createdAt <= 0
            || !Number.isFinite(work.updatedAt) || work.updatedAt <= 0 || (work.currentVersionId !== null && !validText(work.currentVersionId, 200))) throw Error('造物间作品信息无效');
        if (work.currentVersionId) {
            const version = versions.get(work.currentVersionId);
            if (!version || version.workId !== work.id || version.charId !== work.charId) throw Error('造物间正式版本引用无效');
        }
    }
    for (const field of fields.filter(field => field !== 'workroomWorks' && field !== 'workroomShares')) {
        for (const row of data[field]) {
            if (field === 'workroomEvents' && 'event' in row && row.event.kind === 'shared') continue;
            const work = works.get(row.workId);
            if (!work || row.charId !== work.charId) throw Error('造物间备份包含孤立记录或跨角色引用');
        }
    }
    for (const version of versions.values()) {
        assertCode(version);
        const key = JSON.stringify([version.workId, version.number]);
        if (!validInteger(version.number) || !validInteger(version.schemaVersion) || numbers.has(key)
            || !Number.isFinite(version.createdAt) || version.createdAt <= 0) throw Error('造物间版本信息无效');
        numbers.add(key);
    }
    for (const state of data.workroomStates) {
        if (!validInteger(state.revision) || !validInteger(state.schemaVersion) || state.id !== stateId(state.workId, state.schemaVersion)) throw Error('造物间进度格式无效');
        cloneWorkroomState(state.data);
    }
    const states = new Set(data.workroomStates.map(s => s.id));
    for (const version of versions.values()) {
        if (!states.has(stateId(version.workId, version.schemaVersion))) throw Error('造物间版本缺少对应进度');
    }
    for (const draft of data.workroomDrafts) {
        assertCode(draft);
        const base = draft.baseVersionId === null ? undefined : versions.get(draft.baseVersionId);
        if (draft.id !== draft.workId || !validInteger(draft.revision)
            || (draft.baseVersionId !== null && (!base || base.workId !== draft.workId || base.charId !== draft.charId))) throw Error('造物间草稿引用无效');
    }
    for (const share of data.workroomShares) {
        assertCode(share.snapshot);
        const v = share.snapshot;
        if (!validText(v.title,300) || !validText(v.summary,2000) || ![v.authorId,v.authorName,v.workId,v.versionId].every(s => validText(s,200)) || !validInteger(v.schemaVersion) || !Number.isFinite(share.createdAt) || share.createdAt <= 0 || (share.acceptedWorkId!==undefined && (!validText(share.acceptedWorkId,200) || (works.has(share.acceptedWorkId) && works.get(share.acceptedWorkId)!.charId!==share.charId)))) throw Error('分享快照无效');
    }
    for (const row of data.workroomEvents) {
        const event = readWorkroomEvent(row.event, row.charId);
        if (!event || (event.kind === 'shared' ? !data.workroomShares.some(s => s.id === event.shareId && s.charId === row.charId) : event.subjectId !== row.workId) || !['local', 'pending', 'delivered'].includes(row.delivery)) throw Error('造物间事件无效');
    }
    for (const turn of data.workroomTurns) {
        if (!['user', 'assistant'].includes(turn.role) || !validText(turn.text, 12000) || !validText(turn.workTitle, 300)
            || !Number.isFinite(turn.createdAt) || turn.createdAt <= 0 || !['pending', 'delivered'].includes(turn.delivery)) throw Error('造物间创作交流无效');
    }
    return data;
}

export async function exportWorkroomBackup(db: IDBDatabase): Promise<WorkroomBackup> {
    const tx = db.transaction(WORKROOM_STORES, 'readonly');
    const done = transactionDone(tx);
    const results = await Promise.all(WORKROOM_STORES.map(name => idbResult(tx.objectStore(name).getAll())));
    await done;
    return Object.fromEntries(WORKROOM_STORES.map((name, i) => [WORKROOM_FIELDS[name], results[i]])) as unknown as WorkroomBackup;
}

/** Stream all workroom tables from ONE snapshot; code strings are never image-stripped. */
export async function streamWorkroomBackup(db: IDBDatabase, zip: ZipFileWriter,
    onSerialized?: (json: string) => void, onOwner?: (charId: string) => void): Promise<BackupManifest['stores']> {
    const tx = db.transaction(WORKROOM_STORES, 'readonly');
    const done = transactionDone(tx);
    const writers = WORKROOM_STORES.map(name => createV2ArrayFieldWriter(zip, WORKROOM_FIELDS[name], {
        limits: { maxLen: 4 * 1024 * 1024, maxItems: 100, hardMaxLen: 256 * 1024 * 1024 }, onSerialized,
    }));
    let error: unknown;
    WORKROOM_STORES.forEach((name, i) => {
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            try {
                if (name === 'workroom_works' || name === 'workroom_shares') onOwner?.(cursor.value.charId);
                writers[i].appendSync([cursor.value]); cursor.continue();
            }
            catch (e) { error = e; tx.abort(); }
        };
    });
    try { await done; } catch (e) { throw error || e; }
    const manifests = await Promise.all(writers.map(writer => writer.finish()));
    return Object.fromEntries(WORKROOM_STORES.map((name, i) => [WORKROOM_FIELDS[name], manifests[i]]));
}

export async function restoreWorkroomBackup(db: IDBDatabase, data: WorkroomBackup): Promise<void> {
    validateWorkroomBackup(data);
    const tx = db.transaction(WORKROOM_STORES, 'readwrite');
    const done = transactionDone(tx);
    void done.catch(() => {});
    try {
        for (const name of WORKROOM_STORES) {
            const store = tx.objectStore(name);
            store.clear();
            for (const row of data[WORKROOM_FIELDS[name]]) store.put(row);
        }
        await done;
    } catch (error) {
        try { tx.abort(); } catch { /* already aborted */ }
        await done.catch(() => {});
        throw error;
    }
}
