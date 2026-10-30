import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkle, X, CaretRight } from '@phosphor-icons/react';
import type { InnerVoice } from './protocol';
export default function InnerVoiceChip({ value, dark = false }: { value?: InnerVoice; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [open]);
  if (!value) return null;
  return <div className="my-2"><button type="button" aria-expanded={open} onClick={event => { event.stopPropagation(); setOpen(true); }} className={`inline-flex gap-2 items-center rounded-full px-3 py-1.5 border text-xs ${dark ? 'border-white/10 bg-white/5 text-white/60' : 'border-slate-200/80 bg-white/70 text-slate-500'}`}><Sparkle size={13} /><span>心声</span><CaretRight size={11} /></button>
    {open && createPortal(<div role="dialog" aria-modal="true" aria-label="角色心声" onTouchStart={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()} className="fixed inset-0 z-[650] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-3" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}><section className="bg-[#fcfbf8] text-slate-700 rounded-3xl p-6 w-full max-w-md max-h-[78vh] overflow-y-auto"><header className="flex justify-between items-center mb-6"><span className="text-sm tracking-widest">此刻心声</span><button aria-label="关闭心声" onClick={() => setOpen(false)} className="p-2 text-slate-400"><X size={18} /></button></header>{[['此刻', value.state], ['心里', value.thoughts], ...(value.undercurrent ? [['暗流', value.undercurrent]] : [])].map(([label, text]) => <div key={label} className="mb-5 last:mb-0"><h4 className="text-[11px] tracking-widest text-slate-400 mb-2">{label}</h4><p className="text-sm leading-7 whitespace-pre-wrap break-words" style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}>{text || '—'}</p></div>)}</section></div>, document.body)}
  </div>;
}
