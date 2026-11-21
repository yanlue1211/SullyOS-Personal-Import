import type { FullBackupData } from '../types';
import type { RescueImportSummary } from './amsgRescueImport';

export interface RescueArchive {
  id: string;
  name: string;
  savedAt: number;
  backup: FullBackupData;
  summary: RescueImportSummary;
}

function openRescueArchiveDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SullyOS_RescueArchive', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('archives', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('救援档案库被其他窗口占用。'));
  });
}

export async function saveRescueArchive(name: string, recovered: Pick<RescueArchive, 'backup' | 'summary'>): Promise<string> {
  const db = await openRescueArchiveDb();
  const id = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('archives', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('保存救援档案失败。'));
      transaction.objectStore('archives').add({ id, name, savedAt: Date.now(), ...recovered });
    });
    return id;
  } finally {
    db.close();
  }
}

export async function listRescueArchives(): Promise<RescueArchive[]> {
  const db = await openRescueArchiveDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('archives').objectStore('archives').getAll();
      request.onsuccess = () => resolve((request.result as RescueArchive[]).sort((a, b) => b.savedAt - a.savedAt));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
