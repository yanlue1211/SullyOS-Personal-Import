import { openDB } from '../../utils/db';
import { readWorkroomEvent } from '../../utils/workroomEvent';
import {
    WORKROOM_STORES, assertCode, cloneWorkroomState, idbResult, transactionDone,
    stateId, validInteger, validText, workroomId,
    type WorkroomCode, type WorkroomDraft, type WorkroomState, type WorkroomStoredEvent,
    type WorkroomVersion, type WorkroomWork, type WorkroomTurn,
} from './schema';

export async function transact<T>(charId: string, mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await openDB();
    const tx = db.transaction(['characters', ...WORKROOM_STORES], mode);
    const done = transactionDone(tx);
    // Attach rejection handling immediately; callers still receive the original failure.
    void done.catch(() => {});
    try {
        if (!validText(charId, 200) || !await idbResult(tx.objectStore('characters').get(charId))) throw Error('角色已不存在');
        const result = await action(tx);
        await done;
        return result;
    } catch (error) {
        try { tx.abort(); } catch { /* already finished */ }
        await done.catch(() => {});
        throw error;
    }
}
export async function owned(tx: IDBTransaction, charId: string, workId: string): Promise<WorkroomWork> {
    const work = await idbResult<WorkroomWork | undefined>(tx.objectStore('workroom_works').get(workId));
    if (!work || work.charId !== charId) throw Error('作品不存在或不属于当前角色');
    return work;
}
async function versionFor(tx: IDBTransaction, work: WorkroomWork, versionId: string): Promise<WorkroomVersion> {
    const version = await idbResult<WorkroomVersion | undefined>(tx.objectStore('workroom_versions').get(versionId));
    if (!version || version.workId !== work.id || version.charId !== work.charId) throw Error('作品版本不存在');
    return version;
}
async function lastTurn(tx: IDBTransaction, workId: string): Promise<WorkroomTurn | undefined> {
 return new Promise((resolve,reject)=>{const request=tx.objectStore('workroom_turns').index('workId_createdAt').openCursor(IDBKeyRange.bound([workId,0],[workId,Number.MAX_SAFE_INTEGER]),'prev');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const cursor=request.result;if(!cursor)return resolve(undefined);if(cursor.value.kind==='play'){cursor.continue();return;}resolve(cursor.value);};});
}
const codeOnly = (code: WorkroomCode): WorkroomCode => ({ html: code.html, css: code.css, js: code.js });

export const WorkroomStorage = {
    create: async (charId: string, title: string, summary: string): Promise<WorkroomWork> => {
        if (!validText(title, 300) || !validText(summary, 2000)) throw Error('请填写作品名称和一句话简介');
        return transact(charId, 'readwrite', async tx => {
            const now = Date.now();
            const work: WorkroomWork = { id: workroomId(), charId, title, summary, createdAt: now, updatedAt: now, currentVersionId: null };
            await idbResult(tx.objectStore('workroom_works').add(work));
            return work;
        });
    },
    list: (charId: string): Promise<WorkroomWork[]> => transact(charId, 'readonly', tx =>
        idbResult(tx.objectStore('workroom_works').index('charId').getAll(charId))),
    getWork: (charId:string,workId:string) => transact(charId,'readonly',tx=>owned(tx,charId,workId)),
    draftIds: (charId:string):Promise<IDBValidKey[]> => transact(charId,'readonly',tx=>idbResult(tx.objectStore('workroom_drafts').index('charId').getAllKeys(charId))),
    get: (charId: string, workId: string) => transact(charId, 'readonly', async tx => {
        const work = await owned(tx, charId, workId);
        const versions = await idbResult<WorkroomVersion[]>(tx.objectStore('workroom_versions').index('workId').getAll(workId));
        const draft = await idbResult<WorkroomDraft | undefined>(tx.objectStore('workroom_drafts').get(workId));
        return { work, versions: versions.sort((a, b) => b.number - a.number), draft };
    }),
    saveDraft: (charId: string, workId: string, code: WorkroomCode, expectedRevision: number, baseVersionId: string | null) => {
        assertCode(code);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('草稿版本无效');
        return transact(charId, 'readwrite', async tx => {
            const work = await owned(tx, charId, workId);
            if (work.currentVersionId !== baseVersionId) throw Error('正式版本已变化，请重新读取作品');
            const current = await idbResult<WorkroomDraft | undefined>(tx.objectStore('workroom_drafts').get(workId));
            if ((current?.revision || 0) !== expectedRevision) throw Error('草稿已被其他窗口修改');
            const draft: WorkroomDraft = { id: workId, workId, charId, baseVersionId, revision: expectedRevision + 1, ...codeOnly(code) };
            await idbResult(tx.objectStore('workroom_drafts').put(draft));
            return draft;
        });
    },
    /** Publishing is an explicit host action; saving a draft never changes playable code. */
    publish: (charId: string, workId: string, draftRevision: number, schemaVersion = 1, initialState?: unknown) => {
        if (!validInteger(schemaVersion)) throw Error('状态版本无效');
        const initial = initialState === undefined ? undefined : cloneWorkroomState(initialState);
        return transact(charId, 'readwrite', async tx => {
            const work = await owned(tx, charId, workId);
            const draft = await idbResult<WorkroomDraft | undefined>(tx.objectStore('workroom_drafts').get(workId));
            if (!draft || draft.revision !== draftRevision || draft.baseVersionId !== work.currentVersionId) throw Error('草稿或正式版本已变化，请重新读取');
            assertCode(draft);
            const previous = work.currentVersionId ? await versionFor(tx, work, work.currentVersionId) : undefined;
            const existing = await idbResult<WorkroomState | undefined>(tx.objectStore('workroom_states').get(stateId(workId, schemaVersion)));
            if (previous && previous.schemaVersion !== schemaVersion && !existing && initial === undefined) throw Error('新版本需要迁移进度或明确提供新初始状态，旧进度已保留');
            const versions = await idbResult<WorkroomVersion[]>(tx.objectStore('workroom_versions').index('workId').getAll(workId));
            const now = Date.now();
            const version: WorkroomVersion = { id: workroomId(), workId, charId, number: versions.reduce((max, v) => Math.max(max, v.number), 0) + 1,
                schemaVersion, createdAt: now, ...codeOnly(draft) };
            await idbResult(tx.objectStore('workroom_versions').add(version));
            if (!existing) await idbResult(tx.objectStore('workroom_states').add({
                id: stateId(workId, schemaVersion), charId, workId, schemaVersion, revision: 1, data: initial === undefined ? {} : initial,
            } satisfies WorkroomState));
            await idbResult(tx.objectStore('workroom_works').put({ ...work, ...(work.idea ? {idea: {...work.idea, status: 'done'}} : {}), currentVersionId: version.id, updatedAt: now }));
            await idbResult(tx.objectStore('workroom_drafts').delete(workId));
            const char = await idbResult(tx.objectStore('characters').get(charId));
            const id = workroomId();
            await idbResult(tx.objectStore('workroom_events').add({ id, charId, workId, delivery: 'pending', notice: 'pending', event: {
                version: 1, eventId: id, charId, charName: char.name || '角色', kind: 'completed', subjectId: workId,
                title: work.title, summary: work.summary, detail: `发布了第 ${version.number} 版作品。`, timestamp: now,
            } } satisfies WorkroomStoredEvent));
            return version;
        });
    },
    recordDiagnostic: (charId:string,workId:string,versionId:string,kind:'error'|'update',text:string) => {
        if(!validText(text,2000))throw Error('维护记录无效');
        return transact(charId,'readwrite',async tx=>{
            const work=await owned(tx,charId,workId);if(work.currentVersionId!==versionId)throw Error('运行版本已变化');
            await idbResult(tx.objectStore('workroom_works').put(kind==='error'?{...work,lastError:text}:{...work,maintenanceRequests:[...(work.maintenanceRequests||[]),text].slice(-20)}));
        });
    },
    saveTestReport: (charId:string,workId:string,draftRevision:number,errors:string[],notes:string) => {
        if(!validInteger(draftRevision)||!Array.isArray(errors)||errors.length>20||errors.some(e=>!validText(e,2000))||typeof notes!=='string'||notes.length>2000)throw Error('测试记录无效');
        return transact(charId,'readwrite',async tx=>{
            const work=await owned(tx,charId,workId),draft=await idbResult<WorkroomDraft|undefined>(tx.objectStore('workroom_drafts').get(workId));
            if(!draft||draft.revision!==draftRevision)throw Error('草稿已变化，请重新测试');
            await idbResult(tx.objectStore('workroom_works').put({...work,testReport:{draftRevision,createdAt:Date.now(),errors:[...errors],notes}}));
        });
    },
    loadState: (charId: string, workId: string, versionId: string) => transact(charId, 'readonly', async tx => {
        const work = await owned(tx, charId, workId);
        if (work.currentVersionId !== versionId) throw Error('运行版本已变化，请重新打开作品');
        const version = await versionFor(tx, work, versionId);
        const state = await idbResult<WorkroomState | undefined>(tx.objectStore('workroom_states').get(stateId(workId, version.schemaVersion)));
        if (!state) throw Error('游戏进度缺失');
        return state;
    }),
    saveState: (charId: string, workId: string, versionId: string, expectedRevision: number, value: unknown) => {
        const data = cloneWorkroomState(value);
        return transact(charId, 'readwrite', async tx => {
            const work = await owned(tx, charId, workId);
            if (work.currentVersionId !== versionId) throw Error('运行版本已变化，请重新打开作品');
            const version = await versionFor(tx, work, versionId);
            const id = stateId(workId, version.schemaVersion);
            const previous = await idbResult<WorkroomState | undefined>(tx.objectStore('workroom_states').get(id));
            if (!previous || previous.revision !== expectedRevision) throw Error('进度已被其他窗口更新，请重新加载');
            const state: WorkroomState = { ...previous, data, revision: previous.revision + 1 };
            await idbResult(tx.objectStore('workroom_states').put(state));
            return state;
        });
    },
    rollback: (charId: string, workId: string, versionId: string, expectedVersionId: string) => transact(charId, 'readwrite', async tx => {
        const work = await owned(tx, charId, workId);
        if (work.currentVersionId !== expectedVersionId) throw Error('正式版本已变化');
        const target = await versionFor(tx, work, versionId);
        if (!await idbResult(tx.objectStore('workroom_states').get(stateId(workId, target.schemaVersion)))) throw Error('旧版本进度缺失，不能安全回退');
        await idbResult(tx.objectStore('workroom_works').put({ ...work, currentVersionId: versionId, updatedAt: Date.now() }));
    }),
    recordEvent: (charId: string, workId: string, versionId: string, actionId: string, detail: string) => {
        if (!validText(actionId, 100) || !validText(detail, 8000)) throw Error('互动事件无效');
        return transact(charId, 'readwrite', async tx => {
            const work = await owned(tx, charId, workId);
            if (work.currentVersionId !== versionId) throw Error('运行版本已变化');
            const id = JSON.stringify([workId, versionId, actionId]);
            const store = tx.objectStore('workroom_events');
            const previous = await idbResult<WorkroomStoredEvent | undefined>(store.get(id));
            if (previous) return previous;
            if (await idbResult(store.index('workId').count(workId)) >= 10000) throw Error('该作品互动记录已达容量上限，请先导出整理');
            const char = await idbResult(tx.objectStore('characters').get(charId));
            const event = readWorkroomEvent({ version: 1, eventId: workroomId(), charId, charName: char.name || '角色',
                kind: 'progress', subjectId: workId, title: work.title, summary: work.summary,
                detail: detail, timestamp: Date.now() }, charId)!;
            const row: WorkroomStoredEvent = { id, charId, workId, event, delivery: 'pending' };
            await idbResult(store.add(row));
            return row;
        });
    },
    turns: (charId: string, workId: string): Promise<WorkroomTurn[]> => transact(charId, 'readonly', async tx => {
        await owned(tx, charId, workId);
        const rows = await idbResult<WorkroomTurn[]>(tx.objectStore('workroom_turns').index('workId').getAll(workId));
        return rows.filter(row=>row.kind!=='play').sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }),
    setRuntimeAi: (charId:string,workId:string,enabled:boolean) => transact(charId,'readwrite',async tx=>{const work=await owned(tx,charId,workId);await idbResult(tx.objectStore('workroom_works').put({...work,runtimeAiEnabled:enabled===true}));}),
    playTurns: (charId:string,workId:string):Promise<WorkroomTurn[]>=>transact(charId,'readonly',async tx=>{await owned(tx,charId,workId);const rows=await idbResult<WorkroomTurn[]>(tx.objectStore('workroom_turns').index('workId').getAll(workId));return rows.filter(row=>row.kind==='play').sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));}),
    appendPlayTurn: (charId:string,workId:string,versionId:string,role:'user'|'assistant',text:string,id:string,deliver=false) => {
        if(!validText(text,8000)||!validText(id,200)||!['user','assistant'].includes(role))throw Error('互动内容无效');
        return transact(charId,'readwrite',async tx=>{const work=await owned(tx,charId,workId);if(work.currentVersionId!==versionId||!work.runtimeAiEnabled)throw Error('作品或运行时AI设置已变化');
            const store=tx.objectStore('workroom_turns'),previous=await idbResult<WorkroomTurn|undefined>(store.get(id));if(previous){if(previous.charId!==charId||previous.workId!==workId||previous.role!==role||previous.kind!=='play'||previous.text!==text)throw Error('互动标识冲突');return previous;}
            const char=await idbResult(tx.objectStore('characters').get(charId));const recent=await idbResult(store.index('workId_createdAt').openCursor(IDBKeyRange.bound([workId,0],[workId,Number.MAX_SAFE_INTEGER]),'prev'));const turn:WorkroomTurn={id,charId,workId,workTitle:work.title,kind:'play',role,text,createdAt:Math.max(Date.now(),(recent?.value?.createdAt||0)+1),delivery:deliver?'pending':'local'};await idbResult(store.add(turn));return turn;});
    },
    appendTurn: (charId: string, workId: string, role: 'user' | 'assistant', text: string, id = workroomId()) => {
        if (!['user', 'assistant'].includes(role) || !validText(text, 12000) || !validText(id, 200)) throw Error('创作交流内容无效');
        return transact(charId, 'readwrite', async tx => {
            const work = await owned(tx, charId, workId);
            const store = tx.objectStore('workroom_turns');
            const previous = await idbResult<WorkroomTurn | undefined>(store.get(id));
            if (previous) {
                if (previous.charId !== charId || previous.workId !== workId || previous.role !== role || previous.text !== text) throw Error('创作交流标识冲突');
                return previous;
            }
            const latest = await lastTurn(tx, workId);
            const turn: WorkroomTurn = { id, charId, workId, workTitle: work.title, role, text, createdAt: Math.max(Date.now(), (latest?.createdAt || 0) + 1), delivery: 'pending' };
            await idbResult(store.add(turn)); return turn;
        });
    },
    commitReply: (charId: string, workId: string, input: {
        userTurnId: string; expectedVersionId: string | null; expectedDraftRevision: number;
        text: string; code?: WorkroomCode; signal?: AbortSignal;
    }) => {
        if (!validText(input.text, 8000)) throw Error('角色回复无效');
        if (input.code) assertCode(input.code);
        input.signal?.throwIfAborted();
        return transact(charId, 'readwrite', async tx => {
            const work = await owned(tx, charId, workId);
            const latest = await lastTurn(tx, workId);
            const draft = await idbResult<WorkroomDraft | undefined>(tx.objectStore('workroom_drafts').get(workId));
            if (!latest || latest.id !== input.userTurnId || latest.role !== 'user') throw Error('已有新的创作交流，请重新生成');
            if (work.currentVersionId !== input.expectedVersionId || (draft?.revision || 0) !== input.expectedDraftRevision) throw Error('作品已被其他窗口修改，请重新读取');
            input.signal?.throwIfAborted();
            if (input.code) await idbResult(tx.objectStore('workroom_drafts').put({
                id: workId, workId, charId, baseVersionId: work.currentVersionId, revision: (draft?.revision || 0) + 1, ...codeOnly(input.code),
            } satisfies WorkroomDraft));
            const turn: WorkroomTurn = { id: workroomId(), charId, workId, workTitle: work.title, role: 'assistant',
                text: input.text, createdAt: Math.max(Date.now(), latest.createdAt + 1), delivery: 'pending' };
            await idbResult(tx.objectStore('workroom_turns').add(turn));
            return turn;
        });
    },
    delete: (charId: string, workId: string) => transact(charId, 'readwrite', async tx => {
        await owned(tx, charId, workId);
        for (const name of WORKROOM_STORES) {
            const store = tx.objectStore(name);
            if (name === 'workroom_works') await idbResult(store.delete(workId));
            else {
                const keys = await idbResult(store.index('workId').getAllKeys(workId));
                for (const key of keys) await idbResult(store.delete(key));
            }
        }
    }),
};
