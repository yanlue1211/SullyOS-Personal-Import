import { DB, openDB } from '../../utils/db';
import { idbResult, transactionDone, type WorkroomStoredEvent, type WorkroomTurn } from './schema';

export const WORKROOM_HISTORY_UPDATED = 'workroom-history-updated';
const running = new Map<string, Promise<void>>();
/** No model calls: committed messages enter the existing memory buffer like normal chat. */
export function drainWorkroomOutbox(charId: string): Promise<void> {
    const previous = running.get(charId);
    if (previous) return previous.then(() => drainWorkroomOutbox(charId));
    const task = (async () => {
        const db = await openDB();
        const stores = ['workroom_events', 'workroom_turns'] as const;
        const tx = db.transaction([...stores], 'readonly');
        const done = transactionDone(tx);
        const rows = await Promise.all(stores.map(name => idbResult<Array<WorkroomStoredEvent | WorkroomTurn>>(
            tx.objectStore(name).index('charId_delivery').getAll(IDBKeyRange.only([charId, 'pending'])))));
        await done;
        const pending = rows.flatMap((items, index) => items.filter(row => row.delivery === 'pending').map(row => ({
            row, name: stores[index], at: 'createdAt' in row ? row.createdAt : row.event.timestamp,
        }))).sort((a, b) => a.at - b.at || a.row.id.localeCompare(b.row.id));
        let changed = false;
        try {
            for (const { row, name } of pending) if (await DB.deliverWorkroomPending(charId, name, row.id) !== null) changed = true;
        } finally {
            if (changed && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WORKROOM_HISTORY_UPDATED, { detail: { charId } }));
        }
    })();
    running.set(charId, task);
    void task.finally(() => { if (running.get(charId) === task) running.delete(charId); }).catch(() => {});
    return task;
}
