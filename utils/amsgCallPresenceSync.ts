import type { CharacterProfile } from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { amsgStateNamespace } from './amsgFirePack';
import { AMSG_CALL_PRESENCE_KEY, buildAmsgCallPresence } from './amsgCallPresence';

// Per-character serial writes: a slow heartbeat must not overwrite a later hangup.
// This runs only for an actual ongoing call, not once per idle character.
const queues = new Map<string, Promise<void>>();

export const syncAmsgCallPresence = (char: CharacterProfile, active: boolean): Promise<void> => {
  if (!char.awayMessage?.enabled) return Promise.resolve();

  const previous = queues.get(char.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await ActiveMsgClient.writeClientStateValue(
      amsgStateNamespace(char.id),
      AMSG_CALL_PRESENCE_KEY,
      JSON.stringify(buildAmsgCallPresence(char.id, active)),
    );
  });
  queues.set(char.id, next);
  void next.finally(() => { if (queues.get(char.id) === next) queues.delete(char.id); }).catch(() => {});
  return next;
};
