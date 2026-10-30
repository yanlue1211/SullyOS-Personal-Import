import RecordingEditTrigger from './RecordingEditTrigger';
import { recordingText } from './transcript';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '../../../types';
import { useBlobRefUrl } from '../../../utils/blobRef';
import { parseVirtualMedia } from './format';
export default function MediaMessage({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [open]);
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
  const isVoice = media.kind === '语音';
  const isVideo = media.kind === '视频';
  const title = isVideo ? '一段视频' : '一张照片';
  if (isVoice) return <div className="sully-virtual-media max-w-[250px]"><button type="button" onClick={event => { event.stopPropagation(); setOpen(true); }} className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-600">🎙 语音 · {Math.max(1, Math.ceil(media.description.length / 4))}″　点击查看</button>{open && createPortal(<div role="dialog" aria-modal="true" aria-label="语音文字" className="fixed inset-0 z-[700] bg-black/50 flex items-center justify-center p-5" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}><div className="max-w-md w-full rounded-3xl bg-white p-6 shadow-2xl" onClick={event => event.stopPropagation()}><button type="button" className="float-right text-slate-400" onClick={() => setOpen(false)}>✕</button><p className="whitespace-pre-wrap break-words text-slate-700 leading-7">{media.description}</p></div></div>, document.body)}</div>;
  return <div className="sully-virtual-media w-[min(68vw,265px)] max-w-full">
    <button type="button" aria-label={`查看${title}`} onClick={event => { event.stopPropagation(); setOpen(true); }} className="relative block w-full overflow-hidden rounded-[22px] border border-white/80 bg-gradient-to-br from-[#e5edf1] via-[#d5e1e7] to-[#b9cad5] text-slate-700 shadow-[0_8px_26px_rgba(68,94,112,0.15)] text-left">
      <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'radial-gradient(circle at 20% 15%, #fff 0%, transparent 45%), radial-gradient(circle at 90% 80%, #a9beca 0%, transparent 55%)' }} />
      <div className="relative min-h-[160px] px-5 py-6 flex flex-col justify-between">
        <div className="flex items-center justify-between"><span className="text-[11px] font-semibold tracking-[0.2em] text-slate-600/80">{isVideo ? 'VIDEO' : 'PHOTO'}</span><span className="text-lg">{isVideo ? '▸' : '✧'}</span></div>
        <div className="my-4 flex items-center justify-center"><div className="w-14 h-14 rounded-full border border-white/70 bg-white/30 backdrop-blur-md flex items-center justify-center text-2xl text-slate-700/75">{isVideo ? '▶' : '▧'}</div></div>
        <div className="text-center text-xs tracking-widest text-slate-600/80">轻触查看{isVideo ? '视频内容' : '照片'}</div>
      </div>
    </button>
    {open && createPortal(<div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[700] bg-black/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}><section className="relative w-full max-w-md max-h-[82vh] overflow-y-auto rounded-[28px] bg-[#fbfcfd] shadow-2xl text-slate-700" onClick={event => event.stopPropagation()}>
      <div className="h-24 bg-gradient-to-br from-[#e1ebef] to-[#bbd0dc] flex items-center justify-center text-3xl text-white/90">{isVideo ? '▶' : '✧'}</div>
      <button type="button" aria-label="关闭" className="absolute right-4 top-4 rounded-full bg-white/70 px-3 py-1 text-slate-600" onClick={() => setOpen(false)}>✕</button>
      <div className="px-6 pt-5 pb-7"><p className="text-xs tracking-[0.16em] text-slate-400 mb-4">{isVideo ? '🎞 视频记录' : '📷 照片记录'}</p><p className="whitespace-pre-wrap break-words text-[15px] leading-8" style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}>{media.description}</p></div>
    </section></div>, document.body)}
  </div>;
}
