import RecordingEditTrigger from './RecordingEditTrigger';
import React from 'react';
import { useBlobRefUrl } from '../../../utils/blobRef';
export interface CallRecording { ref?: string; duration?: number; cleared?: boolean; analysis?: string; }
export default function CallRecordingPlayback({ recording, messageId, transcript = '' }: { recording?: CallRecording; messageId?: number; transcript?: string }) {
  const url = useBlobRefUrl(recording?.cleared ? undefined : recording?.ref);
  if (!recording) return null;
  return <RecordingEditTrigger id={messageId} transcript={transcript} analysis={recording.analysis || ''}><div className="mt-2 text-xs"><span>{recording.cleared ? '录音已清理 · 文字保留' : `真实语音 · ${Math.ceil(recording.duration || 0)} 秒`}</span>{url && <audio controls preload="metadata" src={url} className="w-full max-w-[260px] mt-1" />}{recording.analysis && <details className="mt-2 opacity-70"><summary>声音细节</summary><p className="whitespace-pre-wrap mt-2">{recording.analysis}</p></details>}</div></RecordingEditTrigger>;
}
