import React from 'react';
import type { ResponseStatus } from './protocol';
export default function ResponseStatusCard({ value }: { value: ResponseStatus }) {
  const read = value.kind === 'read';
  return <section aria-label={read ? '已读不回' : '忙碌状态'} className={`sully-response-status w-[min(76vw,290px)] max-w-full rounded-[22px] border p-5 shadow-sm ${read ? 'border-rose-900/20 bg-gradient-to-br from-[#27232a] to-[#39292e] text-rose-50' : 'border-amber-200/70 bg-gradient-to-br from-[#fffcf4] to-[#f6f0e3] text-stone-700'}`}>
    <div className="flex items-center gap-2.5"><span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${read ? 'bg-rose-400' : 'bg-amber-500'}`} /><span className="text-sm font-medium">{read ? '消息已读，暂时留白' : '此刻不方便看手机'}</span></div>
    <p className={`mt-2 text-[11px] ${read ? 'text-rose-100/50' : 'text-stone-400'}`}>{read ? '看见了，也允许有不说话的时候' : '正在忙自己的事情'}</p>
    {read ? <details className="mt-4 text-xs" onClick={event => event.stopPropagation()}><summary className="cursor-pointer text-rose-200/80">看看此刻的心情</summary><p className="mt-3 whitespace-pre-wrap break-words rounded-xl border-l-2 border-rose-400/60 bg-white/5 p-3 leading-6">{value.reason}</p></details> : <div className="mt-4 rounded-xl bg-white/70 p-3"><p className="whitespace-pre-wrap break-words text-xs leading-6">{value.reason}</p><p className="mt-2 text-[11px] text-stone-400">预计有空：{value.eta}</p></div>}
    <p className={`mt-4 rounded-xl px-3 py-2.5 text-center text-[11px] whitespace-pre-wrap break-words ${read ? 'bg-black/10 text-rose-100/45' : 'bg-stone-900/[0.025] text-stone-400'}`}>{value.footer}</p>
  </section>;
}
