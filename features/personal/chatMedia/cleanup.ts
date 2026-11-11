import { recordingText } from './transcript';
import type { Message } from '../../../types';
import { DB, openDB } from '../../../utils/db';
import { getBlobForRef, isBlobRef } from '../../../utils/blobRef';
import { reclaimUnreferencedVoiceBlobs } from '../../../utils/voiceBlobBatchCleanup';
import { currentMaintenanceHolder, releaseMaintenanceLock, tryAcquireMaintenanceLock } from '../../../utils/maintenanceLock';

export interface UserRecording { id: number; charId: string; charName?: string; ref: string; timestamp: number; duration: number; bytes: number; description: string; transcript?: string; }
export async function listUserRecordings(charId?: string, includeCharacterVoices = false): Promise<UserRecording[]> {
  const result: UserRecording[] = [];
  let after: IDBValidKey | null = null;
  for (;;) {
    const { rows, lastKey } = await DB.getStoreRowsPage('messages', after, 200);
    for (const message of rows as Message[]) {
      if ((message.role !== 'user' && !(includeCharacterVoices && message.role === 'assistant')) || message.type !== 'audio' || message.metadata?.audioCleared || !(isBlobRef(message.content) || (includeCharacterVoices && /^data:audio\//i.test(message.content))) || (charId && message.charId !== charId)) continue;
      const blob = isBlobRef(message.content) ? await getBlobForRef(message.content) : null;
      const inlineBytes = blob ? 0 : /^data:audio\//i.test(message.content) ? Math.floor((message.content.length - message.content.indexOf(',') - 1) * .75) : 0;
      result.push({ id: message.id, charId: message.charId, ref: message.content, timestamp: message.timestamp, duration: message.metadata?.duration || 0, bytes: blob?.size || inlineBytes, description: message.metadata?.audioDescription || '', transcript: recordingText(message.metadata).transcript });
    }
    if (lastKey === null || rows.length < 200) break;
    after = lastKey;
  }
  const names = new Map<string, string>();
  for (const id of new Set(result.map(row => row.charId))) names.set(id, (await DB.getCharacter(id))?.name || '未命名角色');
  for (const row of result) row.charName = names.get(row.charId);
  return result.sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
}

/**
 * Detach reviewed audio messages in bounded transactions. A single locked
 * reference sweep reclaims orphaned blobs without quadratic full-DB scans.
 */
export async function clearUserRecordings(
  recordings: UserRecording[],
  includeCharacterVoices = false,
  onProgress?: (label: string) => void,
): Promise<{ cleared: number; freedBytes: number; retainedFiles: number }> {
  if (!tryAcquireMaintenanceLock('用户录音清理')) throw new Error(`请等待「${currentMaintenanceHolder()}」完成后重试`);
  try {
    const db = await openDB();
    const selected = Array.from(new Map(recordings.map(item => [item.id, item])).values());
    const refs = new Map<string, number>();
    let cleared = 0;
    let freedInlineBytes = 0;
    const PAGE_SIZE = 24;
    for (let i = 0; i < selected.length; i += PAGE_SIZE) {
      const batch = selected.slice(i, i + PAGE_SIZE);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        let batchCleared = 0;
        let batchInlineBytes = 0;
        const batchRefs = new Map<string, number>();
        for (const candidate of batch) {
          const req = store.get(candidate.id);
          req.onsuccess = () => {
            const current = req.result as Message | undefined;
            if (!current || (current.role !== 'user' && !(includeCharacterVoices && current.role === 'assistant')) || current.type !== 'audio' || current.content !== candidate.ref || current.metadata?.audioCleared) return;
            if (isBlobRef(candidate.ref)) batchRefs.set(candidate.ref, candidate.bytes);
            else if (candidate.ref.toLowerCase().startsWith('data:audio/')) batchInlineBytes += candidate.bytes;
            store.put({ ...current, content: current.role === 'user' ? '[用户录音已清理]' : '[角色语音已清理]', metadata: { ...current.metadata, audioCleared: true } });
            batchCleared++;
          };
        }
        tx.oncomplete = () => {
          cleared += batchCleared;
          freedInlineBytes += batchInlineBytes;
          for (const [ref, bytes] of batchRefs) refs.set(ref, bytes);
          resolve();
        };
        tx.onerror = () => reject(tx.error || new Error('录音清理失败'));
        tx.onabort = () => reject(tx.error || new Error('录音清理已取消'));
      });
      onProgress?.(`正在整理聊天录音（${Math.min(i + PAGE_SIZE, selected.length)}/${selected.length}）`);
    }

    const deleted = await reclaimUnreferencedVoiceBlobs(refs.keys(), onProgress);
    let freedBytes = freedInlineBytes;
    for (const ref of deleted) freedBytes += refs.get(ref) || 0;
    return { cleared, freedBytes, retainedFiles: refs.size - deleted.size };
  } finally {
    releaseMaintenanceLock();
  }
}
