import { openDB } from '../../../utils/db';
/** Atomic across tabs and refreshes. One automatic generation attempt per character/date. */
export async function claimDailySchedule(charId: string, date: string): Promise<boolean> {
  const db = await openDB(); const id = `personal_schedule_once:${charId}:${date}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite'); const store = tx.objectStore('assets'); let claimed = false;
    const req = store.get(id); req.onsuccess = () => { if (req.result) return; claimed = true; store.put({ id, data: { attempted: true } }); };
    tx.oncomplete = () => resolve(claimed); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
