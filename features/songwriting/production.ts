import type { SongSheet } from '../../types';
import type { StudioEnvironment } from './generate';
import { DB } from '../../utils/db';
import { loadCharacterContextRange } from '../../utils/chatContextRange';
import { buildChatRequestPayload } from '../../utils/chatRequestPayload';
import { resolveDialogueApi, dialogueMaxTokens } from '../../utils/characterApi';
import { safeFetchJson, extractContent } from '../../utils/safeApi';
import { lyricsText } from './model';
export interface SongProduction {
    vision: string;
    prompt: string;
    basedOn?: string;
    taskHistory?: NonNullable<SongProduction["task"]>[];
    task?: {
        id: string;
        state: 'submitting' | 'unknown' | 'processing' | 'complete' | 'failed';
        lyrics: string;
        prompt: string;
        title: string;
        voiceId: string;
        mediaUrl?: string;
        completionRecorded?: boolean;
    };
}
export const productionFingerprint = (song: SongSheet) => JSON.stringify([song.title, song.genre, song.mood, lyricsText(song.lines), song.production?.vision || '']);
export async function generateProductionText(song: SongSheet, env: StudioEnvironment, signal: AbortSignal, kind: 'vision' | 'prompt') {
    const char = await DB.getCharacter(song.collaboratorId);
    if (!char)
        throw Error('创作伙伴已不存在');
    const api = resolveDialogueApi(env.api, char);
    if (!api.baseUrl || !api.model)
        throw Error('请先配置角色聊天 API');
    const range = await loadCharacterContextRange(char);
    const payload = await buildChatRequestPayload({ ...env.context, char, userProfile: env.user, historyMsgs: range.messages, contextLimit: Math.max(1, range.messages.length), contextHighWaterMark: range.hwm, recallEntryPoint: 'chat_app', recallQueryHint: song.title, signal, visionApiConfig: api.visionApi, appPrompt: {
            rules: kind === 'vision' ? '你正在与 user 共同写歌。沿用自己的审美、双方可读讨论与已确认歌词，用自然文字填写这首歌想表达什么、曲风、情绪变化、编曲和唱法。不要限定于预设标签，不编造双方现实经历，不修改歌词。只输出创作设想正文，最多1000字。' : '将当前歌曲与可读讨论整理成海绵原创音乐生成说明。这是音乐制作任务，不是记忆总结。忠实保留双方确定的创作意图，自由设想优先于默认标签；具体写明曲风、情绪走向、速度、乐器、唱法、段落变化。使用所选音色的自然音区，避免不必要的夸张高音与重混响。不加入翻唱、参考原曲或固定降调要求。不改写或重复歌词，不输出歌名、JSON、心声、解释或未确认故事，只输出不超过1600字的制作说明。',
            scene: JSON.stringify({ title: song.title, genre: song.genre, mood: song.mood, vision: song.production?.vision || '', lyrics: lyricsText(song.lines) })
        } });
    const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` }, body: JSON.stringify({ model: api.model, messages: payload.fullMessages, max_tokens: dialogueMaxTokens(api), temperature: api.temperature ?? 0.8, stream: false }) }, 0, 0, { appName: '写歌', charId: char.id, charName: char.name, purpose: kind === 'vision' ? '创作设想' : '整理海绵创作说明' });
    signal.throwIfAborted();
    const text = extractContent(data).trim();
    if (data?.choices?.[0]?.finish_reason === 'length' || !text || text.length > (kind === 'vision' ? 3000 : 2000))
        throw Error('生成内容为空、过长或被截断，原内容已保留');
    return text;
}
export interface HaimianCredentials {
    token: string;
    cookie: string;
}
const endpoint = 'https://nuomi-haimian.yanlue.workers.dev';
export async function haimianCall(path: string, credentials: HaimianCredentials, data?: object) {
    if (!credentials.token.trim() || !credentials.cookie.trim())
        throw Error('请先填写海绵连接密钥与 Cookie');
    const response = await fetch(endpoint + path, { method: 'POST', headers: { Authorization: 'Bearer ' + credentials.token, 'X-Haimian-Cookie': credentials.cookie, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), cache: 'no-store', signal: AbortSignal.timeout(90000) });
    const result = await response.json();
    if (!response.ok || result.error)
        throw Error([result.error, result.businessCode, result.businessHint, result.note].filter(Boolean).join(' · ') || '海绵请求失败');
    return result;
}
