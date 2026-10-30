import type { Song } from '../../../context/MusicContext';
import { fetchSongAudio, audioBlobToPayload, describeAudioWithAudioApi, isAudioApiReady } from '../../../utils/audioApi';
import { loadAudioApiConfig, publishSongListenStatus } from '../../../utils/songListening';
import { loadMusicCfgStandalone } from '../../../context/MusicContext';

/**
 * 重新分析先返回候选，不写 DB。只有用户在音迹里点击「采用新版」才覆盖旧档案。
 */
export async function analyzeSongSoundPreview(song: Song): Promise<string> {
  const config = loadAudioApiConfig();
  if (!isAudioApiReady(config)) throw new Error('请先配置音频 API');
  publishSongListenStatus('⏳ 正在重新分析：' + song.name);
  const audio = await fetchSongAudio(song, loadMusicCfgStandalone(), config.songQuality || 'exhigh');
  const payload = await audioBlobToPayload(audio.blob, audio.nameHint);
  const description = await describeAudioWithAudioApi(payload, config);
  publishSongListenStatus('✅ 新分析已生成，等待用户确认：' + song.name);
  return JSON.stringify({
    songName: song.name,
    artists: song.artists,
    album: song.album,
    description,
    isTrial: audio.isTrial,
  });
}
