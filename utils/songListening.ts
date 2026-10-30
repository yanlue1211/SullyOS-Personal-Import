import type { AudioApiConfig, CharacterProfile, CharMusicReview, CharPlaylistSong } from '../types';
import { DB } from './db';
import { normalizeApiConfig } from './apiConfigNormalize';
import { neteaseCacheGet } from './neteaseCache';
import {
  audioBlobToPayload,
  fetchSongAudio,
  fetchSongLyrics,
  findSongListenReview,
  isAudioApiReady,
  listenToSongAsCharacter,
  saveSongListenReview,
  songListenReviewMode,
  SONG_LISTEN_REVIEW_PREFIX,
} from './audioApi';
import {
  loadLocalAlbumStandalone,
  loadMusicCfgStandalone,
  loadNeteaseUidStandalone,
  type Song,
} from '../context/MusicContext';

export type SongListenMode = 'together' | 'alone';

/** 听后感在多久内算「刚听完」，会在下一轮聊天注入给主模型。 */
export const RECENT_LISTEN_WINDOW_MS = 90 * 60 * 1000;

/** 角色自己挑歌重听时，旧日记多久以内直接沿用、不再重新调一次音频模型。 */
const ALONE_RELISTEN_REUSE_MS = 30 * 24 * 3600 * 1000;

export const loadAudioApiConfig = (): AudioApiConfig | null => {
  try {
    const raw = localStorage.getItem('os_api_config');
    if (!raw) return null;
    return normalizeApiConfig(JSON.parse(raw)).audioApi ?? null;
  } catch {
    return null;
  }
};

export const isSongListeningAvailable = (): boolean => isAudioApiReady(loadAudioApiConfig());

export interface SongListenOutcome {
  status: 'listened' | 'reused' | 'skipped' | 'failed';
  review?: CharMusicReview;
  isTrial?: boolean;
  error?: string;
}

export const publishSongListenStatus = (message: string) => {
  try {
    localStorage.setItem('sully_audio_listen_status', JSON.stringify({ message, at: Date.now() }));
    window.dispatchEvent(new CustomEvent('sully-audio-listen-status', { detail: message }));
  } catch { /* diagnostics must not interrupt listening */ }
};


/** 聊天面板上的独立开关，默认关闭；不影响原版一起听。 */
export const isRealSongListeningEnabled = (char: CharacterProfile | null | undefined): boolean =>
  !!(char as any)?.realSongListeningEnabled;

/** IndexedDB 存档由独立音迹模块负责，旧 localStorage 缓存首次读取时自动迁移。 */
export { getSongSoundCache } from '../features/personal/songArchive/storage';
import { getSongSoundCache, saveSongSoundRecord, getSongSoundRecord } from '../features/personal/songArchive/storage';

/** 同一歌曲正在识别时只调用一次，所有角色共享声音分析。 */
const soundInFlight = new Map<number, Promise<string>>();
export const getOrAnalyzeSongSound = (song: Song, force = false): Promise<string> => {
  const inflight = soundInFlight.get(song.id);
  if (inflight) return inflight;
  const task = (async () => {
    const cached = !force ? await getSongSoundCache(song.id) : '';
    if (cached) {
      publishSongListenStatus('✅ 已复用歌曲客观分析：' + song.name);
      return cached;
    }
    const config = loadAudioApiConfig();
    if (!isAudioApiReady(config)) throw new Error('音频 API 尚未配置完成');
    publishSongListenStatus('⏳ 正在获取歌曲音频：' + song.name);
    const cfg = loadMusicCfgStandalone();
    const audio = await fetchSongAudio(song, cfg, config.songQuality || 'exhigh');
    publishSongListenStatus('⏳ 已获取音频（' + (audio.blob.size / 1048576).toFixed(1) + 'MB），正在生成客观分析…');
    const { describeAudioWithAudioApi } = await import('./audioApi');
    const description = await describeAudioWithAudioApi(await audioBlobToPayload(audio.blob, audio.nameHint), config);
    const previous = await getSongSoundRecord(song.id);
    const record = {
      description,
      isTrial: audio.isTrial,
      songName: song.name,
      artists: song.artists,
      album: song.album,
    };
    const serialized = JSON.stringify(record);
    await saveSongSoundRecord(song.id, serialized, {
      ...(previous ? { originalDescription: previous.originalDescription } : {}),
      updatedBy: 'ai',
    });
    publishSongListenStatus('✅ 已保存歌曲客观分析：' + song.name);
    return serialized;
  })().catch(error => {
    publishSongListenStatus('❌ 歌曲客观分析失败：' + (error instanceof Error ? error.message : String(error)));
    throw error;
  }).finally(() => soundInFlight.delete(song.id));
  soundInFlight.set(song.id, task);
  return task;
};

/** 当前歌的客观声音内容在记忆召回附近的动态上下文中被注入。 */
export const buildCurrentSongSoundBlock = (song: Song, record: string): string => {
  try {
    const parsed = JSON.parse(record);
    return '\\n### 【当前播放歌曲的客观声音信息】\\n歌曲：' + song.name + ' — ' + song.artists
      + (parsed.isTrial ? '\\n注意：仅分析到了试听片段，不代表整首歌。' : '')
      + '\\n' + parsed.description
      + '\\n以上是歌曲本身的声音特征，不是你写的听歌日记，也不代表你的主观评价。无需每轮提起音乐；自然回应当前对话即可。\\n';
  } catch { return ''; }
};

const inFlight = new Map<string, Promise<SongListenOutcome>>();

/**
 * 让角色真的听一遍这首歌：取音频 + 歌词 → 带人设单独调用音频模型 → 写成听歌日记。
 * - together：只在这首歌第一次一起听时触发，已有日记直接跳过。
 * - alone：角色主动挑的；一个月内听过就沿用旧日记（刷新时间，让下一轮能带上）。
 */
export function startSongListen(charId: string, song: Song, mode: SongListenMode): Promise<SongListenOutcome> {
  const key = `${charId}:${song.id}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = runSongListen(charId, song, mode).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function runSongListen(charId: string, song: Song, mode: SongListenMode): Promise<SongListenOutcome> {
  const config = loadAudioApiConfig();
  if (!isAudioApiReady(config)) { publishSongListenStatus('⏭️ 未调用：音频 API 未开启或配置不完整'); return { status: 'skipped' }; }
  const [char, user] = await Promise.all([DB.getCharacter(charId), DB.getUserProfile()]);
  if (!char?.musicProfile || !user) { publishSongListenStatus('⏭️ 未调用：角色缺少音乐档案或用户资料'); return { status: 'skipped' }; }

  const cached = findSongListenReview(char, song.id);
  if (cached) {
    if (mode === 'together') { publishSongListenStatus('ℹ️ 这首歌已有听歌日记，已跳过重复调用'); return { status: 'skipped', review: cached }; }
    if (Date.now() - cached.createdAt < ALONE_RELISTEN_REUSE_MS) {
      const review = await saveSongListenReview(charId, song, cached.content, 'alone');
      return { status: 'reused', review: review ?? cached };
    }
  }

  try {
    publishSongListenStatus('⏳ 正在从播放器获取歌曲音频…');
    const cfg = loadMusicCfgStandalone();
    const [audio, lyrics] = await Promise.all([
      fetchSongAudio(song, cfg, config.songQuality || 'exhigh'),
      fetchSongLyrics(song, cfg),
    ]);
    publishSongListenStatus('⏳ 已获取音频（' + (audio.blob.size / 1048576).toFixed(1) + 'MB），正在调用音频模型…');
    const payload = await audioBlobToPayload(audio.blob, audio.nameHint);
    const content = await listenToSongAsCharacter({
      char, user, song, audio: payload, lyrics, isTrial: audio.isTrial, mode,
    }, config);
    const review = await saveSongListenReview(charId, song, content, mode);
    if (!review) { publishSongListenStatus('❌ 听歌分析完成，但保存日记失败：角色没有音乐档案'); return { status: 'failed', error: '角色没有音乐档案' }; }
    publishSongListenStatus('✅ 已成功调用音频模型并保存听歌日记：' + song.name);
    return { status: 'listened', review, isTrial: audio.isTrial };
  } catch (error: any) {
    publishSongListenStatus('❌ 听歌失败：' + (error?.message || String(error)));
    console.warn('[songListening] 听歌失败', error);
    return { status: 'failed', error: error?.message || String(error) };
  }
}

/** 下一轮注入：最近刚听完的歌和角色自己的听后感。 */
export function buildRecentListenBlock(char: CharacterProfile, userName: string, now = Date.now()): string {
  const reviews = (char.musicProfile?.reviews || [])
    .filter(r => r.targetType === 'song' && r.id.startsWith(SONG_LISTEN_REVIEW_PREFIX) && now - r.createdAt <= RECENT_LISTEN_WINDOW_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2);
  if (reviews.length === 0) return '';
  const lines = ['### 【你刚刚真的听过的歌】'];
  for (const review of reviews) {
    const how = songListenReviewMode(review) === 'together' ? `和 ${userName || '对方'} 一起` : '自己一个人';
    lines.push(`你${how}从头到尾听完了《${review.targetTitle}》。听完后你在听歌日记里写下：`);
    lines.push(review.content.split('\n').map(l => `  ${l}`).join('\n'));
  }
  lines.push(`（这些是你亲耳听到后的真实感受，聊起这首歌时以此为准，不要编造没听到的细节。想说就自然地说，不想说也不必特意提起，更不要每轮重复。）`);
  return `${lines.join('\n')}\n`;
}

export interface ListenCandidate {
  song: Song;
  origin: 'char' | 'user';
  /** 来源说明，给角色看的，例如「你的歌单《夜路》」 */
  label: string;
}

const playlistSongToSong = (s: CharPlaylistSong, localById: Map<number, Song>): Song =>
  localById.get(s.id) ?? {
    id: s.id, name: s.name, artists: s.artists, album: s.album, albumPic: s.albumPic, duration: s.duration, fee: s.fee,
  };

interface HomeSnapshotLite { playlists?: { id: number; name: string }[] }

/** 角色主动听歌的一个歌曲来源（角色的一个歌单 / 用户本地专辑 / 播放列表 / 一个网易云歌单）。 */
export interface ListenSource {
  key: string;
  origin: ListenCandidate['origin'];
  /** 设置页显示用，例如「《夜路》」 */
  title: string;
  /** 给角色看的来源说明 */
  label: string;
  songs: Song[];
}

/** 列出这个角色所有可选的听歌来源（不做过滤，设置页和候选收集共用）。 */
export async function listListenSources(char: CharacterProfile, userName: string): Promise<ListenSource[]> {
  const out: ListenSource[] = [];
  const localAlbum = loadLocalAlbumStandalone();
  const localById = new Map(localAlbum.map(s => [s.id, s]));
  const who = userName || '对方';

  for (const pl of char.musicProfile?.playlists || []) {
    out.push({
      key: `char:${pl.id}`, origin: 'char', title: `《${pl.title}》`, label: `你的歌单《${pl.title}》`,
      songs: pl.songs.map(s => playlistSongToSong(s, localById)),
    });
  }
  if (localAlbum.length) out.push({ key: 'user:local', origin: 'user', title: '本地专辑', label: `${who}的本地专辑`, songs: localAlbum });
  try {
    const raw = localStorage.getItem('sully_music_state_v1');
    const queue: Song[] = raw ? (JSON.parse(raw)?.queue || []) : [];
    if (queue.length) out.push({ key: 'user:queue', origin: 'user', title: '播放列表', label: `${who}的播放列表`, songs: queue });
  } catch { /* ignore */ }
  const uid = loadNeteaseUidStandalone();
  if (uid) {
    const home = await neteaseCacheGet<HomeSnapshotLite>(`home:${uid}`);
    for (const pl of home?.data?.playlists || []) {
      const hit = await neteaseCacheGet<Song[]>(`pl:${pl.id}`);
      if (!hit?.data?.length) continue;
      out.push({ key: `user:netease:${pl.id}`, origin: 'user', title: `《${pl.name}》`, label: `${who}的歌单《${pl.name}》`, songs: hit.data });
    }
  }
  return out;
}

/** 按角色的听歌设置筛来源：没选过 = 全部来源；选过 = 只用勾选的。 */
export function filterListenSources(sources: ListenSource[], selected?: string[]): ListenSource[] {
  if (!selected) return sources;
  const allow = new Set(selected);
  return sources.filter(s => allow.has(s.key));
}

/** 角色主动听歌是否开着（默认开）。 */
export const isListenSongEnabled = (char: CharacterProfile): boolean => char.listenSongConfig?.enabled !== false;

/** 角色能主动挑来听的歌：按设置筛过的来源，跨来源去重。 */
export async function collectListenCandidates(char: CharacterProfile, userName: string): Promise<ListenCandidate[]> {
  const sources = filterListenSources(await listListenSources(char, userName), char.listenSongConfig?.sources);
  const out: ListenCandidate[] = [];
  const seen = new Set<number>();
  for (const src of sources) {
    for (const song of src.songs) {
      if (!song?.id || !song.name || seen.has(song.id)) continue;
      seen.add(song.id);
      out.push({ song, origin: src.origin, label: src.label });
    }
  }
  return out;
}

const normalizeTitle = (value: string) => value.toLowerCase().replace(/[《》「」"'“”\s]/g, '');

/** 按角色写的「歌名」或「歌名 - 歌手」在候选里找歌；找不到返回 null（不允许听候选以外的歌）。 */
export function resolveListenCandidate(candidates: ListenCandidate[], query: string): ListenCandidate | null {
  const [rawName, rawArtist] = query.split(/\s+[-—–]\s+|\s*\|\s*/);
  const name = normalizeTitle(rawName || '');
  const artist = normalizeTitle(rawArtist || '');
  if (!name) return null;
  const byName = candidates.filter(c => normalizeTitle(c.song.name) === name);
  const pool = byName.length > 0 ? byName : candidates.filter(c => {
    const n = normalizeTitle(c.song.name);
    return n.includes(name) || name.includes(n);
  });
  if (pool.length === 0) return null;
  if (artist) {
    const withArtist = pool.find(c => normalizeTitle(c.song.artists).includes(artist));
    if (withArtist) return withArtist;
  }
  return pool.find(c => c.origin === 'char') ?? pool[0];
}

const GUIDE_CHAR_LIMIT = 15;
const GUIDE_USER_LIMIT = 15;

/** 候选超过上限时每轮随机抽一批，长歌单里靠后的歌也有机会被看到。 */
const sample = <T,>(items: T[], limit: number, rng: () => number): T[] => {
  if (items.length <= limit) return items;
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit);
};

/** 音频识别 API 开着时才注入：告诉角色可以挑一首歌真的去听。 */
export function buildListenSongGuide(candidates: ListenCandidate[], userName: string, rng: () => number = Math.random): string {
  if (candidates.length === 0) return '';
  const own = sample(candidates.filter(c => c.origin === 'char'), GUIDE_CHAR_LIMIT, rng);
  const theirs = sample(candidates.filter(c => c.origin === 'user'), GUIDE_USER_LIMIT, rng);
  const fmt = (c: ListenCandidate) => `《${c.song.name}》— ${c.song.artists}`;
  const lines = ['### 【戴上耳机】', `你可以挑一首歌真的去听（会从头听到尾，听完你会有自己的感受）。只能从你自己的歌单或 ${userName || '对方'} 的歌里挑：`];
  if (own.length) lines.push(`你的歌：${own.map(fmt).join('、')}`);
  if (theirs.length) lines.push(`${userName || '对方'} 的歌：${theirs.map(fmt).join('、')}`);
  lines.push('想听时在回复里单独写一行 `[[LISTEN_SONG:歌名]]`（重名可写 `[[LISTEN_SONG:歌名 - 歌手]]`），一条回复最多一首。只在你真的想听的时候用，不要每轮都听；对方在放的歌你已经能一起听了，不用再点。');
  return `${lines.join('\n')}\n`;
}
