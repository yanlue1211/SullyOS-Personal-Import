import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SongSheet } from '../../types';
import { useOS } from '../../context/OSContext';
import { mutateSong } from '../../features/songwriting/storage';
import { lyricFingerprint } from '../../features/songwriting/model';
import {
  askCharForMelody, getMelody, melodyToAbc,
  type MelodyProject, type MelodyVersion, type SongWithMelody,
} from '../../features/songwriting/melody';
import { describeMelodyWithAudioApi, songAudioToPayload } from '../../utils/audioApi';
import { loadAudioApiConfig } from '../../utils/songListening';
import './MelodyPanel.css';

interface Props {
  song: SongSheet;
  onUpdate: (song: SongSheet) => void;
}
type SoundFile = { versionId: string; blob: Blob; url: string };
const ABCJS_URL = 'https://cdn.jsdelivr.net/npm/abcjs@6.7.2/dist/abcjs-basic-min.js';
let abcScript: Promise<any> | undefined;
/** Version-pinned temporary prototype. Replace with a bundled dependency after mobile acceptance. */
function loadAbcjs(): Promise<any> {
  const existing = (window as any).ABCJS;
  if (existing?.renderAbc && existing?.synth?.CreateSynth) return Promise.resolve(existing);
  if (!abcScript) abcScript = new Promise((resolve, reject) => {
    const node = document.createElement('script');
    node.src = ABCJS_URL;
    node.async = true;
    node.onload = () => {
      const library = (window as any).ABCJS;
      library?.renderAbc && library?.synth?.CreateSynth ? resolve(library) : reject(Error('乐谱播放器未正确加载'));
    };
    node.onerror = () => reject(Error('无法加载 abcjs，请检查网络'));
    document.head.appendChild(node);
  }).catch(error => {
    abcScript = undefined; // allow a later manual retry
    throw error;
  });
  return abcScript;
}
function revoke(file: SoundFile | null) {
  if (file?.url) URL.revokeObjectURL(file.url);
}
function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 70) || '人声旋律';
}
export default function MelodyPanel({ song, onUpdate }: Props) {
  const os = useOS();
  const paper = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState('');
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [selected, setSelected] = useState<string>('');
  const [wav, setWav] = useState<SoundFile | null>(null);
  const [midi, setMidi] = useState<SoundFile | null>(null);
  const wavRef = useRef<SoundFile | null>(null);
  const midiRef = useRef<SoundFile | null>(null);
  const [abcReady, setAbcReady] = useState(false);
  const [showAbc, setShowAbc] = useState(false);
  const activeProject: MelodyProject | undefined = getMelody(song);
  const latest = activeProject?.versions.find(v => v.id === activeProject.activeId);
  const current = activeProject?.versions.find(v => v.id === selected) || latest;

  const setSound = (kind: 'wav' | 'midi', next: SoundFile | null) => {
    if (kind === 'wav') {
      revoke(wavRef.current); wavRef.current = next; setWav(next);
    } else {
      revoke(midiRef.current); midiRef.current = next; setMidi(next);
    }
  };
  useEffect(() => () => {
    controller.current?.abort();
    revoke(wavRef.current);
    revoke(midiRef.current);
  }, []);
  useEffect(() => {
    let alive = true;
    setAbcReady(false);
    if (!current || !paper.current) return;
    loadAbcjs().then(abc => {
      if (!alive || !paper.current) return;
      abc.renderAbc(paper.current, melodyToAbc(current, song.title), { responsive: 'resize', staffwidth: 540 });
      setAbcReady(true);
    }).catch(e => {
      if (alive) setError(e.message || '乐谱显示失败');
    });
    return () => { alive = false; };
  }, [current?.id, song.title]);

  const execute = async (label: string, action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(label); setError(''); setInfo('');
    try { await action(); }
    catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message || '操作失败，原谱已保留');
    }
    finally { locked.current = false; setBusy(''); }
  };
  const env = () => ({
    api: os.apiConfig, user: os.userProfile,
    context: { groups: os.groups || [], emojis: [], categories: [], realtimeConfig: os.realtimeConfig },
  });
  const create = (revise: boolean) => void execute(revise ? '角色正在调整旋律' : '角色正在谱曲', async () => {
    const source = revise ? latest : undefined;
    if (revise && !source) throw Error('请先完成第一版旋律');
    const lyricBase = lyricFingerprint(song.lines);
    controller.current = new AbortController();
    const result = await askCharForMelody(song, env(), controller.current.signal, source);
    if (!result.version) {
      setInfo(result.reply + '（角色决定保留当前旋律）');
      return;
    }
    const newVersion = result.version;
    const saved = await mutateSong(song.id, original => {
      if (lyricFingerprint(original.lines) !== lyricBase)
        throw Error('歌词已经在别处改动，请重新谱曲；原谱未覆盖');
      const before = getMelody(original);
      if (source ? before?.activeId !== source.id : !!before?.versions.length)
        throw Error('旋律版本已经在别处更新，请刷新后重新操作');
      return { song: { ...original, melody: {
        activeId: newVersion.id,
        versions: [...(before?.versions || []), newVersion],
      } } as SongWithMelody };
    });
    onUpdate(saved);
    setSelected(newVersion.id);
    setSound('wav', null);
    setSound('midi', null);
    setInfo(result.reply + '（已保存第 ' + getMelody(saved)!.versions.length + ' 版）');
  });
  const chooseVersion = (id: string) => void execute('切换旋律版本', async () => {
    if (!activeProject?.versions.some(v => v.id === id)) return;
    const saved = await mutateSong(song.id, original => {
      const p = getMelody(original);
      if (!p?.versions.some(v => v.id === id)) throw Error('旋律版本已发生变化');
      return { song: { ...original, melody: { ...p, activeId: id } } as SongWithMelody };
    });
    setSelected(id);
    onUpdate(saved);
    setSound('wav', null);
    setSound('midi', null);
  });
  /** A deliberate user click creates the WebAudio context (browser gesture requirement). */
  const synthesize = () => void execute('正在合成试听', async () => {
    if (!current) throw Error('请先谱曲');
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) throw Error('当前浏览器不支持 Web Audio');
    const audioContext: AudioContext = new AudioCtx();
    try {
      await audioContext.resume();
      const abc = await loadAbcjs();
      if (!abc.synth.supportsAudio()) throw Error('当前浏览器不支持 abcjs 音频合成');
      const elements = abc.renderAbc('*', melodyToAbc(current, song.title));
      if (!elements?.[0]) throw Error('乐谱无法演奏');
      const synth = new abc.synth.CreateSynth();
      const sounds = await synth.init({ visualObj: elements[0], audioContext, options: { chordsOff: true } });
      if (sounds?.error?.length) throw Error('部分钢琴音色加载失败，请检查网络');
      await synth.prime();
      // abcjs CreateSynth.download() returns a blob: URL, not a byte array.
      const temporaryUrl: string = synth.download();
      if (!temporaryUrl?.startsWith('blob:')) throw Error('abcjs 未返回有效 WAV 地址');
      let blob: Blob;
      try {
        const response = await fetch(temporaryUrl);
        if (!response.ok) throw Error('abcjs WAV 读取失败');
        blob = await response.blob();
      } finally { URL.revokeObjectURL(temporaryUrl); }
      if (blob.size < 44) throw Error('音频文件为空');
      setSound('wav', { versionId: current.id, blob, url: URL.createObjectURL(blob) });
      const binary = abc.synth.getMidiFile(elements[0], { midiOutputType: 'binary', chordsOff: true });
      if (binary) {
        const midiBlob = binary instanceof Blob ? binary : new Blob([binary], { type: 'audio/midi' });
        setSound('midi', { versionId: current.id, blob: midiBlob, url: URL.createObjectURL(midiBlob) });
      }
      setInfo('WAV / MIDI 已在糯米机页面准备好；钢琴演奏的是人声主旋律，不是伴奏。');
    } finally {
      await audioContext.close().catch(() => {});
    }
  });
  const listen = () => void execute('音频模型正在客观试听', async () => {
    if (!current) throw Error('请先谱曲');
    if (current.listening) {
      setInfo('这版旋律已经分析过，直接复用已保存的客观描述，不重复调用音频 API。');
      return;
    }
    if (wav?.versionId !== current.id) throw Error('请先点击「合成试听」，准备当前版本的 WAV');
    const config = loadAudioApiConfig();
    if (!config?.enabled) throw Error('请先在总设置配置并开启独立的音频识别 API');
    const payload = await songAudioToPayload(wav.blob, 'melody.wav');
    const report = await describeMelodyWithAudioApi(payload, config);
    const saved = await mutateSong(song.id, original => {
      const p = getMelody(original);
      if (!p?.versions.some(v => v.id === current.id)) throw Error('旋律版本已发生变化，未写入试听');
      return { song: { ...original, melody: { ...p, versions: p.versions.map(v =>
        v.id === current.id ? { ...v, listening: v.listening || report } : v,
      ) } } as SongWithMelody };
    });
    onUpdate(saved);
    setInfo('客观声音描述已保存；角色下一轮调整旋律时可阅读这份分析。');
  });
  return (
    <section className="sw-melody" aria-label="自主谱曲">
      <h3>🎼 角色自主谱曲 · 八小节试验</h3>
      <p className="sw-note">角色自己写人声旋律的音符。abcjs 只负责绘谱和演奏；音频模型只描述声音，不替角色修改。</p>
      <p className="sw-note">首轮暂限 C 大调、4/4 拍、八小节。每轮修订只改指定小节，保留之前的版本。</p>
      <div className="sw-melody-actions">
        {!latest ? <button className="sw-primary" disabled={!!busy} onClick={() => create(false)}>让角色谱第一版</button>
          : <button className="sw-primary" disabled={!!busy} onClick={() => create(true)}>让角色决定是否调整旋律</button>}
        {busy && <button onClick={() => controller.current?.abort()}>取消本轮</button>}
      </div>
      {!!activeProject?.versions.length && <label className="sw-melody-select">作品版本
        <select value={current?.id || ''} disabled={!!busy} onChange={e => setSelected(e.target.value)}>
          {activeProject.versions.map((v, index) =>
            <option key={v.id} value={v.id}>第 {index + 1} 版 · {v.bpm} BPM{v.id === activeProject.activeId ? ' · 当前' : ''}</option>)}
        </select>
        {current && current.id !== activeProject.activeId &&
          <button disabled={!!busy} onClick={() => chooseVersion(current.id)}>使用这一版继续创作</button>}
      </label>}
      {current && <>
        <div className="sw-melody-paper" ref={paper} aria-label="人声主旋律五线谱" />
        {!abcReady && <p className="sw-note">正在准备乐谱显示，需要加载一次 abcjs…</p>}
        <details className="sw-melody-source" open={showAbc} onToggle={e => setShowAbc((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>查看 / 复制 ABC 乐谱</summary>
          <pre>{melodyToAbc(current, song.title)}</pre>
        </details>
        <div className="sw-melody-actions">
          <button disabled={!!busy} onClick={synthesize}>▶ 合成试听 · WAV / MIDI</button>
        </div>
        {wav?.versionId === current.id && <div className="sw-melody-player">
          <audio controls preload="metadata" src={wav.url}/>
          <a href={wav.url} download={safeFileName(song.title) + '-人声主旋律.wav'}>下载 WAV</a>
          {midi?.versionId === current.id &&
            <a href={midi.url} download={safeFileName(song.title) + '-旋律.mid'}>下载 MIDI</a>}
          <p className="sw-note">这些是糯米机内部的本地音频链接，不是永久公开直链。以后可以直接将 WAV Blob 交给海绵上传适配层。</p>
        </div>}
        <div className="sw-melody-listen">
          <button disabled={!!busy || !!current.listening || wav?.versionId !== current.id} onClick={listen}>
            {current.listening ? '这版已听过 · 复用描述' : '🎧 让音频 API 客观试听一次'}
          </button>
          {current.listening ? <details open><summary>本版实际听感（客观描述）</summary><pre>{current.listening}</pre></details> :
            <p className="sw-note">试听消耗独立音频 API 额度；只在点击时调用，同一版本不会重复分析。</p>}
        </div>
      </>}
      {info && <p role="status" className="sw-melody-info">{info}</p>}
      {error && <p role="alert" className="sw-error">{error}</p>}
      {busy && <p role="status">{busy}…</p>}
    </section>
  );
}
