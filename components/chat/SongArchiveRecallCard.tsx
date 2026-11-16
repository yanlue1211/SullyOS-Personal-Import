import React from 'react';
import type {Message} from '../../types';
export default function SongArchiveRecallCard({message}:{message:Message}) {
  return <details open className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-4 text-slate-700">
    <summary className="cursor-pointer text-sm font-medium text-emerald-800">♫ 音迹 · {message.metadata?.recallKind === 'artist' ? '歌手歌单' : '歌曲详情'}<span className="block mt-1 text-xs font-normal">{message.metadata?.recallTitle}</span></summary>
    <p className="whitespace-pre-wrap break-words text-xs leading-6 mt-3 max-h-64 overflow-y-auto">{message.content.split('\n').slice(1).join('\n')}</p>
  </details>;
}
