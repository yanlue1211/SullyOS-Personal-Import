/**
 * 2.0 的跨端交互锁：见面/剧情模式是两人在一起，不等于用户离线。
 * 本模块只判断状态，不改变聊天、通话、见面原有的记忆和消息结构。
 */
export type AmsgInteractionLock = 'date' | 'call' | null;
export interface AmsgInteractionMessage {
  role: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * 通话是否尚未显式挂断由客户端持久化，不能在页面被系统杀掉后直接推断「通话结束」。
 * 存的是布尔状态，不存任何通话正文/密钥。
 */
const ACTIVE_CALL_KEY = 'sully_amsg2_call_active_v1';
const ACTIVE_DATE_KEY = 'sully_amsg2_date_active_v1';
const ACTIVE_DATE_ENCOUNTER_KEY = 'sully_amsg2_date_encounter_v1';
const ACTIVE_DATE_ENDED_AT_KEY = 'sully_amsg2_date_ended_at_v1';

/** 见面会话的身份戳；旧任务不能在新一次见面中把锁解掉。 */
export function getAmsgActiveDateEncounterId(charId: string): string | null {
  try {
    if (!isAmsgActiveDate(charId)) return null;
    const value = (JSON.parse(localStorage.getItem(ACTIVE_DATE_ENCOUNTER_KEY) || '{}') as Record<string, unknown>)[charId];
    return typeof value === 'string' && value ? value : null;
  } catch { return null; }
}

/** 最近一次明确结束见面的时刻，供空闲节拍以此为最低起点；不伪造用户发言。 */
export function getAmsgDateEndedAt(charId: string): number | null {
  try {
    const value = (JSON.parse(localStorage.getItem(ACTIVE_DATE_ENDED_AT_KEY) || '{}') as Record<string, unknown>)[charId];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

export function setAmsgActiveDate(charId: string, active: boolean, encounterId?: string, endedAt = Date.now()): void {
  if (!charId) return;
  try {
    const old = JSON.parse(localStorage.getItem(ACTIVE_DATE_KEY) || '{}') as Record<string, boolean>;
    const encounters = JSON.parse(localStorage.getItem(ACTIVE_DATE_ENCOUNTER_KEY) || '{}') as Record<string, string>;
    const ended = JSON.parse(localStorage.getItem(ACTIVE_DATE_ENDED_AT_KEY) || '{}') as Record<string, number>;
    if (active) {
      old[charId] = true;
      if (encounterId) encounters[charId] = encounterId;
      else delete encounters[charId];
      delete ended[charId];
    } else {
      delete old[charId];
      delete encounters[charId];
      ended[charId] = Number.isFinite(endedAt) && endedAt > 0 ? endedAt : Date.now();
    }
    localStorage.setItem(ACTIVE_DATE_KEY, JSON.stringify(old));
    localStorage.setItem(ACTIVE_DATE_ENCOUNTER_KEY, JSON.stringify(encounters));
    localStorage.setItem(ACTIVE_DATE_ENDED_AT_KEY, JSON.stringify(ended));
  } catch { /* best effort */ }
}

/** 只允许那次见面预约的、已经真正发出的线上消息结束同一次见面。 */
export function endAmsgDateFromScheduledMessage(charId: string, encounterId: string, sentAt: number): boolean {
  if (!charId || !encounterId || !isAmsgActiveDate(charId)) return false;
  if (getAmsgActiveDateEncounterId(charId) !== encounterId) return false;
  setAmsgActiveDate(charId, false, undefined, sentAt);
  return true;
}
export function isAmsgActiveDate(charId: string): boolean {
  try { return JSON.parse(localStorage.getItem(ACTIVE_DATE_KEY) || '{}')[charId] === true; }
  catch { return false; }
}
export function setAmsgActiveCall(charId: string, active: boolean): void {
  if (!charId) return;
  try {
    const old = JSON.parse(localStorage.getItem(ACTIVE_CALL_KEY) || '{}') as Record<string, boolean>;
    if (active) old[charId] = true;
    else delete old[charId];
    localStorage.setItem(ACTIVE_CALL_KEY, JSON.stringify(old));
  } catch { /* 隐私浏览器回退为消息来源推断 */ }
}
export function isAmsgActiveCall(charId: string): boolean {
  try {
    const map = JSON.parse(localStorage.getItem(ACTIVE_CALL_KEY) || '{}') as Record<string, unknown>;
    return map[charId] === true;
  } catch { return false; }
}

/**
 * 必须按持久化消息的顺序传入，最新在最后。
 * 过滤提示词和内部系统消息；通话结束系统标记用作明确解除。
 * 线下见面的结束不能从「超过几小时没有发言」推断，只有下一条线上互动
 * 或用户显式结束状态才可解除。
 */
export function resolveAmsgInteractionLock(
  messages: readonly AmsgInteractionMessage[],
  callStillActive: boolean,
  dateStillActive = false,
): AmsgInteractionLock {
  if (callStillActive) return 'call';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.metadata?.proactiveHint || m.metadata?.hidden || m.metadata?.awayMessage) continue;
    const src = m.metadata?.source;
    if (src === 'call-end-popup') return null;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (src === 'date' || src === 'meeting' || src === 'story' || src === 'companionship') return dateStillActive ? 'date' : null;
    if (src === 'call') return callStillActive ? 'call' : null;
    // 正常私聊的下一条真实消息代表已切回线上。
    return null;
  }
  return dateStillActive ? 'date' : null;
}
