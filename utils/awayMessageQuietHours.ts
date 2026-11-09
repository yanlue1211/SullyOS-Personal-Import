/**
 * 离开后消息的禁发时段（准备在接入上游「离开后消息」时复用）。
 *
 * 纯函数、不碰数据库、React、localStorage、DateApp 或网络。
 * 云端 Worker 和本地补发必须调用同一份判定，且以用户所在时区而非角色时区为准。
 *
 * 规则：在禁发时段不发送；原本的到点时间落在禁发时段的消息，恢复允许时段后
 * 也不补发。避免「睡前见面 → 凌晨应该发送 → 早上打开手机补三条线上私聊」。
 * 只有用户再次开口后，才开启下一次离开等待周期。
 */
export interface AwayMessageQuietHours {
  enabled: boolean;
  /** 当地墙钟 HH:mm，包含开始、不包含结束。 */
  startTime: string;
  endTime: string;
}

export const DEFAULT_AWAY_MESSAGE_QUIET_HOURS: AwayMessageQuietHours = {
  enabled: false,
  startTime: '23:00',
  endTime: '08:00',
};

export function parseQuietClockMinutes(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/** 允许跨午夜：23:00 → 08:00。开始=结束视为全天禁发。 */
export function isQuietClockMinute(clockMinute: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end
    ? clockMinute >= start && clockMinute < end
    : clockMinute >= start || clockMinute < end;
}

const localMinutesAt = (atMs: number, userTimeZone: string): number | null => {
  if (!Number.isFinite(atMs)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: userTimeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(atMs));
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    const minute = Number(parts.find(part => part.type === 'minute')?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    // 时区无效时不按 UTC 猜测用户钟点，避免错误判定静默丢信。
    return null;
  }
};

/** 此刻是否处于用户指定的禁发时段。无效配置安全降级为不禁发。 */
export function isAwayQuietTime(
  config: AwayMessageQuietHours | undefined | null,
  atMs: number,
  userTimeZone: string,
): boolean {
  if (!config?.enabled) return false;
  const start = parseQuietClockMinutes(config.startTime);
  const end = parseQuietClockMinutes(config.endTime);
  if (start === null || end === null) return false;
  const at = localMinutesAt(atMs, userTimeZone);
  return at !== null && isQuietClockMinute(at, start, end);
}

/**
 * 云端：把当前执行时刻和原定触发时刻都交进来，返回 true 就直接 skip，
 * 不 defer 到清晨。 本地补发：同样先检查原定时刻、再检查当前时刻，
 * 避免早晨「补发昨夜的消息」。
 *
 * 与见面状态闸独立：即使不在禁发时段，尚未结束的线下见面也不得发送线上私聊。
 */
export function shouldSkipAwayForQuietHours(args: {
  quietHours?: AwayMessageQuietHours | null;
  nowMs: number;
  dueMs: number;
  userTimeZone: string;
}): boolean {
  return isAwayQuietTime(args.quietHours, args.nowMs, args.userTimeZone)
    || isAwayQuietTime(args.quietHours, args.dueMs, args.userTimeZone);
}

/**
 * 2.0 云端离开后消息在禁发期到点，保留当前机会至当地解禁时刻。
 * 时间戳按用户时区判定（包括 DST）；全天禁发则返回 null。
 * 这里只计算时间、不触发任何模型或后台网络请求。
 */
export function nextAwayAllowedTimeMs(
  quietHours: AwayMessageQuietHours | null | undefined,
  atMs: number,
  userTimeZone: string,
): number | null {
  if (!Number.isFinite(atMs)) return null;
  if (!isAwayQuietTime(quietHours, atMs, userTimeZone)) return atMs;
  const start = parseQuietClockMinutes(quietHours?.startTime);
  const end = parseQuietClockMinutes(quietHours?.endTime);
  if (start === null || end === null || start === end) return null;
  const origin = Math.ceil(atMs / 60_000) * 60_000;
  const stride = 30 * 60_000;
  let upper = origin;
  for (let k = 0; k < 96 && isAwayQuietTime(quietHours, upper, userTimeZone); k++) upper += stride;
  if (isAwayQuietTime(quietHours, upper, userTimeZone)) return null;
  let lo = origin, hi = upper;
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (isAwayQuietTime(quietHours, mid, userTimeZone)) lo = mid;
    else hi = mid;
  }
  return isAwayQuietTime(quietHours, lo, userTimeZone) ? hi : lo;
}
