import { C } from './MusicUI';
import React, { useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import type { Song } from '../../context/MusicContext';
import { shareSongToCharacter } from '../../utils/musicShare';
import { isSongListeningAvailable } from '../../utils/songListening';
export default function ShareSongPanel({ song, onClose }: { song: Song; onClose: () => void }) {
    const { characters, addToast } = useOS();
    const [charId, setCharId] = useState(''), [note, setNote] = useState('你去听听这首～'), [listen, setListen] = useState(isSongListeningAvailable), [busy, setBusy] = useState(false);
    const lock = useRef(false);
    return <div role="dialog" aria-label="分享歌曲给角色" className="rounded-2xl p-4 bg-white/80 space-y-4 text-sm"><p>分享《{song.name}》给谁？</p><div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto">{characters.map(c => <button className="rounded-xl px-3 py-3 text-left border transition-colors" style={{background:charId===c.id?C.soft:C.bg,borderColor:charId===c.id?C.accent:"transparent",color:C.primary}} disabled={busy} key={c.id} aria-pressed={charId === c.id} onClick={() => setCharId(c.id)}>{c.name}{charId === c.id ? ' ✓' : ''}</button>)}</div><textarea aria-label="分享时想说的话" className="w-full border-0 rounded-xl p-3 bg-[#f3f1fa]" rows={3} placeholder="想对 TA 说点什么？" value={note} onChange={e => setNote(e.target.value)} maxLength={2000}/><label className="flex items-start gap-2 text-xs leading-5" style={{color:C.muted}}><input type="checkbox" checked={listen} disabled={busy || !isSongListeningAvailable()} onChange={e => setListen(e.target.checked)}/> 使用已配置的听歌识别（可能消耗音频 API 额度）</label><div className="flex gap-3 justify-end"><button className="rounded-xl px-4 py-2" disabled={busy} onClick={onClose}>取消</button><button className="rounded-xl px-4 py-2 disabled:opacity-40" style={{background:C.soft,color:C.primary}} disabled={!charId || busy} onClick={async () => { if (lock.current) return; lock.current = true; setBusy(true); try { await shareSongToCharacter(charId, song, note, listen); addToast('已分享到角色聊天', 'success'); onClose(); } catch { addToast('分享失败，请重试', 'error'); } finally { lock.current = false; setBusy(false); } }}> {busy ? '正在分享…' : '分享给角色'}</button></div></div>;
}
