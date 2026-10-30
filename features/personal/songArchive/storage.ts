import { DB } from '../../../utils/db';

/** 全角色共享的歌曲客观声音存档；复用糯米机已有 assets 表，因此无需提高主库版本。 */
export const SOUND_ARCHIVE_PREFIX = 'personal_song_sound_v1_';
export const LEGACY_SOUND_PREFIX = 'sully_song_sound_v1_';

export interface SongSoundRecord {
  songId: number;
  songName: string;
  artists: string;
  description: string;
  isTrial: boolean;
  album?: string;
  originalDescription?: string;
  updatedBy?: 'ai' | 'user';
  updatedAt: number;
}

const parseRecord = (songId: number, raw: string | null): SongSoundRecord | null => {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<SongSoundRecord>;
    if (typeof obj.description !== 'string' || !obj.description.trim()) return null;
    return {
      songId,
      songName: typeof obj.songName === 'string' ? obj.songName : String(songId),
      artists: typeof obj.artists === 'string' ? obj.artists : '',
      description: obj.description,
      isTrial: obj.isTrial === true,
      album: typeof obj.album === 'string' ? obj.album : undefined,
      originalDescription: typeof obj.originalDescription === 'string' ? obj.originalDescription : undefined,
      updatedBy: obj.updatedBy === 'user' ? 'user' : 'ai',
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
    };
  } catch { return null; }
};

export const getSongSoundRecord = async (songId: number): Promise<SongSoundRecord | null> => {
  const raw = await DB.getAsset(SOUND_ARCHIVE_PREFIX + songId);
  const existing = parseRecord(songId, raw);
  if (existing) return existing;
  // 从旧版本 localStorage 迁移：写入 IndexedDB 成功后才删旧值，以免断电/配额失败丢失档案。
  const oldKey = LEGACY_SOUND_PREFIX + songId;
  let legacy: string | null = null;
  try { legacy = localStorage.getItem(oldKey); } catch { return null; }
  const migrated = parseRecord(songId, legacy);
  if (!migrated) return null;
  await DB.saveAsset(SOUND_ARCHIVE_PREFIX + songId, JSON.stringify(migrated));
  try { localStorage.removeItem(oldKey); } catch { /* ignore */ }
  return migrated;
};

export const getSongSoundCache = async (songId: number): Promise<string> => {
  const record = await getSongSoundRecord(songId);
  return record ? JSON.stringify(record) : '';
};

export const saveSongSoundRecord = async (
  songId: number,
  value: string,
  info?: Pick<SongSoundRecord, 'updatedBy' | 'originalDescription'>,
): Promise<SongSoundRecord> => {
  const parsed = parseRecord(songId, value);
  if (!parsed) throw new Error('歌曲分析不能为空');
  const existing = await getSongSoundRecord(songId);
  const record: SongSoundRecord = {
    ...parsed,
    songId,
    originalDescription: info?.originalDescription ?? existing?.originalDescription ?? existing?.description ?? parsed.description,
    updatedBy: info?.updatedBy ?? 'ai',
    updatedAt: Date.now(),
  };
  await DB.saveAsset(SOUND_ARCHIVE_PREFIX + songId, JSON.stringify(record));
  window.dispatchEvent(new CustomEvent('personal-song-archive-updated', { detail: songId }));
  return record;
};

export const editSongSoundRecord = async (songId: number, description: string): Promise<void> => {
  const record = await getSongSoundRecord(songId);
  if (!record) throw new Error('未找到歌曲档案');
  await saveSongSoundRecord(songId, JSON.stringify({ ...record, description }), {
    updatedBy: 'user',
    originalDescription: record.originalDescription ?? record.description,
  });
};

export const deleteSongSoundRecord = async (songId: number): Promise<void> => {
  await DB.deleteAsset(SOUND_ARCHIVE_PREFIX + songId);
  try { localStorage.removeItem(LEGACY_SOUND_PREFIX + songId); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('personal-song-archive-updated', { detail: songId }));
};

export const listSongSoundRecords = async (): Promise<SongSoundRecord[]> => {
  const rows = await DB.getAllAssets();
  const byId = new Map<number, SongSoundRecord>();
  for (const row of rows) {
    if (!row.id.startsWith(SOUND_ARCHIVE_PREFIX)) continue;
    const id = Number(row.id.slice(SOUND_ARCHIVE_PREFIX.length));
    if (!Number.isFinite(id)) continue;
    const rec = parseRecord(id, row.data);
    if (rec) byId.set(id, rec);
  }
  // 一次扫描所有旧 localStorage 歌曲；无需要求用户逐首重放才能完成迁移。
  const legacyIds: number[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_SOUND_PREFIX)) {
        const id = Number(key.slice(LEGACY_SOUND_PREFIX.length));
        if (Number.isFinite(id)) legacyIds.push(id);
      }
    }
  } catch { /* ignore */ }
  for (const id of legacyIds) {
    if (byId.has(id)) continue;
    const rec = await getSongSoundRecord(id);
    if (rec) byId.set(id, rec);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
};
