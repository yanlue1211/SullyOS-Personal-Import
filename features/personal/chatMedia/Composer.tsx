import React, { useEffect, useRef, useState } from 'react';
import { virtualMedia, type VirtualMediaKind } from './format';
export default function MediaComposer({ conversationId, onSend }: { conversationId: string; onSend: (content: string, audio?: Blob, duration?: number) => Promise<void> }) {
  const [mode, setMode] = useState<VirtualMediaKind | '录音'>('录音');
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [blob, setBlob] = useState<Blob>();
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const epoch = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const cleanup = () => { epoch.current++; clearInterval(timer.current); if (recorder.current?.state === 'recording') recorder.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); };
  useEffect(() => () => cleanup(), []);
  useEffect(() => { cleanup(); setVisible(false); setBlob(undefined); setRecording(false); setSeconds(0); setText(''); }, [conversationId]);
  const start = async () => {
    setError(''); setBlob(undefined); setBusy(true);
    const token = ++epoch.current;
    let mic: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('当前环境不支持录音，请使用 HTTPS 浏览器并允许麦克风权限。');
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== epoch.current) { mic.getTracks().forEach(t => t.stop()); return; }
      stream.current = mic;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(mic, mimeType ? { mimeType } : undefined);
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        mic?.getTracks().forEach(t => t.stop()); clearInterval(timer.current);
        if (token !== epoch.current) return;
        setRecording(false);
        const result = new Blob(chunks, { type: rec.mimeType });
        if (result.size) setBlob(result); else setError('录音为空，请重试。');
      };
      rec.onerror = () => { cleanup(); setRecording(false); setError('录音中断，请重新录制。'); };
      rec.start(); setSeconds(0); setRecording(true);
      const started = performance.now();
      timer.current = setInterval(() => { const elapsed = (performance.now() - started) / 1000; setSeconds(elapsed); if (elapsed >= 120 && rec.state === 'recording') rec.stop(); }, 200);
    } catch (e) { mic?.getTracks().forEach(t => t.stop()); if (token === epoch.current) setError(e instanceof Error ? e.message : '无法访问麦克风'); }
    finally { if (token === epoch.current) setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError('');
    try { await onSend(mode === '录音' ? '[用户发送了一条真实语音]' : virtualMedia(mode, text), mode === '录音' ? blob : undefined, seconds); setText(''); setBlob(undefined); setVisible(false); }
    catch { setError('发送失败，内容已保留，请重试。'); }
    finally { setBusy(false); }
  };
  return <div className="px-3 py-1 text-xs text-slate-600">
    <button type="button" onClick={() => { if (visible) { cleanup(); setRecording(false); } setVisible(!visible); }} className="rounded-full border px-3 py-1 bg-white/80">语音 / 虚拟图片 / 视频</button>
    {visible && <div className="mt-2 rounded-2xl bg-white border p-3 space-y-3">
      <div className="flex flex-wrap gap-2">{(['录音', '语音', '图片', '视频'] as const).map(kind => <button type="button" disabled={recording || busy} key={kind} onClick={() => setMode(kind)} className={`px-2 py-1 rounded-lg ${mode === kind ? 'bg-amber-100' : 'bg-slate-100'}`}>{kind === '录音' ? '真实录音' : `虚拟${kind}`}</button>)}</div>
      {mode === '录音' ? <div className="space-y-2"><p>最长 120 秒 · {Math.floor(seconds)} 秒</p><button type="button" disabled={busy} onClick={() => recording ? recorder.current?.stop() : void start()} className="rounded-lg bg-slate-100 px-3 py-2">{recording ? '结束录音' : blob ? '重新录制' : '开始录音'}</button>{blob && <Preview blob={blob} />}</div> : <textarea value={text} maxLength={4000} onChange={e => setText(e.target.value)} placeholder={mode === '语音' ? '输入语音文字' : `描述${mode}里的内容`} className="w-full border rounded-lg p-2 text-sm" />}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <button type="button" disabled={busy || recording || (mode === '录音' ? !blob : !text.trim())} onClick={() => void send()} className="rounded-lg bg-amber-100 px-4 py-2 disabled:opacity-40">{busy ? '处理中…' : '发送'}</button>
    </div>}
  </div>;
}
function Preview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return <audio src={url} controls className="w-full" />;
}
