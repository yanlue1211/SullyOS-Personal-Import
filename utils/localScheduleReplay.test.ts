import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
afterEach(() => vi.restoreAllMocks());
const task = (id: string, charId: string, dueAt = 1, content = '同一句话') => ({ id, charId, content, dueAt, createdAt: 1 });
describe('local schedule replay protection', () => {
  it('serializes repeated clicks, keeps distinct content and later appointments', async () => {
    const rows = await Promise.all(Array.from({ length: 30 }, (_, i) => DB.saveScheduledMessage(task(`click-${i}`, 'clicks'))));
    expect(rows.filter(Boolean)).toHaveLength(1);
    await DB.saveScheduledMessage(task('other', 'clicks', 1, '另一句话'));
    await DB.saveScheduledMessage(task('tomorrow', 'clicks', 86400001));
    expect(await DB.getScheduledMessages('clicks')).toHaveLength(3);
  });
  it('concurrent scans and restart deliver only once', async () => {
    await DB.saveScheduledMessage(task('race', 'race'));
    const batches = await Promise.all([DB.deliverDueScheduledMessages('race'), DB.deliverDueScheduledMessages('race')]);
    expect(batches.flat()).toHaveLength(1);
    expect(await DB.deliverDueScheduledMessages('race')).toEqual([]);
    expect(await DB.getMessagesByCharId('race', true)).toHaveLength(1);
  });
  it('rolls back both chat and queue on failed commit, then retries once', async () => {
    await DB.saveScheduledMessage(task('abort', 'abort'));
    const add = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: any[]) {
      const req = (add as any).apply(this, args);
      req.addEventListener('success', () => this.transaction.abort());
      return req;
    });
    await expect(DB.deliverDueScheduledMessages('abort')).rejects.toBeTruthy();
    spy.mockRestore();
    expect(await DB.getMessagesByCharId('abort', true)).toHaveLength(0);
    expect(await DB.getScheduledMessages('abort')).toHaveLength(1);
    expect(await DB.deliverDueScheduledMessages('abort')).toHaveLength(1);
  });
  it('collapses old duplicated rows without deleting future or unrelated tasks', async () => {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('scheduled_messages', 'readwrite');
      for (let i = 0; i < 100; i++) tx.objectStore('scheduled_messages').put(task(`old-${i}`, 'old'));
      tx.objectStore('scheduled_messages').put(task('future', 'old', Date.now() + 3600000));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    expect(await DB.deliverDueScheduledMessages('old')).toHaveLength(1);
    expect(await DB.getMessagesByCharId('old', true)).toHaveLength(1);
    expect((await DB.getScheduledMessages('old')).map(row => row.id)).toEqual(['future']);
  });
  it('limits backlog delivery per scan', async () => {
    for (let i = 0; i < 25; i++) await DB.saveScheduledMessage(task(`batch-${i}`, 'batch', 1, `消息${i}`));
    expect(await DB.deliverDueScheduledMessages('batch')).toHaveLength(20);
    expect(await DB.deliverDueScheduledMessages('batch')).toHaveLength(5);
  });
});
