import { DB } from './db';
import type { Song } from '../context/MusicContext';
import { getOrAnalyzeSongSound, isSongListeningAvailable } from './songListening';
export async function shareSongToCharacter(charId: string, song: Song, note: string, listen: boolean) {
    let analysis = '', status = '未调用音频识别，不能据此声称已听过实际音频。';
    if (listen && isSongListeningAvailable()) {
        try { const value = await getOrAnalyzeSongSound(song); let parsed; try { parsed = JSON.parse(value); } catch { parsed = { description: value }; } analysis = parsed.description || ''; status = parsed.isTrial ? '仅分析了试听片段。' : '已取得歌曲客观声音分析。'; }
        catch { status = '本次音频识别失败，不能声称已经听过实际音频。'; }
    }
    await DB.saveMessage({ charId, role: 'user', type: 'text', content: `${note.trim() || '你去听听这首～'}\n【分享歌曲】《${song.name}》— ${song.artists}\n${status}${analysis ? '\n【歌曲客观声音分析，不代表你的主观感想】\n' + analysis : ''}`, metadata: { source: 'music-share', sharedSong: { ...song }, audioAnalyzed: !!analysis } });
}
