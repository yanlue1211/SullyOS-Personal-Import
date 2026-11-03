import { loadMusicCfgStandalone, musicApi, toHttps, type Song } from '../context/MusicContext';

/** Search is an action, never evidence of what the user is currently listening to. */
export function buildSongSearchGuide(): string {
  return '\n### 【主动搜索点歌工具】\n你想主动放一首歌时，可以调用 `[[LISTEN_SONG:歌名 | 歌手]]`（歌手可省略）。系统会去网易云搜索匹配歌曲，再尝试在共享播放器播放；每轮最多一首。不局限于任何人的收藏或歌单。只在确实想点歌时使用。\n搜索意图、搜索结果和收藏均不代表用户正在听歌。执行前只能说想点播，不能声称已经播放成功或用户已经在听；是否正在播放、播放哪首，以本轮实时播放器状态为准。这个工具不提供歌词、音频或听后感；真实音频分析另由用户开关控制。\n';
}

const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

export async function searchNeteaseSong(query: string): Promise<Song | null> {
  const [title, artist = ''] = query.trim().slice(0, 200).split(/\s*\|\s*|\s+[-—–]\s+/);
  if (!title?.trim()) return null;
  const response = await musicApi.search(loadMusicCfgStandalone(), [title, artist].filter(Boolean).join(' '));
  const songs = response?.result?.songs;
  if (!Array.isArray(songs)) return null;
  for (const raw of songs) {
    if (!Number.isSafeInteger(raw?.id) || raw.id <= 0 || typeof raw.name !== 'string') continue;
    const artists = (raw.ar || raw.artists || []).map((a: {name?: string}) => a.name || '').filter(Boolean);
    if (normalize(raw.name) !== normalize(title)) continue;
    if (artist && !artists.some((name: string) => normalize(name) === normalize(artist))) continue;
    return {
      id: raw.id, name: raw.name, artists: artists.join(' / '),
      album: raw.al?.name || raw.album?.name || '',
      albumPic: toHttps(raw.al?.picUrl || raw.album?.picUrl || ''),
      duration: (raw.dt || raw.duration || 0) / 1000, fee: raw.fee ?? 0,
    };
  }
  return null;
}
