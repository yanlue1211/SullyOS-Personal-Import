import type { WorkroomEvent } from '../../utils/workroomEvent';

export const WORKROOM_FIELDS = {
    workroom_works: 'workroomWorks', workroom_versions: 'workroomVersions',
    workroom_drafts: 'workroomDrafts', workroom_states: 'workroomStates', workroom_events: 'workroomEvents',
    workroom_turns: 'workroomTurns', workroom_shares: 'workroomShares',
} as const;
export const WORKROOM_STORES = Object.keys(WORKROOM_FIELDS) as Array<keyof typeof WORKROOM_FIELDS>;
export interface WorkroomWork {
    id: string; charId: string; title: string; summary: string;
    createdAt: number; updatedAt: number; currentVersionId: string | null;
    runtimeAiEnabled?: boolean;
    lastError?: string;
    maintenanceRequests?: string[];
    testReport?: {draftRevision: number; createdAt: number; errors: string[]; notes: string};
    idea?: {status: 'open' | 'shelved' | 'done'; invitationId: string};
    source?: {authorId: string; authorName: string; workId: string; versionId: string; shareId: string};
}
export interface WorkroomCode { html: string; css: string; js: string }
export interface WorkroomVersion extends WorkroomCode {
    id: string; charId: string; workId: string; number: number; schemaVersion: number; createdAt: number;
}
export interface WorkroomDraft extends WorkroomCode {
    id: string; charId: string; workId: string; baseVersionId: string | null; revision: number;
}
export interface WorkroomState {
    id: string; charId: string; workId: string; schemaVersion: number; revision: number; data: unknown;
}
export interface WorkroomStoredEvent {
    id: string; charId: string; workId: string; event: WorkroomEvent;
    /** Closed-link interactions remain local; completions and enabled interactions enter the outbox. */
    delivery: 'local' | 'pending' | 'delivered';
    messageId?: number;
    notice?: 'pending' | 'dismissed';
}
export interface WorkroomTurn {
    id: string; charId: string; workId: string; workTitle: string; role: 'user' | 'assistant';
    text: string; createdAt: number; delivery: 'pending' | 'delivered' | 'local';
    kind?: 'play';
    messageId?: number;
}
export interface WorkroomShare {
    id: string; charId: string; createdAt: number; acceptedWorkId?: string;
    snapshot: WorkroomCode & {title: string; summary: string; schemaVersion: number; authorId: string; authorName: string; workId: string; versionId: string};
}
export interface WorkroomBackup {
    workroomWorks: WorkroomWork[]; workroomVersions: WorkroomVersion[];
    workroomDrafts: WorkroomDraft[]; workroomStates: WorkroomState[]; workroomEvents: WorkroomStoredEvent[]; workroomTurns: WorkroomTurn[]; workroomShares: WorkroomShare[];
}
export const stateId = (workId: string, schemaVersion: number) => JSON.stringify([workId, schemaVersion]);
export const workroomId = (): string => crypto.randomUUID();
export const validText = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
export const validInteger = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
export function assertCode(code: WorkroomCode) {
    for (const key of ['html', 'css', 'js'] as const) {
        if (typeof code?.[key] !== 'string' || code[key].length > 500_000 || /blobref:|blob:/i.test(code[key])) {
            throw Error('作品代码无效或包含不可迁移的临时资源');
        }
    }
}
/** No JSON coercion: reject cycles, functions, undefined, nonfinite numbers and class instances. */
export function cloneWorkroomState(value: unknown): unknown {
    const active = new WeakSet<object>();
    const visit = (v: unknown, depth: number): unknown => {
        if (depth > 40) throw Error('组件状态嵌套过深');
        if (v === null || typeof v === 'boolean') return v;
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string' && !/blobref:|blob:/i.test(v)) return v;
        if (typeof v !== 'object' || !v || active.has(v)) throw Error('组件状态必须是可迁移的 JSON');
        if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw Error('组件状态必须是普通 JSON');
        active.add(v);
        const result = Array.isArray(v) ? v.map(item => visit(item, depth + 1))
            : Object.fromEntries(Object.entries(v).map(([k, item]) => [k, visit(item, depth + 1)]));
        active.delete(v);
        return result;
    };
    const copy = visit(value, 0);
    if (JSON.stringify(copy).length > 256_000) throw Error('组件状态超过容量限制');
    return copy;
}

export function createWorkroomStores(db: IDBDatabase, upgrade: IDBTransaction) {
    for (const name of WORKROOM_STORES) {
        const store = db.objectStoreNames.contains(name) ? upgrade.objectStore(name) : db.createObjectStore(name, { keyPath: 'id' });
        if (!store.indexNames.contains('charId')) store.createIndex('charId', 'charId');
        if (name !== 'workroom_works' && !store.indexNames.contains('workId')) store.createIndex('workId', 'workId');
        if (name === 'workroom_events' && !store.indexNames.contains('notice')) store.createIndex('notice', 'notice');
        if (name === 'workroom_turns' && !store.indexNames.contains('workId_createdAt')) store.createIndex('workId_createdAt', ['workId', 'createdAt']);
        if ((name === 'workroom_events' || name === 'workroom_turns') && !store.indexNames.contains('charId_delivery')) {
            store.createIndex('charId_delivery', ['charId', 'delivery']);
        }
    }
}

export const idbResult = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
export const transactionDone = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || Error('造物间事务已取消'));
    tx.onerror = () => reject(tx.error || Error('造物间保存失败'));
});
