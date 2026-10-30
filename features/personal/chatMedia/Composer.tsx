import type { RecordingRecognition } from './transcript';
import React, { useEffect, useRef, useState } from 'react';
import { Microphone, ChatText, Image, VideoCamera, X, ArrowUp, ArrowCounterClockwise } from '@phosphor-icons/react';
import { virtualMedia, type VirtualMediaKind } from './format';
interface Props {
  conversationId: string;
  onSend: (content: string, audio?: Blob, duration?: number, signal?: AbortSignal, recognition?: Promise<RecordingRecognition>) => Promise<void>;
  onRecognize?: (audio: Blob) => Promise<RecordingRecognition>;
  recordingOnly?: boolean;
  visualOnly?: boolean;
  disabled?: boolean;
  dark?: boolean;
  onRecordingStart?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onClose?: () => void;
  sheet?: boolean;
  onRecordingsChanged?: () => void | Promise<void>;
}
export default function MediaComposer({ conversationId, onSend, onRecognize, recordingOnly = false, visualOnly = false, disabled = false, dark = false, onRecordingStart, onBusyChange, onClose, sheet = false }: Props) {
  const [mode, setMode] = useState<VirtualMediaKind | '录音'>(visualOnly ? '图片' : '录音');
  const [text, setText] = useState('');
  const [blob, setBlob] = useState<Blob>();
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recognition = useRef<Promise<RecordingRecognition>>();
  const [recognizing, setRecognizing] = useState(false);
  const [recognized, setRecognized] = useState<RecordingRecognition>();
  const resetRecognition = () => { recognition.current = undefined; setRecognized(undefined); setRecognizing(false); };
  const beginRecognition = (audio: Blob) => {
    resetRecognition();
    if (!onRecognize) return;
    setRecognizing(true);
    const pending = Promise.resolve().then(() => onRecognize(audio));
    recognition.current = pending;
    void pending.then(value => { if (recognition.current === pending) { setRecognized(value); setRecognizing(false); } }, e => { if (recognition.current === pending) { setRecognizing(false); setError(e instanceof Error ? e.message : '识别失败，可以重试或发送。'); recognition.current = undefined; } });
  };
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const epoch = useRef(0);
  const held = useRef(false);
  const sendAbort = useRef<AbortController>();
  const timer = useRef<ReturnType<typeof setInterval>>();
  const swipe = useRef<{ x: number; y: number }>();
  useEffect(() => { onBusyChange?.(busy || recording); }, [busy, recording, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const cleanup = () => {
    recognition.current = undefined; held.current = false; sendAbort.current?.abort(); epoch.current++; clearInterval(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
  };
  useEffect(() => () => cleanup(), []);
  useEffect(() => { cleanup(); resetRecognition(); setBlob(undefined); setRecording(false); setSeconds(0); setText(''); }, [conversationId]);
  const release = () => { held.current = false; if (recorder.current?.state === 'recording') recorder.current.stop(); };
  const start = async () => {
    if (disabled || busy || recording) return;
    resetRecognition(); held.current = true; onRecordingStart?.(); setError(''); setBlob(undefined); setBusy(true);
    const token = ++epoch.current;
    let mic: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('当前环境不支持录音，请使用 HTTPS 并允许麦克风权限。');
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== epoch.current || !held.current) { mic.getTracks().forEach(track => track.stop()); return; }
      stream.current = mic;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(mic, mimeType ? { mimeType } : undefined); recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      rec.onstop = () => {
        mic?.getTracks().forEach(track => track.stop()); clearInterval(timer.current);
        if (token !== epoch.current) return;
        setRecording(false); held.current = false;
        const result = new Blob(chunks, { type: rec.mimeType });
        if (result.size) { setBlob(result); beginRecognition(result); } else setError('录音为空，请重试。');
      };
      rec.onerror = () => { cleanup(); setRecording(false); setBusy(false); setError('录音中断，请重新录制。'); };
      rec.start(); setSeconds(0); setRecording(true);
      const started = performance.now();
      timer.current = setInterval(() => { const elapsed = (performance.now() - started) / 1000; setSeconds(elapsed); if (elapsed >= 120) release(); }, 150);
    } catch (e) { mic?.getTracks().forEach(track => track.stop()); if (token === epoch.current) setError(e instanceof Error ? e.message : '无法访问麦克风'); }
    finally { if (token === epoch.current) setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError(''); const abort = new AbortController(); sendAbort.current = abort;
    try {
      await onSend(mode === '录音' ? '[用户发送了一条真实语音]' : virtualMedia(mode, text), mode === '录音' ? blob : undefined, seconds, abort.signal, mode === '录音' ? recognized ? Promise.resolve(recognized) : recognition.current : undefined);
      if (abort.signal.aborted) return;
      resetRecognition(); setText(''); setBlob(undefined); onClose?.();
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '发送失败，内容已保留，请重试。'); }
    finally { setBusy(false); }
  };
  const modes = visualOnly ? ['图片', '视频'] as const : recordingOnly ? ['录音'] as const : ['录音', '语音'] as const;
  const content = <section role={sheet ? 'dialog' : undefined} aria-modal={sheet || undefined} aria-label={visualOnly ? '虚拟影像' : '发送语音'}
    onPointerDown={e => { if ((e.target as HTMLElement).closest('button, textarea, audio')) return; swipe.current = { x: e.clientX, y: e.clientY }; }}
    onPointerUp={e => { const from = swipe.current; swipe.current = undefined; if (!from || recording || busy || recordingOnly) return; const dx = e.clientX - from.x; if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.clientY - from.y)) return; setMode(visualOnly ? dx > 0 ? '视频' : '图片' : dx > 0 ? '语音' : '录音'); }}
    style={{ touchAction: 'pan-y' }}
    className={`sully-media-composer ${dark ? 'bg-white/[0.04] text-white/80 border border-white/10' : 'bg-white text-slate-700'} ${sheet ? 'rounded-t-[28px] px-5 pt-4 pb-6 w-full shadow-xl' : 'rounded-2xl px-4 py-3 mx-3 mb-2'}`}>
    <div className="flex items-center justify-between gap-3 mb-4"><div className="flex gap-5" role="tablist" aria-label="发送方式">{modes.map(kind => <button type="button" role="tab" aria-selected={kind === mode} disabled={recording || busy} key={kind} onClick={() => setMode(kind)} className={`flex items-center gap-1.5 pb-2 text-sm border-b-2 ${mode === kind ? dark ? 'text-white border-white font-medium' : 'text-slate-900 border-slate-900 font-medium' : dark ? 'text-white/40 border-transparent' : 'text-slate-400 border-transparent'}`}>{kind === '录音' ? <Microphone size={17} /> : kind === '语音' ? <ChatText size={17} /> : kind === '图片' ? <Image size={17} /> : <VideoCamera size={17} />}{kind === '录音' ? '真实语音' : `虚拟${kind}`}</button>)}</div>{onClose && <button type="button" aria-label="关闭语音面板" disabled={busy || recording} onClick={onClose} className="p-2 text-slate-400"><X size={19} /></button>}</div>
    {mode === '录音' ? <div className="text-center select-none py-1">
      {blob ? <div className="py-2"><Preview blob={blob} /><button type="button" disabled={busy} onClick={() => { resetRecognition(); setBlob(undefined); setSeconds(0); }} className="inline-flex gap-1 items-center mt-3 text-xs text-slate-400"><ArrowCounterClockwise size={14} />重新录制</button></div> : <>
        <button type="button" aria-label="按住录音" disabled={disabled}
          onContextMenu={e => e.preventDefault()}
          onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); void start(); }}
          onPointerUp={e => { e.stopPropagation(); release(); }}
          onPointerCancel={() => { cleanup(); setRecording(false); setBusy(false); }}
          onLostPointerCapture={release}
          onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); void start(); } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') release(); }}
          style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
          className={`w-20 h-20 rounded-full inline-flex items-center justify-center transition-colors ${recording ? 'bg-rose-100 text-rose-500' : dark ? 'bg-white/10 text-white/75' : 'bg-slate-100 text-slate-600'} disabled:opacity-50`}><Microphone size={34} weight={recording ? 'fill' : 'regular'} /></button>
        <p className="text-sm mt-3">{recording ? `松开结束 · ${Math.floor(seconds)} 秒` : busy ? '正在获取麦克风权限' : '按住说话'}</p><p className={`text-[11px] mt-1 ${dark ? 'text-white/40' : 'text-slate-400'}`}>{recordingOnly ? '最长 2 分钟' : '右滑输入虚拟语音 · 最长 2 分钟'}</p>
      </>}
    </div> : <textarea rows={3} value={text} maxLength={4000} onChange={e => setText(e.target.value)} placeholder={mode === '语音' ? '输入想说的话…' : `描述${mode}中的画面…`} className="w-full bg-slate-50 rounded-2xl p-3 text-sm outline-none resize-none" />}
    {mode === '录音' && blob && onRecognize && <div className="mt-3 space-y-2 text-left select-text">
      {recognizing && <p role="status" className="text-xs text-slate-400">正在识别原文和语气，可以直接发送，识别会继续…</p>}
      {recognized && <>
        <label className="block text-xs">原文字幕<textarea aria-label="发送前修改原文" disabled={busy} rows={3} value={recognized.transcript} onChange={e => setRecognized({ ...recognized, transcript: e.target.value })} className="w-full mt-1 rounded-xl p-3 bg-slate-50 text-slate-700 text-sm" /></label>
        <label className="block text-xs">语气与声音细节<textarea aria-label="发送前修改语气" disabled={busy} rows={2} value={recognized.analysis} onChange={e => setRecognized({ ...recognized, analysis: e.target.value })} className="w-full mt-1 rounded-xl p-3 bg-slate-50 text-slate-700 text-sm" /></label>
      </>}
      {!recognizing && !recognized && <button type="button" disabled={busy} onClick={() => beginRecognition(blob)} className="text-xs">重试识别</button>}
    </div>}
    {error && <p role="alert" className="text-rose-500 text-xs mt-3">{error}</p>}
    {(blob || mode !== '录音') && <div className="flex justify-end mt-3"><button type="button" disabled={busy || disabled || recording || (mode === '录音' ? !blob : !text.trim())} onClick={() => void send()} className="rounded-full bg-slate-800 text-white px-4 py-2 text-xs flex items-center gap-1 disabled:opacity-30">{busy ? '处理中…' : '发送'}<ArrowUp size={14} /></button></div>}
  </section>;
  return sheet ? <div className="fixed inset-0 z-[160] bg-black/25 flex items-end" onClick={e => { if (e.target === e.currentTarget && !busy && !recording) onClose?.(); }}>{content}</div> : content;
}
function Preview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const value = URL.createObjectURL(blob); setUrl(value); return () => URL.revokeObjectURL(value); }, [blob]);
  return <audio src={url} controls className="w-full h-10" />;
}
