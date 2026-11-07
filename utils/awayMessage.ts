/**
 * 离开后消息 B 方案：用户没有重新开口时，每经过 X 分钟给 Char 一次机会。
 * 云端由 Worker 幂等排下下一条；跳过时不调 LLM、不追补；本地仅处理当前有效节拍。
 */
import type { APIConfig, ActiveMsg2TaskRecord, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../types';
import { DB } from './db';
import { ActiveMsgClient } from './activeMsgClient';
import { applyScheduledTask, isAmsg2EnabledForChar } from './amsg2Tasks';
import { isAmsg2GlobalReady } from './amsg2ToolBridge';
import {
  decideAwayTaskAction,
  resolveAwayDelayMinutes,
  splitAwaySegments,
  latestAwayTickMs,
} from './awayMessageCore';
import { loadCharacterContextRange } from './chatContextRange';
import { resolveAmsgInteractionLock, isAmsgActiveCall, isAmsgActiveDate, getAmsgDateEndedAt } from './amsgInteractionGuard';
import { wasLocalAwayTickChecked, markLocalAwayTickChecked } from './awayMessageLocalTick';
import { buildLocalAwayHint } from './awayMessagePrompt';
import { generateNativeLocalAwayMessages } from './awayMessageNative';
import { AMSG_SILENT_MARK } from './amsgFirePack';
import { shouldSkipAwayForQuietHours } from './awayMessageQuietHours';
import { ChatPrompts } from './chatPrompts';
import { buildChatRequestPayload } from './chatRequestPayload';
import { applyAssistantPostProcessing } from './applyAssistantPostProcessing';
import { resolveScheduledMessageApi } from './characterApi';
import { normalizeChatApiUrl } from './amsgLlmCredentials';
import { extractContent, safeFetchJson } from './safeApi';
import { loadMusicPlaybackSnapshot } from '../context/MusicContext';

/** 失败后这么久内不再试，免得每次切回前台都白调一次。 */
const FAILURE_COOLDOWN_MS = 10 * 60_000;

type UpdateCharacter = (
  id: string,
  updates: Partial<CharacterProfile> | ((prev: CharacterProfile) => Partial<CharacterProfile>),
) => void;

/** 这个角色走云端（开着 2.0 且配了 Worker）还是本地。 */
export const isAwayCloudRoute = async (char: CharacterProfile): Promise<boolean> =>
  isAmsg2EnabledForChar(char) && await isAmsg2GlobalReady();

// ─── 云端 ───

const cloudInFlight = new Set<string>();
const cloudCooldownUntil = new Map<string, number>();

const awaySendAtMs = (task: ActiveMsg2TaskRecord): number | null => {
  const ms = Date.parse(task.nextSendAt ?? task.firstSendTime);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * 每轮聊天开始时调用（不用 await）：把云端那条离开后消息排到「对方最后一次开口 + 等待时长」。
 * 已有任务排得够晚就什么都不发；排早了原地改期；远端已经没有（发过了 / 被取消）就新建。
 */
export const syncCloudAwayTask = async (deps: {
  char: CharacterProfile;
  lastUserAt: number;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  apiConfig: APIConfig;
  updateCharacter: UpdateCharacter;
}): Promise<void> => {
  const { char } = deps;
  if (!char.awayMessage?.enabled || cloudInFlight.has(char.id)) return;
  if ((cloudCooldownUntil.get(char.id) ?? 0) > Date.now()) return;
  if (!await isAwayCloudRoute(char) || !char.activeMsg2Config) return;

  cloudInFlight.add(char.id);
  try {
    const delayMinutes = resolveAwayDelayMinutes(char);
    const now = Date.now();
    const targetMs = Math.max(deps.lastUserAt + delayMinutes * 60_000, now + 60_000);
    const sendAt = new Date(targetMs).toISOString();
    // B 模式下 Worker 每次 fire 会创建下一节拍，客户端本地列表不一定认领过它。
    // 新用户开口时必须先和远端对账：否则老链在云端继续，我们又凭旧的本地清单
    // 创建一条新链，两个链交错触发会倍增模型调用次数。
    const localAway = (char.activeMsg2Config.tasks ?? []).filter(t => t.away);
    const remote = await ActiveMsgClient.listRemoteTasksForChar(char.id);
    const remoteAway = remote.filter(t => t.status === 'pending'
      && (t.clientTaskId?.startsWith('away-') || localAway.some(old => old.taskUuid === t.uuid)));
    // 多出来的链（旧版竞争或恢复残留）尽力取消；只保留最早的那条继续改期。
    const ordered = remoteAway.sort((a, b) =>
      Date.parse(a.nextSendAt || '') - Date.parse(b.nextSendAt || ''));
    const keep = ordered[0];
    for (const extra of ordered.slice(1)) {
      await ActiveMsgClient.cancelTask(extra.uuid);
    }
    const record = keep
      ? { taskUuid: keep.uuid, nextSendAt: keep.nextSendAt || sendAt, firstSendTime: keep.nextSendAt || sendAt,
          clientTaskId: keep.clientTaskId || `away-${keep.uuid}`, mode: 'auto' as const, away: true }
      : undefined;
    const action = decideAwayTaskAction(record ? awaySendAtMs(record as ActiveMsg2TaskRecord) : null, targetMs, now);
    if (action === 'keep') {
      // 面板里也要看见 Worker 在离线时生成的下一节拍，不要永远显示旧的 UUID。
      if (record && !localAway.some(old => old.taskUuid === record.taskUuid)) {
        deps.updateCharacter(char.id, prev => prev.activeMsg2Config ? {
          activeMsg2Config: {
            ...prev.activeMsg2Config,
            tasks: applyScheduledTask((prev.activeMsg2Config.tasks ?? []).filter(t => !t.away), {
              ...record, recurrenceType: 'none', expirePolicy: 'force', source: 'user', status: 'scheduled', createdAt: now,
            } as ActiveMsg2TaskRecord, {}, now),
          },
        } : {});
      }
      return;
    }

    if (action === 'renew' && record) {
      const { updated, failed } = await ActiveMsgClient.updatePendingTasksRemote([record.taskUuid], { nextSendAt: sendAt });
      if (updated > 0) {
        deps.updateCharacter(char.id, prev => prev.activeMsg2Config ? {
          activeMsg2Config: {
            ...prev.activeMsg2Config,
            tasks: applyScheduledTask((prev.activeMsg2Config.tasks ?? []).filter(t => !t.away), {
              ...record, nextSendAt: sendAt, firstSendTime: sendAt,
              recurrenceType: 'none', expirePolicy: 'force', source: 'user', status: 'scheduled', createdAt: now,
            } as ActiveMsg2TaskRecord, {}, now),
          },
        } : {});
        return;
      }
      if (failed.length) throw new Error('离开后消息改期失败');
      // 到点已消费、远端任务已经不在：下面只补建一条新链。
    }

    const result = await ActiveMsgClient.scheduleCharacterTask({
      char,
      config: char.activeMsg2Config,
      task: { mode: 'auto', firstSendTime: sendAt, recurrenceType: 'none', expirePolicy: 'force', away: { delayMinutes } },
      userProfile: deps.userProfile,
      groups: deps.groups,
      realtimeConfig: deps.realtimeConfig,
      apiConfig: deps.apiConfig,
    });
    const created: ActiveMsg2TaskRecord = {
      taskUuid: result.uuid,
      clientTaskId: result.clientTaskId,
      mode: 'auto',
      firstSendTime: result.firstSendAt,
      recurrenceType: 'none',
      expirePolicy: 'force',
      source: 'user',
      status: 'scheduled',
      createdAt: Date.now(),
      away: true,
    };
    deps.updateCharacter(char.id, prev => prev.activeMsg2Config ? {
      activeMsg2Config: {
        ...prev.activeMsg2Config,
        // 旧的那条已经发过或不在了，换成新的；每个角色只留一条。
        tasks: applyScheduledTask((prev.activeMsg2Config.tasks ?? []).filter(t => !t.away), created, {}, Date.now()),
      },
    } : {});
  } catch (error) {
    console.warn('[AwayMessage] 云端任务同步失败', error);
    cloudCooldownUntil.set(char.id, Date.now() + FAILURE_COOLDOWN_MS);
  } finally {
    cloudInFlight.delete(char.id);
  }
};

/** 关掉离开后消息或改了等待时长时调用：取消云端那条，下一轮对方开口时按新设置重建。 */
export const cancelCloudAwayTasks = async (char: CharacterProfile, updateCharacter: UpdateCharacter): Promise<void> => {
  const away = (char.activeMsg2Config?.tasks ?? []).filter(t => t.away);
  // 远端链在后台续排，可能不在本地清单里。必须一并取消，不能仅靠旧 UUID。
  const remote = await ActiveMsgClient.listRemoteTasksForChar(char.id).catch(error => {
    console.warn('[AwayMessage] 取消时远端清单不可读，Worker 会通过 awayEnabled=false 防继续生成', error);
    return [];
  });
  const targets = new Set<string>([
    ...away.map(t => t.taskUuid),
    ...remote.filter(t => t.status === 'pending' && t.clientTaskId?.startsWith('away-')).map(t => t.uuid),
  ]);
  if (!targets.size) return;
  const cancelled = new Set<string>();
  for (const taskUuid of targets) {
    try {
      await ActiveMsgClient.cancelTask(taskUuid);
      cancelled.add(taskUuid);
    } catch (error) {
      console.warn('[AwayMessage] 取消云端任务失败', error);
    }
  }
  updateCharacter(char.id, prev => prev.activeMsg2Config ? {
    activeMsg2Config: {
      ...prev.activeMsg2Config,
      tasks: (prev.activeMsg2Config.tasks ?? []).filter(t => !cancelled.has(t.taskUuid)),
    },
  } : {});
};

// ─── 本地 ───

export interface LocalAwayDeps {
  getCharacters: () => CharacterProfile[];
  getApiConfig: () => APIConfig;
  getUserProfile: () => UserProfile | null | undefined;
  getGroups: () => GroupProfile[];
  getRealtimeConfig: () => RealtimeConfig;
  /** 用户正在和这个角色见面 / 通话：这时不补线上消息。 */
  isBusyWith: (charId: string) => boolean;
}

let localRunning = false;
const localCooldownUntil = new Map<string, number>();

/** 打开页面 / 切回前台时调用：逐个给该补的角色补上离开期间的消息。 */
export const runLocalAwayMessages = async (deps: LocalAwayDeps): Promise<void> => {
  if (localRunning) return;
  localRunning = true;
  try {
    for (const char of deps.getCharacters().filter(c => c.awayMessage?.enabled)) {
      if ((localCooldownUntil.get(char.id) ?? 0) > Date.now() || deps.isBusyWith(char.id)) continue;
      try {
        if (await isAwayCloudRoute(char)) continue;
        // 作者原版：2.0 没开启的角色仍可使用「离开后消息」，
        // 打开页面时一次最多补三段、这次离开只补一次。
        // B 方案循环节拍只属于明确开启 2.0 的角色（Worker 不可用时走本地 B 兜底）。
        if (isAmsg2EnabledForChar(char)) await generateLocalAwayMessages(char, deps);
        else await generateNativeLocalAwayMessages(char, deps);
      } catch (error) {
        console.warn(`[AwayMessage] ${char.name} 的离开后消息生成失败`, error);
        localCooldownUntil.set(char.id, Date.now() + FAILURE_COOLDOWN_MS);
      }
    }
  } finally {
    localRunning = false;
  }
};

const generateLocalAwayMessages = async (char: CharacterProfile, deps: LocalAwayDeps): Promise<void> => {
  const delayMs = resolveAwayDelayMinutes(char) * 60_000;
  const now = Date.now();
  const recent = await DB.getRecentMessagesByCharId(char.id, 50, true);
  // B 方案：消息历史里即便已经有上一条 away，也不能停止未来节拍。
  // 一次上线只处理最新有效节拍，漏掉的所有旧节拍不补发。
  const lastUser = [...recent].reverse().find(m => m.role === 'user' && !m.metadata?.proactiveHint);
  if (!lastUser) return;
  const lastUserAt = lastUser.timestamp;
  // 线下期间不能算作「用户失联」；从本次见面结束时间重新计时。
  // lastUserAt 仍为真实发言时间，不伪造用户新消息。
  const awayAnchor = Math.max(lastUserAt, getAmsgDateEndedAt(char.id) ?? 0);
  const tick = latestAwayTickMs(awayAnchor, delayMs, now);
  if (tick == null) return;
  if (wasLocalAwayTickChecked(char.id, awayAnchor, tick)) return;
  const lastAwaySentAt = [...recent].reverse().find(m => m.metadata?.awayMessage)?.timestamp ?? 0;
  if (lastAwaySentAt >= tick) return;
  if (resolveAmsgInteractionLock(recent, isAmsgActiveCall(char.id), isAmsgActiveDate(char.id))) return;
  const quiet = char.awayMessage?.quietHours;
  const userTzId = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (shouldSkipAwayForQuietHours({ quietHours: quiet, dueMs: tick, nowMs: now, userTimeZone: userTzId })) return;
  const userProfile = deps.getUserProfile();
  const api = resolveScheduledMessageApi(deps.getApiConfig(), char, char.activeMsg2Config);
  if (!userProfile || !api.baseUrl) return;
  // 只能写一条当前真实时间的消息：不能伪造过去几个小时多次打过招呼。
  const slots = [now];
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

  // 作者 52fadd8b29：在记忆水位/窗口筛选后向这一轮请求注入提示，
  // 不用 id=-1 假历史消息（会被水位线筛掉，也会挤占一条正常对话）。
  payload.fullMessages.splice(payload.volatileTailIndex >= 0 ? payload.volatileTailIndex : payload.fullMessages.length, 0, {
    role: 'user', content: buildLocalAwayHint(char, userName, lastUserAt, recent, now),
  });

  const baseUrl = api.baseUrl.replace(/\/+$/, '');
  const chatEndpoint = normalizeChatApiUrl(baseUrl, api.apiType);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` };
  const data = await safeFetchJson(chatEndpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ model: api.model, messages: payload.fullMessages, temperature: api.temperature ?? 0.85, stream: false }),
  }, 2, 0, { appName: '消息', charId: char.id, charName: char.name, purpose: '离开后消息' });
  const generatedText = extractContent(data).trim();
  const decidedSilent = generatedText === AMSG_SILENT_MARK;
  const segments = decidedSilent ? [] : splitAwaySegments(generatedText, slots.length);
  // 空正文 / 解析失败不是角色主动选择静默，不能把它记成已处理节拍。
  if (!decidedSilent && !segments.length) throw new Error('本地离开后消息没有生成有效正文');

  // 生成期间对方回来说了话：这段离开已经结束，补的消息作废。
  const refreshed = await DB.getRecentMessagesByCharId(char.id, 50, true);
  const latestUser = [...refreshed].reverse().find(m => m.role === 'user' && !m.metadata?.proactiveHint);
  if (latestUser?.timestamp !== lastUserAt || deps.isBusyWith(char.id)
      || resolveAmsgInteractionLock(refreshed, isAmsgActiveCall(char.id), isAmsgActiveDate(char.id))
      || [...refreshed].reverse().some(m => m.metadata?.awayMessage && m.timestamp >= tick)) return;

  // 明确选择静默也消费这一节拍，防止用户多次切回前台重复烧 API。
  // 下一节拍仍可重新判断；用户新消息/结束见面改变 anchor 也能重新开始。
  if (decidedSilent) {
    markLocalAwayTickChecked(char.id, awayAnchor, tick);
    return;
  }

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
  markLocalAwayTickChecked(char.id, awayAnchor, tick);
  const preview = segments.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  // 未读、提示和系统通知沿用主动消息送达那一套。
  window.dispatchEvent(new CustomEvent('active-msg-received', {
    detail: { charId: char.id, charName: char.name, body: preview },
  }));
};
