import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
import { putImageBlob, getBlobForRef } from './blobRef';
import { REF_SOURCE_STORES } from './blobGc';
import { clearUserRecordings, listUserRecordings } from '../features/personal/chatMedia/cleanup';
import { currentMaintenanceHolder } from './maintenanceLock';

async function clearStore(name: string) {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(name, 'readwrite'); tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear();
  for (const name of [...REF_SOURCE_STORES, 'blob_assets']) await clearStore(name);
});
const seed = async (charId = 'a', role: 'user' | 'assistant' = 'user', description = '你好') => {
  const ref = await putImageBlob(new Blob(['voice'], { type: 'audio/wav' }));
  const id = await DB.saveMessage({ charId, role, type: 'audio', content: ref, metadata: { duration: 2, audioDescription: description } });
  return { ref, id };
};
describe('user recording cleanup', () => {
  it('lists current/all user recordings while excluding character voice', async () => {
    await seed(); await seed('b'); await seed('a', 'assistant');
    expect(await listUserRecordings('a')).toHaveLength(1);
    expect(await listUserRecordings()).toHaveLength(2);
  });
  it('frees audio bytes and retains timestamps, description, and message ID', async () => {
    const { ref, id } = await seed();
    const old = (await DB.getMessagesByCharId('a', true))[0];
    expect(await clearUserRecordings(await listUserRecordings('a'))).toEqual({ cleared: 1, freedBytes: 5, retainedFiles: 0 });
    const message = (await DB.getMessagesByCharId('a', true))[0];
    expect(message.id).toBe(id); expect(message.timestamp).toBe(old.timestamp);
    expect(message.metadata.audioDescription).toBe('你好'); expect(message.metadata.audioCleared).toBe(true);
    expect(message.content).not.toContain('blobref:'); expect(await getBlobForRef(ref)).toBeNull();
    expect(await listUserRecordings()).toHaveLength(0);
    expect(currentMaintenanceHolder()).toBeNull();
  });
  it('preserves shared recordings referenced by an unselected message', async () => {
    const { ref } = await seed();
    await DB.saveMessage({ charId: 'b', role: 'user', type: 'audio', content: ref });
    expect(await clearUserRecordings(await listUserRecordings('a'))).toEqual({ cleared: 1, freedBytes: 0, retainedFiles: 1 });
    expect(await getBlobForRef(ref)).not.toBeNull();
  });
  it('never clears an assistant message even if a stale/malicious selection includes it', async () => {
    const { id, ref } = await seed('a', 'assistant');
    const result = await clearUserRecordings([{ id, ref, charId: 'a', bytes: 5, duration: 2, timestamp: 0, description: '' }]);
    expect(result.cleared).toBe(0); expect(await getBlobForRef(ref)).not.toBeNull();
  });
  it('keeps audio if reference scanning fails after detaching the selected messages', async () => {
    const { ref } = await seed(); const rows = await listUserRecordings();
    vi.spyOn(DB, 'getStoreRowsPage').mockRejectedValueOnce(new Error('read failed'));
    const result = await clearUserRecordings(rows);
    expect(result.freedBytes).toBe(0); expect(result.retainedFiles).toBe(1);
    expect(await getBlobForRef(ref)).not.toBeNull(); expect(currentMaintenanceHolder()).toBeNull();
  });
  it('rechecks stale selections and does not clear a replacement recording', async () => {
    const { id, ref } = await seed(); const rows = await listUserRecordings();
    const newRef = await putImageBlob(new Blob(['new'])); await DB.updateMessage(id, newRef);
    expect((await clearUserRecordings(rows)).cleared).toBe(0);
    expect(await getBlobForRef(ref)).not.toBeNull(); expect(await getBlobForRef(newRef)).not.toBeNull();
  });
});
