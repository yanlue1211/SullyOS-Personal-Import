import type { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../types';
import { DB } from './db';
import { loadCharacterContextRange } from './chatContextRange';
import { ChatPrompts } from './chatPrompts';
import { buildChatRequestPayload } from './chatRequestPayload';
import { applyAssistantPostProcessing } from './applyAssistantPostProcessing';
import { resolveScheduledMessageApi } from './characterApi';
import { normalizeChatApiUrl } from './amsgLlmCredentials';
import { extractContent, safeFetchJson } from './safeApi';
import { loadMusicPlaybackSnapshot } from '../context/MusicContext';
export interface LocalProactiveTurn {
  apiConfig: APIConfig;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  /** 本轮提示：只进这次请求，不落库。 */
  hint: string;
  /** 调用记录里的用途名。 */
  purpose: string;
  /** 落库消息带的标记。 */
  meta: Record<string, unknown>;
  /** 把模型正文切成几次发送，并给每次一个时刻。 */
  place: (text: string) => { text: string; at: number }[];
  /** 生成完、落库前再确认一次还要不要发；情况变了返回 false，整轮作废。 */
  stillWanted: () => Promise<boolean>;
}

/** 用聊天同一套上下文生成并落库，返回有没有真的发出去。 */
export const runLocalProactiveTurn = async (char: CharacterProfile, turn: LocalProactiveTurn): Promise<boolean> => {
  const api = resolveScheduledMessageApi(turn.apiConfig, char, char.activeMsg2Config);
  if (!api.baseUrl) return false;
  const { userProfile, groups, realtimeConfig } = turn;

  const range = await loadCharacterContextRange(char);
  const { emojis, categories } = ChatPrompts.filterVisibleEmojis(await DB.getEmojis(), await DB.getEmojiCategories(), char.id);
  const payload = await buildChatRequestPayload({
    char, userProfile, groups, emojis, categories,
    historyMsgs: range.messages,
    contextLimit: Math.max(1, range.messages.length),
    recallEntryPoint: 'proactive_chat',
    realtimeConfig,
    musicSnapshot: loadMusicPlaybackSnapshot(),
    htmlMode: { enabled: !!(char as any).htmlModeEnabled, customPrompt: (char as any).htmlModeCustomPrompt },
    visionApiConfig: turn.apiConfig.visionApi,
  });

  // 在所有原文范围筛选之后注入本轮任务；负数假 ID 会被水位线、窗口或用户断点滤掉。
  // 只加到 API 请求，不落库、不占历史条数，也不让范围外原文混入。保留末尾的人格提示。
  payload.fullMessages.splice(payload.volatileTailIndex >= 0 ? payload.volatileTailIndex : payload.fullMessages.length, 0, {
    role: 'user', content: turn.hint,
  });

  const baseUrl = api.baseUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` };
  const data = await safeFetchJson(normalizeChatApiUrl(baseUrl, api.apiType), {
    method: 'POST', headers,
    body: JSON.stringify({ model: api.model, messages: payload.fullMessages, temperature: api.temperature ?? 0.85, stream: false }),
  }, 2, 0, { appName: '消息', charId: char.id, charName: char.name, purpose: turn.purpose });
  const placed = turn.place(extractContent(data)).filter(p => p.text.trim());
  if (!placed.length || !await turn.stillWanted()) return false;

  const notifyProgress = () => window.dispatchEvent(new CustomEvent('active-msg-progress'));
  for (const { text, at } of placed) {
    await applyAssistantPostProcessing(text, {
      char, userProfile, emojis, categories, realtimeConfig, groups,
      spokenAt: at,
      contextMsgs: range.messages,
      fullMessages: [],
      initialData: null,
      historyMsgCount: range.messages.length,
      mcdInheritMeta: turn.meta,
      xhsCaches: {
        xsecTokenCache: new Map(), noteTitleCache: new Map(), commentUserIdCache: new Map(),
        commentAuthorNameCache: new Map(), commentParentIdCache: new Map(),
      },
      api: { baseUrl, headers, effectiveApi: { baseUrl, apiKey: api.apiKey, model: api.model } },
      hooks: { setMessages: notifyProgress, addToast: () => {} },
      instantRender: true,
      skipSecondPassLLM: true,
      messageTimestamp: at,
    });
  }
  const preview = placed.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  // 未读、提示和系统通知沿用主动消息送达那一套。
  window.dispatchEvent(new CustomEvent('active-msg-received', {
    detail: { charId: char.id, charName: char.name, body: preview },
  }));
  return true;
};
