import { DB } from '../../utils/db';
import { mergePlaylistSongs, updatePersonalPlaylists } from '../../utils/personalMusicLibrary';
import type { Song } from '../../context/MusicContext';
export async function addProducedSong(input: { taskId: string; title: string; charId: string; artist: string; lyrics: string; blob: Blob }): Promise<Song> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.taskId)));
    const id = -digest.slice(0, 6).reduce((n, b) => n * 256 + b, 0) - 1;
    const key = 'songwriting:haimian-audio:' + input.taskId;
    await DB.saveAssetRaw(key, { blob: input.blob, mimeType: input.blob.type });
    const song: Song = { id, name: input.title || '未命名歌曲', artists: input.artist, album: '一起写的歌', albumPic: '', duration: 0, fee: 0, local: true, localAssetKey: key, localMimeType: input.blob.type, customAuthorCharIds: [input.charId], localLyrics: input.lyrics };
    await updatePersonalPlaylists(lists => {
        const previous = lists.find(p => p.id === 'songwriting-produced'); const now = Date.now();
        if (previous) return lists.map(p => p.id === previous.id ? { ...p, songs: mergePlaylistSongs(p.songs, [song]), updatedAt: now } : p);
        return [...lists, { id: 'songwriting-produced', title: '一起写的歌', description: '', coverStyle: 'gradient-01', createdAt: now, updatedAt: now, songs: [song] }];
    });
    return song;
}
