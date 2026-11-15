import { encodeMonoWav } from '../personal/chatMedia/recording';

/** Match the successful browser recording: mono 48kHz, 16-bit PCM WAV.
 * Only creates an upload copy; never replaces the saved TTS sample.
 */
export async function prepareVoiceUpload(sample: Blob): Promise<Blob> {
    if (typeof OfflineAudioContext === 'undefined')
        throw Error('当前浏览器不支持音色音频转换，请换支持 Web Audio 的浏览器；尚未上传');
    try {
        const decoder = new OfflineAudioContext(1, 1, 48000);
        const decoded = await decoder.decodeAudioData(await sample.arrayBuffer());
        const frames = Math.ceil(decoded.duration * 48000);
        if (!Number.isFinite(frames) || frames < 1 || 44 + frames * 2 > 8 * 1024 * 1024)
            throw Error('朗读时长无效或转换后超过 8MB；尚未上传');
        const renderer = new OfflineAudioContext(1, frames, 48000);
        const source = renderer.createBufferSource();
        source.buffer = decoded;
        source.connect(renderer.destination);
        source.start();
        try {
            const audio = await renderer.startRendering();
            return encodeMonoWav(audio.getChannelData(0), 48000);
        } finally {
            source.disconnect();
            source.buffer = null;
        }
    } catch (error) {
        if (error instanceof Error && /尚未上传/.test(error.message)) throw error;
        throw Error('朗读音频转换失败，原音频保留，尚未上传');
    }
}
