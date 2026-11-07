/**
 * 关闭 2.0 的角色保留作者原版「离开后消息」：切回前台时，
 * 超过等待时长就用一次本地 API 生成最多三段、时间戳分散在离开期间；
 * 同一段离开只补一次。不要让个人版 B 循环节拍覆盖这里。
 *
 * 核心生成流程移自 qegj567-cloud/SullyOS utils/awayMessage.ts，
 * 只对 API 地址兼容及个人版线下状态守卫作最小适配。
 */
import type { CharacterProfile } from '../types';
import type { LocalAwayDeps } from './awayMessage';
import { DB } from './db';
import { findAwayGapStart, planAwaySlots, resolveAwayDelayMinutes, splitAwaySegments } from './awayMessageCore';
import { resolveAmsgInteractionLock, isAmsgActiveCall, isAmsgActiveDate } from './amsgInteractionGuard';
import { loadCharacterContextRange } from './chatContextRange';
import { ChatPrompts } from './chatPrompts';
import { buildChatRequestPayload } from './chatRequestPayload';
import { applyAssistantPostProcessing } from './applyAssistantPostProcessing';
import { resolveDialogueApi } from './characterApi';
import { normalizeChatApiUrl } from './amsgLlmCredentials';
import { extractContent, safeFetchJson } from './safeApi';
import { buildNativeLocalAwayHint } from './awayMessageNativePrompt';
import { loadMusicPlaybackSnapshot } from '../context/MusicContext';

export const generateNativeLocalAwayMessages = async (char: CharacterProfile, deps: LocalAwayDeps): Promise<void> => {
  const delayMs = resolveAwayDelayMinutes(char) * 60_000;
  const now = Date.now();
  const recent = await DB.getRecentMessagesByCharId(char.id, 50, true);
  // 历史与静默规则遵循作者原生本地模式；仍尊重个人版持久化线下/通话保护。
  if (resolveAmsgInteractionLock(recent, isAmsgActiveCall(char.id), isAmsgActiveDate(char.id))) return;
  const lastUserAt = findAwayGapStart(recent, delayMs, now);
  if (lastUserAt == null) return;
  const userProfile = deps.getUserProfile();
  const api = resolveDialogueApi(deps.getApiConfig(), char);
  if (!userProfile || !api.baseUrl) return;

  // 时刻不早于最后一条消息：显示顺序看 id，时间戳倒挂会让气泡上的钟跳回去。
  const lastMsgAt = recent.at(-1)?.timestamp ?? lastUserAt;
  const slots = planAwaySlots(lastUserAt, delayMs, now).map(t => Math.max(t, lastMsgAt + 1));
  const userName = userProfile.name || '对方';

  const range = await loadCharacterContextRange(char);
  const { emojis, categories } = ChatPrompts.filterVisibleEmojis(await DB.getEmojis(), await DB.getEmojiCategories(), char.id);
  const groups = deps.getGroups();
  const realtimeConfig = deps.getRealtimeConfig();
  const payload = await buildChatRequestPayload({
    char, userProfile, groups, emojis, categories,
    historyMsgs: range.messages,
    contextLimit: Math.max(1, range.messages.length),
    recallEntryPoint: 'proactive_chat',
    realtimeConfig,
    musicSnapshot: loadMusicPlaybackSnapshot(),
    htmlMode: { enabled: !!(char as any).htmlModeEnabled, customPrompt: (char as any).htmlModeCustomPrompt },
    visionApiConfig: deps.getApiConfig().visionApi,
  });

  // 在所有原文范围筛选之后注入本轮任务；负数假 ID 会被水位线、窗口或用户断点滤掉。
  // 只加到 API 请求，不落库、不占历史条数，也不让范围外原文混入。保留末尾的人格提示。
  payload.fullMessages.splice(payload.volatileTailIndex >= 0 ? payload.volatileTailIndex : payload.fullMessages.length, 0, {
    role: 'user', content: buildNativeLocalAwayHint(char, userName, lastUserAt, slots, recent, now),
  });

  const baseUrl = api.baseUrl.replace(/\/+$/, '');
  const chatEndpoint = normalizeChatApiUrl(baseUrl, api.apiType);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` };
  const data = await safeFetchJson(chatEndpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ model: api.model, messages: payload.fullMessages, temperature: api.temperature ?? 0.85, stream: false }),
  }, 2, 0, { appName: '消息', charId: char.id, charName: char.name, purpose: '离开后消息' });
  const segments = splitAwaySegments(extractContent(data), slots.length);
  if (!segments.length) return;

  // 生成期间对方回来说了话：这段离开已经结束，补的消息作废。
  const refreshed = await DB.getRecentMessagesByCharId(char.id, 50, true);
  if (findAwayGapStart(refreshed, delayMs, Date.now()) !== lastUserAt
      || deps.isBusyWith(char.id)
      || resolveAmsgInteractionLock(refreshed, isAmsgActiveCall(char.id), isAmsgActiveDate(char.id))) return;

  const notifyProgress = () => window.dispatchEvent(new CustomEvent('active-msg-progress'));
  for (let i = 0; i < segments.length; i++) {
    await applyAssistantPostProcessing(segments[i], {
      char, userProfile, emojis, categories, realtimeConfig, groups,
      spokenAt: slots[i],
      contextMsgs: range.messages,
      fullMessages: [],
      initialData: null,
      historyMsgCount: range.messages.length,
      // 打标是「这段离开已经补过」的唯一依据，见 findAwayGapStart。
      mcdInheritMeta: { awayMessage: true },
      xhsCaches: {
        xsecTokenCache: new Map(), noteTitleCache: new Map(), commentUserIdCache: new Map(),
        commentAuthorNameCache: new Map(), commentParentIdCache: new Map(),
      },
      api: { baseUrl, headers, effectiveApi: { baseUrl, apiKey: api.apiKey, model: api.model } },
      hooks: { setMessages: notifyProgress, addToast: () => {} },
      instantRender: true,
      skipSecondPassLLM: true,
      messageTimestamp: slots[i],
    });
  }
  const preview = segments.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  // 未读、提示和系统通知沿用主动消息送达那一套。
  window.dispatchEvent(new CustomEvent('active-msg-received', {
    detail: { charId: char.id, charName: char.name, body: preview },
  }));
};
