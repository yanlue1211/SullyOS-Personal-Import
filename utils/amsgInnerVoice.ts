import { extractInnerVoice } from '../features/personal/innerVoice/protocol';

/** Restore the private trailer only at the existing post-processing boundary. */
export async function restoreAmsgInnerVoice(
  body: string,
  metadata: Record<string, unknown> | undefined,
  readOffloaded: () => Promise<string | null>,
): Promise<string> {
  // Legacy Workers still include the trailer in the body. Never duplicate it.
  if (extractInnerVoice(body).innerVoice) return body;
  let value = metadata?.amsgInnerVoice;
  if (value == null && (metadata?.amsgInnerVoiceRef || metadata?.amsgInnerVoiceAttachment)) {
    const raw = await readOffloaded();
    try { value = raw == null ? undefined : JSON.parse(raw); } catch { return body; }
  }
  if (!value || typeof value !== 'object') return body;
  const trailer = `<心声>${JSON.stringify(value)}</心声>`;
  return extractInnerVoice(trailer).innerVoice ? `${body}\n${trailer}` : body;
}

/** Transport fields must not become duplicate, permanent chat metadata. */
export function stripAmsgInnerVoiceTransport(metadata: Record<string, unknown> | undefined) {
  const { amsgInnerVoice, amsgInnerVoiceRef, amsgInnerVoiceAttachment, ...rest } = metadata ?? {};
  return rest;
}
