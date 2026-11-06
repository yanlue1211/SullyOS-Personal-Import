import { openDB } from '../../../utils/db';
import type { Message } from '../../../types';
import { recordingContext } from './transcript';
export async function editRecordingText(id: number, transcript: string, analysis: string): Promise<Message> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite'); const store = tx.objectStore('messages'); let result: Message;
    const req = store.get(id);
    req.onsuccess = () => {
      const current = req.result as Message | undefined;
      if (!current || current.role !== 'user' || current.type !== 'audio') { tx.abort(); return; }
      const recognition = { transcript: transcript.trim(), analysis: analysis.trim() };
      result = { ...current, metadata: { ...current.metadata, audioTranscript: recognition.transcript, audioAnalysis: recognition.analysis, audioDescription: recordingContext(recognition), audioTextEdited: true } };
      store.put(result);
    };
    tx.oncomplete = () => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('personal-recording-edited', { detail: result })); resolve(result); };
    tx.onerror = () => reject(tx.error || new Error('保存失败'));
    tx.onabort = () => reject(new Error('找不到可编辑的用户录音'));
  });
}
