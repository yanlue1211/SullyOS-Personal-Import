/**
 * B方案本地补发的最小防重复账本。
 * 只记一角色最新被「成功发送」或「主动决定静默」消费的节拍，不存聊天正文。
 * 用户重新开口或线下见面结束会改变 anchor，旧节拍记录自动失效。
 */
const KEY = 'sully_amsg2_away_local_tick_v1';

interface CheckedTick { anchor: number; tick: number }
const readMap = (): Record<string, CheckedTick> => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, CheckedTick> : {};
  } catch { return {}; }
};

/** 只认本次空闲周期和本次节拍；别拿上一段失联的静默结果挡住用户重新发言后的新一轮。 */
export const wasLocalAwayTickChecked = (charId: string, anchor: number, tick: number): boolean => {
  const row = readMap()[charId];
  return !!row && row.anchor === anchor && row.tick >= tick;
};

export const markLocalAwayTickChecked = (charId: string, anchor: number, tick: number): void => {
  if (!charId || !Number.isFinite(anchor) || !Number.isFinite(tick)) return;
  try {
    const map = readMap();
    if (map[charId]?.anchor === anchor && map[charId].tick > tick) return;
    map[charId] = { anchor, tick };
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* localStorage unavailable: keep normal sending rather than losing a message */ }
};
