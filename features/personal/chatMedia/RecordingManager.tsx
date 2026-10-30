import React, { useEffect, useState } from 'react';
import { clearUserRecordings, listUserRecordings, type UserRecording } from './cleanup';
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
export default function RecordingManager({ charId, onClose, onChanged }: { charId?: string; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [all, setAll] = useState(!charId);
  const [rows, setRows] = useState<UserRecording[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true; setBusy(true); setConfirm(false); setSelected(new Set()); setRows([]); setError(''); setResult('');
    listUserRecordings(all ? undefined : charId).then(data => { if (active) setRows(data); }).catch(() => { if (active) setError('读取失败，请关闭后重试。'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [all, charId]);
  const chosen = rows.filter(row => selected.has(row.id));
  const clean = async () => {
    setBusy(true); setError('');
    try {
      const outcome = await clearUserRecordings(chosen);
      setResult(`已清理 ${outcome.cleared} 条录音，释放 ${size(outcome.freedBytes)}。${outcome.retainedFiles ? `另有 ${outcome.retainedFiles} 个文件被其他记录引用或暂未删除，已安全保留。` : ''}`);
      setRows(await listUserRecordings(all ? undefined : charId)); setSelected(new Set()); setConfirm(false);
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '清理失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="用户录音管理">
    <div className="bg-white text-slate-700 rounded-2xl p-4 w-full max-w-md max-h-[80vh] flex flex-col gap-3">
      <div className="flex justify-between items-center"><strong>用户录音管理</strong><button disabled={busy} onClick={onClose}>关闭</button></div>
      <p className="text-xs">只清理你录制的真实语音。聊天记录、已识别文字、角色语音和虚拟语音保留。清理后无法回放，可提前导出完整备份。</p>
      {charId && <label className="text-sm"><input type="checkbox" disabled={busy || confirm} checked={all} onChange={e => setAll(e.target.checked)} /> 所有角色的聊天（默认只看当前聊天）</label>}
      <p className="text-xs">共 {rows.length} 条 · {size(rows.reduce((n, row) => n + row.bytes, 0))}（共享文件可能重复计入）</p>
      <div className="flex gap-3 text-xs"><button disabled={busy || confirm} onClick={() => setSelected(new Set(rows.map(row => row.id)))}>全选</button><button disabled={busy || confirm} onClick={() => setSelected(new Set(rows.filter(row => row.description.trim()).map(row => row.id)))}>只选已识别</button><button disabled={busy || confirm} onClick={() => setSelected(new Set())}>取消选择</button></div>
      <div className="overflow-y-auto min-h-0 space-y-2">{rows.map(row => <label key={row.id} className="flex gap-2 border rounded-lg p-2 text-xs"><input type="checkbox" disabled={busy || confirm} checked={selected.has(row.id)} onChange={e => setSelected(prev => { const next = new Set(prev); e.target.checked ? next.add(row.id) : next.delete(row.id); return next; })} /><span><span className="block">{all && `${row.charName} · `}{new Date(row.timestamp).toLocaleString()} · {Math.ceil(row.duration)} 秒 · {size(row.bytes)}</span><span className="block mt-1">{row.transcript ? row.transcript.slice(0, 100) : row.description ? '已识别 · 未保存独立字幕' : '尚未识别：清理后将无法补做识别'}</span></span></label>)}{!busy && !rows.length && <p className="text-sm">没有可清理的用户录音。</p>}</div>
      {busy && <p role="status">处理中…</p>}{error && <p role="alert" className="text-red-600 text-xs">{error}</p>}{result && <p role="status" className="text-xs">{result}</p>}
      {confirm ? <div className="text-sm space-y-2"><p>确认清理已选 {chosen.length} 条录音？{chosen.some(row => !row.description.trim()) ? '包含未识别录音，声音内容将无法恢复。' : '已识别文字会保留。'}</p><div className="flex gap-4"><button disabled={busy} onClick={() => void clean()} className="rounded-lg bg-red-50 text-red-600 px-3 py-2">确认清理录音文件</button><button disabled={busy} onClick={() => setConfirm(false)}>取消</button></div></div> : <button disabled={busy || !chosen.length} onClick={() => setConfirm(true)} className="rounded-lg bg-amber-100 p-2 disabled:opacity-40">清理已选 {chosen.length} 条录音</button>}
    </div>
  </div>;
}
