import { recordingText } from './transcript';
import type { Message } from '../../../types';
import { DB, openDB } from '../../../utils/db';
import { deleteBlobRef, getBlobForRef, isBlobRef } from '../../../utils/blobRef';
import { REF_SOURCE_STORES } from '../../../utils/blobGc';
import { currentMaintenanceHolder, releaseMaintenanceLock, tryAcquireMaintenanceLock } from '../../../utils/maintenanceLock';

export interface UserRecording { id: number; charId: string; charName?: string; ref: string; timestamp: number; duration: number; bytes: number; description: string; transcript?: string; }
export async function listUserRecordings(charId?: string): Promise<UserRecording[]> {
  const result: UserRecording[] = [];
  let after: IDBValidKey | null = null;
  for (;;) {
    const { rows, lastKey } = await DB.getStoreRowsPage('messages', after, 200);
    for (const message of rows as Message[]) {
      if (message.role !== 'user' || message.type !== 'audio' || message.metadata?.audioCleared || !isBlobRef(message.content) || (charId && message.charId !== charId)) continue;
      const blob = await getBlobForRef(message.content);
      result.push({ id: message.id, charId: message.charId, ref: message.content, timestamp: message.timestamp, duration: message.metadata?.duration || 0, bytes: blob?.size || 0, description: message.metadata?.audioDescription || '', transcript: recordingText(message.metadata).transcript });
    }
    if (lastKey === null || rows.length < 200) break;
    after = lastKey;
  }
  const names = new Map<string, string>();
  for (const id of new Set(result.map(row => row.charId))) names.set(id, (await DB.getCharacter(id))?.name || '未命名角色');
  for (const row of result) row.charName = names.get(row.charId);
  return result.sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
}

/** Detach only reviewed user recordings. Commit message changes before reclaiming unreferenced blobs. */
export async function clearUserRecordings(recordings: UserRecording[]): Promise<{ cleared: number; freedBytes: number; retainedFiles: number }> {
  if (!tryAcquireMaintenanceLock('用户录音清理')) throw new Error(`请等待「${currentMaintenanceHolder()}」完成后重试`);
  try {
    const db = await openDB();
    const refs = new Map<string, number>();
    let cleared = 0;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      for (const candidate of new Map(recordings.map(item => [item.id, item])).values()) {
        const req = store.get(candidate.id);
        req.onsuccess = () => {
          const current = req.result as Message | undefined;
          if (!current || current.role !== 'user' || current.type !== 'audio' || current.content !== candidate.ref || current.metadata?.audioCleared) return;
          refs.set(candidate.ref, candidate.bytes);
          store.put({ ...current, content: '[用户录音已清理]', metadata: { ...current.metadata, audioCleared: true } });
          cleared++;
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('录音清理失败'));
      tx.onabort = () => reject(tx.error || new Error('录音清理已取消'));
    });
    const referenced = new Set<string>();
    const inspect = (value: string) => { for (const ref of refs.keys()) if (value.includes(ref)) referenced.add(ref); };
    // One bounded scan for the whole batch; references in forwards/favorites/backups remain safe.
    try {
      for (const name of REF_SOURCE_STORES) {
        let after: IDBValidKey | null = null;
        for (;;) {
          const { rows, lastKey } = await DB.getStoreRowsPage(name, after, 200);
          for (const row of rows) inspect(JSON.stringify(row) || '');
          if (lastKey === null || rows.length < 200) break;
          after = lastKey;
        }
      }
      for (let i = 0; i < localStorage.length; i++) inspect(localStorage.getItem(localStorage.key(i)!) || '');
    } catch {
      // Messages are detached, but any incomplete reference scan keeps every file intact.
      return { cleared, freedBytes: 0, retainedFiles: refs.size };
    }
    let freedBytes = 0;
    let retainedFiles = 0;
    for (const [ref, bytes] of refs) {
      if (referenced.has(ref)) { retainedFiles++; continue; }
      try { await deleteBlobRef(ref); freedBytes += bytes; } catch { retainedFiles++; }
    }
    return { cleared, freedBytes, retainedFiles };
  } finally { releaseMaintenanceLock(); }
}
