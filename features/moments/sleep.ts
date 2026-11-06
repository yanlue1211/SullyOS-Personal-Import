import type { Habits, Activity } from "./schema";
import { getLocalDateKey } from "../../utils/localDate";
export function inQuietHours(h: Habits, hour: number) {
  return h.quietStart === h.quietEnd
    ? false
    : h.quietStart < h.quietEnd
      ? hour >= h.quietStart && hour < h.quietEnd
      : hour >= h.quietStart || hour < h.quietEnd;
}
/** Both sides of midnight use the same local night key. Only absolute timestamps measure cooldowns. */
export function quietNightKey(h: Habits, wall: Date) {
  const d = new Date(wall);
  if (h.quietStart > h.quietEnd && d.getHours() < h.quietEnd)
    d.setDate(d.getDate() - 1);
  return getLocalDateKey(d);
}
export function sleepOpportunity(
  h: Habits,
  state: Activity,
  wall: Date,
  now: number,
  recentChat: boolean,
  random = Math.random,
): boolean {
  if (!inQuietHours(h, wall.getHours())) return true;
  const night = quietNightKey(h, wall);
  if (state.exceptionNight === night || now - state.lastPost < 4 * 3600000)
    return false;
  if (state.quietNight !== night) {
    state.quietNight = night;
    state.quietAllowed = random() < h.lateNightChance;
  }
  if (recentChat && state.lateChatNight !== night) {
    state.lateChatNight = night;
    state.lateChatAllowed = random() < h.lateChatChance;
  }
  return (
    state.quietAllowed === true ||
    (recentChat && state.lateChatAllowed === true)
  );
}
