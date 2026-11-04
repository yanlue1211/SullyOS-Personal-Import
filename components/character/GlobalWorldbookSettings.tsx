import React from 'react';
import type { CharacterProfile, Worldbook } from '../../types';
import { worldbookScope } from '../../utils/worldbookScope';
export function GlobalWorldbookSettings({character,books,onChange}:{character:CharacterProfile;books:Worldbook[];onChange:(ids:string[])=>void}){
 const globals=books.filter(book=>worldbookScope(book)==='global');
 const excluded=new Set(character.disabledGlobalWorldbookIds || []);
 if(!globals.length)return null;
 return <details className="mb-3 rounded-2xl border border-emerald-100 bg-emerald-50/40" data-global-worldbooks>
  <summary className="cursor-pointer p-3 text-xs font-bold text-emerald-800">全局世界书 · 单独设置</summary>
  <div className="px-3 pb-3 space-y-2"><p className="text-[11px] text-slate-500">取消勾选后仅此角色不读取，不影响其他角色。全局未开启的条目不会自动生效。</p>
   {globals.map(book=><label key={book.id} className="flex items-center gap-2 rounded-xl bg-white p-2.5 text-xs text-slate-700"><input type="checkbox" aria-label={`为此角色启用全局世界书 ${book.title}`} checked={!excluded.has(book.id)} onChange={event=>{const next=new Set(excluded);if(event.target.checked)next.delete(book.id);else next.add(book.id);onChange([...next]);}} className="accent-emerald-600"/><span className="flex-1 break-words">{book.title}</span><span className="text-[10px] text-slate-400">{book.globalEnabled?(book.disable?'条目停用':'全局开启'):'全局未开启'}</span></label>)}
  </div>
 </details>;
}
