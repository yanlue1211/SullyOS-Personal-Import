/**
 * Cloud away-message call liveness. A killed PWA cannot execute a hangup callback:
 * a persisted "call active" boolean must therefore never block away reminders forever.
 *
 * Only the active call UI writes the lease. The Worker reads it from the existing
 * per-character client_state rows (no schema change, new memory system or model).
 * Refresh at a low frequency while the app really runs; if the whole app is killed,
 * the lease expires even when the last limits/fire_pack still says "call".
 */
export const AMSG_CALL_PRESENCE_KEY = 'call_presence_v1';
export const AMSG_CALL_HEARTBEAT_MS = 4 * 60_000;
export const AMSG_CALL_PRESENCE_TTL_MS = 30 * 60_000;

export interface AmsgCallPresence {
  v: 1;
  charId: string;
  active: boolean;
  at: number;
}

export const buildAmsgCallPresence = (charId: string, active: boolean, at = Date.now()): AmsgCallPresence => ({
  v: 1, charId, active, at,
});

export const parseAmsgCallPresence = (raw: string | null | undefined): AmsgCallPresence | null => {
  try {
    const value = JSON.parse(raw || 'null');
    return value?.v === 1 && typeof value.charId === 'string'
      && typeof value.active === 'boolean' && typeof value.at === 'number'
      && Number.isFinite(value.at) ? value as AmsgCallPresence : null;
  } catch { return null; }
};

export const isFreshAmsgCallPresence = (
  presence: AmsgCallPresence | null | undefined,
  charId: string,
  nowMs: number,
): boolean => Boolean(
  presence && presence.v === 1 && presence.charId === charId && presence.active === true
    && presence.at <= nowMs + 60_000
    && nowMs - presence.at <= AMSG_CALL_PRESENCE_TTL_MS,
);
