/**
 * 将作者的线下见面 / 实时通话「在场事实」接入个人版离开后消息。
 * 不改变个人 B 模式对普通私聊的角色发言锚点；
 * 本模块只读取已有消息来源与时间，不接触 Worker/DB/隐私正文。
 */
export interface AwayPresenceMessage {
  role: string;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
}

const IN_PERSON_SOURCES = new Set(['date', 'call', 'call-end-popup']);

/** 真实见面、通话、挂断记录；不把普通系统通知或后台主动消息误当在线互动。 */
export const isAwayInPersonActivity = (message: AwayPresenceMessage): boolean => {
  if (!Number.isFinite(message.timestamp) || message.timestamp <= 0) return false;
  if (message.metadata?.proactiveHint || message.metadata?.hidden || message.metadata?.awayMessage) return false;
  return typeof message.metadata?.source === 'string' && IN_PERSON_SOURCES.has(message.metadata.source);
};

export const getLatestAwayInPersonActivity = (
  messages: readonly AwayPresenceMessage[],
): AwayPresenceMessage | null => {
  let latest: AwayPresenceMessage | null = null;
  for (const message of messages) {
    if (isAwayInPersonActivity(message) && (!latest || message.timestamp > latest.timestamp)) latest = message;
  }
  return latest;
};

/**
 * B 模式的锚点：普通私聊只看角色最后一次发言，
 * 但线下/通话中双方真实在场，以及明确结束场景，均不能算用户失联。
 * 返回 null = 从未有角色真实发言，仍不凭空启动 B 循环。
 */
export const resolvePersonalAwayAnchor = (
  lastCharAt: number | null,
  messages: readonly AwayPresenceMessage[],
  sceneEndedAt?: number | null,
): number | null => {
  if (lastCharAt == null || !Number.isFinite(lastCharAt) || lastCharAt <= 0) return null;
  const sceneAt = typeof sceneEndedAt === 'number' && Number.isFinite(sceneEndedAt) && sceneEndedAt > 0
    ? sceneEndedAt : 0;
  return Math.max(lastCharAt, getLatestAwayInPersonActivity(messages)?.timestamp ?? 0, sceneAt);
};

/**
 * 原生本地离开后消息（2.0 关闭）：最后一次真实用户文字或线下/通话记录作为起点。
 * 个人版可额外传入场景明确结束时间，以防挂断记录保存失败后提前发消息。
 * 一次离开仍只补一次，不动本地旧数据，不伪造任何发言。
 */
export const findNativeAwayGapStartWithPresence = (
  messages: readonly AwayPresenceMessage[],
  delayMs: number,
  nowMs: number,
  sceneEndedAt?: number | null,
): number | null => {
  const ended = typeof sceneEndedAt === 'number' && Number.isFinite(sceneEndedAt)
    && sceneEndedAt > 0 ? sceneEndedAt : 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.metadata?.awayMessage) {
      // 同一次离开已经补过；仅明确更晚的见面/通话结束可重开一段离开。
      if (message.timestamp >= ended) return null;
      continue;
    }
    const genuineOnlineUser = message.role === 'user' && !message.metadata?.proactiveHint
      && !message.metadata?.hidden && Number.isFinite(message.timestamp) && message.timestamp > 0;
    if (genuineOnlineUser || isAwayInPersonActivity(message)) {
      const anchor = Math.max(message.timestamp, ended);
      return nowMs - anchor >= delayMs ? anchor : null;
    }
  }
  return null;
};
