import { openDB } from '../../utils/db';
import { idbResult, transactionDone, type WorkroomStoredEvent } from './schema';
export const WORKROOM_NOTICE_UPDATED = 'workroom-notice-updated';
export async function listWorkroomNotices():Promise<WorkroomStoredEvent[]> {
    const db=await openDB(),tx=db.transaction('workroom_events','readonly'),done=transactionDone(tx);
    const rows=await idbResult<WorkroomStoredEvent[]>(tx.objectStore('workroom_events').index('notice').getAll('pending'));await done;
    return rows.filter(row=>row.event.kind==='completed').sort((a,b)=>a.event.timestamp-b.event.timestamp);
}
export async function dismissWorkroomNotice(id:string) {
    const db=await openDB(),tx=db.transaction('workroom_events','readwrite'),done=transactionDone(tx),store=tx.objectStore('workroom_events');
    const row=await idbResult<WorkroomStoredEvent|undefined>(store.get(id));
    if(row?.event.kind==='completed')await idbResult(store.put({...row,notice:'dismissed'}));await done;
    if(typeof window!=='undefined')window.dispatchEvent(new Event(WORKROOM_NOTICE_UPDATED));
}
