import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, MagnifyingGlass, MusicNotes, ArrowClockwise, PencilSimple, Trash, Check, X, FloppyDisk } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { type Song } from '../context/MusicContext';
import { isSongListeningAvailable } from '../utils/songListening';
import {
  deleteSongSoundRecord,
  editSongSoundRecord,
  listSongSoundRecords,
  type SongSoundRecord,
} from '../features/personal/songArchive/storage';

const SongArchiveApp: React.FC = () => {
  const { closeApp } = useOS();
  const [rows, setRows] = useState<SongSoundRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [candidate, setCandidate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try { setRows(await listSongSoundRecords()); }
    catch (error) { setNotice('读取档案失败：' + String(error)); }
  }, []);
  useEffect(() => {
    void refresh();
    const handler = () => { void refresh(); };
    window.addEventListener('personal-song-archive-updated', handler);
    return () => window.removeEventListener('personal-song-archive-updated', handler);
  }, [refresh]);

  const visible = useMemo(() => rows.filter(row =>
    (row.songName + ' ' + row.artists).toLocaleLowerCase().includes(query.toLocaleLowerCase())
  ), [rows, query]);
  const active = rows.find(row => row.songId === selected) || null;

  const open = (row: SongSoundRecord) => {
    setSelected(row.songId);
    setEditing(false);
    setDraft(row.description);
    setCandidate(null);
    setNotice('');
  };
  const edit = async () => {
    if (!active || !draft.trim()) return;
    setBusy(true);
    try {
      await editSongSoundRecord(active.songId, draft.trim());
      setEditing(false);
      setNotice('修改已保存，所有角色下次听歌都将读取新版本。');
      await refresh();
    } catch (error) { setNotice('保存失败：' + String(error)); }
    finally { setBusy(false); }
  };
  const regenerate = async () => {
    if (!active || busy) return;
    if (!isSongListeningAvailable()) { setNotice('请先到设置配置并启用音频 API。'); return; }
    setBusy(true); setCandidate(null); setNotice('正在重新获取歌曲音频并分析，旧内容会先保留。');
    try {
      const song: Song = {
        id: active.songId, name: active.songName, artists: active.artists,
        album: active.album || '', albumPic: '', duration: 0,
      } as Song;
      const { analyzeSongSoundPreview } = await import('../features/personal/songArchive/reanalysis');
      const result = await analyzeSongSoundPreview(song);
      setCandidate(result);
      setNotice('新分析已生成，但尚未覆盖旧档案。你可以先比较，再决定是否采用。');
    } catch (error) { setNotice('重新分析失败，旧档案未改变：' + String(error)); }
    finally { setBusy(false); }
  };
  const accept = async () => {
    if (!active || !candidate) return;
    setBusy(true);
    try {
      const { saveSongSoundRecord } = await import('../features/personal/songArchive/storage');
      await saveSongSoundRecord(active.songId, candidate, { updatedBy: 'ai' });
      setCandidate(null);
      setNotice('新分析已采用并保存。');
      await refresh();
    } catch (error) { setNotice('保存失败：' + String(error)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!active || busy || !window.confirm('确定删除《' + active.songName + '》的歌曲分析吗？删除后可能需要重新调用音频 API。')) return;
    setBusy(true);
    try {
      await deleteSongSoundRecord(active.songId);
      setSelected(null); setNotice('档案已删除。');
      await refresh();
    } catch (error) { setNotice('删除失败：' + String(error)); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#faf8f4] text-[#554b43]">
      <div className="px-5 pt-7 pb-4 flex items-center gap-3 border-b border-[#efe7df] bg-white/90">
        <button type="button" aria-label={active ? '返回档案列表' : '返回桌面'} onClick={() => active ? (setSelected(null), setCandidate(null), setEditing(false), setNotice('')) : closeApp()} className="p-2 -ml-2 rounded-full active:bg-[#f4eee8]"><ArrowLeft size={22}/></button>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-lg truncate">{active ? active.songName : '音迹'}</div>
          <div className="text-xs text-[#9b8d82]">{active ? active.artists : '全角色共享 · 歌曲声音档案馆'}</div>
        </div>
        <MusicNotes size={25} className="text-[#c68f6d]"/>
      </div>

      {notice && <div role="status" className="mx-4 mt-3 p-3 rounded-xl bg-[#fff1dd] text-[#87613e] text-xs leading-relaxed">{notice}</div>}

      {!active ? (
        <div className="overflow-y-auto min-h-0 flex-1 px-5 pb-10">
          <div className="mt-6 rounded-3xl p-6 text-white bg-gradient-to-br from-[#d7a98a] to-[#9f8a9b] shadow-lg">
            <div className="text-sm opacity-80">MY SOUND ARCHIVE</div>
            <div className="text-3xl font-bold mt-2">{rows.length} <span className="text-sm font-normal">首已存档</span></div>
            <div className="text-xs opacity-85 mt-2">同一首歌分析一次，所有角色都能感知它的声音。</div>
          </div>
          <div className="relative mt-5">
            <MagnifyingGlass size={18} className="absolute top-3.5 left-4 text-[#aa9e92]"/>
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索歌曲名称或歌手" className="w-full bg-white rounded-2xl border border-[#eee4db] py-3 pl-11 pr-4 outline-none focus:border-[#c99b7b] text-sm"/>
          </div>
          <div className="mt-5 space-y-3">
            {visible.map(row => (
              <button type="button" key={row.songId} onClick={()=>open(row)} className="w-full text-left rounded-2xl border border-[#eee7e0] bg-white p-4 shadow-sm active:scale-[.99] transition-transform">
                <div className="flex gap-3 items-center">
                  <div className="w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center bg-[#f8ede3] text-[#c58c6e]"><MusicNotes size={24}/></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{row.songName}</div>
                    <div className="text-xs text-[#9e9187] mt-1 truncate">{row.artists || '未知歌手'}</div>
                  </div>
                  <span className="text-xs text-[#bca89a]">›</span>
                </div>
                <div className="flex gap-2 mt-3 text-[11px]">
                  <span className="rounded-full px-2 py-1 bg-[#f7f1e9]">{row.isTrial ? '试听片段' : '完整分析'}</span>
                  {row.updatedBy === 'user' && <span className="rounded-full px-2 py-1 bg-emerald-50 text-emerald-700">已手动编辑</span>}
                </div>
              </button>
            ))}
            {!visible.length && <div className="text-center text-[#aaa095] text-sm pt-14">{rows.length ? '没有找到这首歌' : '还没有声音档案。开启真实听歌播放歌曲后，就会在这里收藏它。'}</div>}
          </div>
        </div>
      ) : (
        <div className="overflow-y-auto min-h-0 flex-1 p-5 pb-12">
          <div className="rounded-3xl bg-white border border-[#eee4dd] p-5 shadow-sm">
            <div className="flex gap-2 text-xs mb-3">
              <span className="rounded-full px-3 py-1 bg-[#f7f1e9]">{active.isTrial ? '⚠ 仅试听片段' : '✓ 音频分析'}</span>
              <span className="rounded-full px-3 py-1 bg-[#f7f1e9]">{active.updatedBy === 'user' ? '用户修改版' : 'AI 生成'}</span>
            </div>
            {editing ? (
              <textarea aria-label="编辑歌曲分析" className="w-full min-h-72 border border-[#e8d9cc] rounded-xl p-3 text-sm leading-7 outline-none" value={draft} onChange={e=>setDraft(e.target.value)}/>
            ) : <div className="text-sm leading-8 whitespace-pre-wrap break-words">{active.description}</div>}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            {editing ? (
              <>
                <button type="button" disabled={busy || !draft.trim()} onClick={()=>void edit()} className="rounded-2xl bg-[#b88971] text-white py-3 font-semibold flex gap-2 justify-center items-center disabled:opacity-50"><FloppyDisk size={18}/>保存修改</button>
                <button type="button" onClick={()=>{setEditing(false);setDraft(active.description)}} className="rounded-2xl bg-white border py-3 flex justify-center items-center gap-2"><X size={18}/>取消</button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={()=>{setEditing(true);setDraft(active.description)}} className="rounded-2xl bg-white border border-[#e5d5ca] py-3 font-semibold flex gap-2 justify-center items-center"><PencilSimple size={18}/>编辑内容</button>
                <button type="button" disabled={busy} onClick={()=>void regenerate()} className="rounded-2xl bg-[#b88971] text-white py-3 font-semibold flex gap-2 justify-center items-center disabled:opacity-50"><ArrowClockwise size={18} className={busy?'animate-spin':''}/>{busy ? '分析中…' : '重新分析'}</button>
              </>
            )}
          </div>

          {candidate && (
            <div className="mt-5 rounded-3xl bg-[#edf6ed] border border-[#cee4cd] p-5">
              <div className="font-bold mb-3">🎧 新分析预览（尚未覆盖）</div>
              <div className="whitespace-pre-wrap text-sm leading-7">{(() => {try {return JSON.parse(candidate).description || ''}catch{return ''}})()}</div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button type="button" onClick={()=>void accept()} disabled={busy} className="bg-[#42876a] text-white py-3 rounded-2xl font-semibold flex items-center justify-center gap-2"><Check size={18}/>采用新版</button>
                <button type="button" onClick={()=>{setCandidate(null);setNotice('已保留原有分析。')}} className="bg-white py-3 rounded-2xl font-semibold">保留旧版</button>
              </div>
            </div>
          )}
          {active.originalDescription && active.originalDescription !== active.description && (
            <details className="mt-5 p-4 rounded-2xl bg-white border border-[#eee4dd] text-xs">
              <summary className="cursor-pointer font-semibold">查看最早保存的分析</summary>
              <div className="mt-3 whitespace-pre-wrap leading-6">{active.originalDescription}</div>
            </details>
          )}
          <button type="button" onClick={()=>void remove()} disabled={busy} className="mt-8 mb-4 w-full rounded-2xl border border-rose-200 bg-rose-50 text-rose-600 py-3 flex items-center gap-2 justify-center"><Trash size={18}/>删除这首歌的声音档案</button>
        </div>
      )}
    </div>
  );
};
export default SongArchiveApp;
