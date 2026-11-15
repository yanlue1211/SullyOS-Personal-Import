import type { HaimianCredentials } from './production';
/** Fetch fresh media through the authenticated fixed-task adapter, avoiding native URL handoff. */
export async function fetchSongFile(taskId: string, credentials: HaimianCredentials): Promise<{ blob: Blob; extension: string }> {
    if (!credentials.token.trim() || !credentials.cookie.trim()) throw Error('请先填写海绵连接凭证');
    const response = await fetch('https://nuomi-haimian.yanlue.workers.dev/music/original-file', {
        method: 'POST', headers: { Authorization: 'Bearer ' + credentials.token, 'X-Haimian-Cookie': credentials.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ songTaskId: taskId }), cache: 'no-store', signal: AbortSignal.timeout(150000),
    });
    if (!response.ok) throw Error('成品下载失败，请重新获取；无需重新生成歌曲');
    const blob = await response.blob();
    if (!blob.size || blob.size > 64 * 1024 * 1024) throw Error('成品文件为空或超过 64MB');
    const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const text = String.fromCharCode(...bytes);
    const extension = text.startsWith('RIFF') && text.slice(8) === 'WAVE' ? 'wav' : text.startsWith('ID3') || bytes[0] === 255 && (bytes[1] & 224) === 224 ? 'mp3' : text.slice(4, 8) === 'ftyp' ? 'm4a' : '';
    if (!extension) throw Error('下载内容不是可识别的音频，未保存；无需重新生成');
    return { blob: new Blob([blob], { type: extension === 'wav' ? 'audio/wav' : extension === 'mp3' ? 'audio/mpeg' : 'audio/mp4' }), extension };
}
