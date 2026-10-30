import RecordingEditTrigger from './RecordingEditTrigger';
import { recordingText } from './transcript';
import React, { useState } from 'react';
import type { Message } from '../../../types';
import { useBlobRefUrl } from '../../../utils/blobRef';
import { parseVirtualMedia } from './format';
export default function MediaMessage({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const url = useBlobRefUrl(message.type === 'audio' && !message.metadata?.audioCleared ? message.content : undefined);
  const media = parseVirtualMedia(message.content);
  const caption = recordingText(message.metadata);
  if (message.type === 'audio') return <RecordingEditTrigger id={message.id} transcript={caption.transcript} analysis={caption.analysis}><div className="sully-voice-bar rounded-2xl bg-white/90 border border-slate-200 p-3 max-w-[270px] text-slate-700">
    <div className="text-xs mb-2">🎙 语音 · {Math.ceil(message.metadata?.duration || 0)} 秒</div>
    {message.metadata?.audioCleared ? <p className="text-xs">录音文件已清理</p> : url ? <audio controls preload="metadata" src={url} className="max-w-full w-[240px]" /> : <p className="text-xs">录音文件暂不可用</p>}
    {caption.transcript && <p className="text-sm whitespace-pre-wrap mt-2">{caption.transcript}</p>}
    {caption.analysis && <details className="text-xs mt-2"><summary className="text-slate-400">声音细节</summary><p className="whitespace-pre-wrap mt-2">{caption.analysis}</p></details>}

  </div></RecordingEditTrigger>;
  if (!media) return null;
  return <div className="sully-virtual-media rounded-2xl border border-slate-200 bg-white/90 text-slate-700 max-w-[270px] overflow-hidden">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full min-w-[150px] p-4 text-left">
      <span className="text-2xl">{media.kind === '图片' ? '▧' : media.kind === '视频' ? '▶' : '◖))'}</span>
      <span className="block text-sm mt-1">{media.kind === '语音' ? `${Math.max(1, Math.ceil(media.description.length / 4))}″` : `虚拟${media.kind}`}</span>
      <span className="block text-xs opacity-60 mt-1">点击{open ? '收起' : '查看'}{media.kind === '语音' ? '文字' : '内容'}</span>
    </button>
    {open && <p className="border-t border-slate-100 p-3 text-sm whitespace-pre-wrap break-words">{media.description}</p>}
  </div>;
}
