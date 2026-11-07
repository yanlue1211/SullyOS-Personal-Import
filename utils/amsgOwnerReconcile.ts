/**
 * Read-only cloud owner reconciliation from author df40214ae6.
 * No character restore/deletion happens during checks. Unsafe writes must be user initiated.
 */
import type { CloudOwnerState } from '@rei-standard/amsg-client';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { CloudDataError } from './amsgCloudData';
import { pendingCloudRetirements } from './amsgCloudRetirement';
import { readCloudOwnerGeneration } from './amsgCloudOwnerGeneration';

export type CloudOwnerConflict = { id: string; name: string; retired: boolean };
export const AMSG_OWNER_CONFLICT_EVENT = 'amsg2-owner-conflict';

type Character = { id: string; name: string };
export function diffCloudOwners(
  characters: ReadonlyArray<Character>,
  owners: ReadonlyArray<Pick<CloudOwnerState, 'owner' | 'retired' | 'generation'>>,
  localGeneration: (charId: string) => number,
  pendingDelete: ReadonlySet<string> = new Set(),
): CloudOwnerConflict[] {
  const byId = new Map(owners.filter(state => state.owner.type === 'character')
    .map(state => [state.owner.id, state]));
  return characters.flatMap(char => {
    const remote = byId.get(char.id);
    if (!remote || pendingDelete.has(char.id)) return [];
    if (remote.retired || remote.generation !== localGeneration(char.id))
      return [{ id: char.id, name: char.name, retired: !!remote.retired }];
    return [];
  });
}

/** No write; skip old Workers without owner support. Partial cloud registry means unknown, not safe-to-ignore. */
export async function findCloudOwnerConflicts(characters: ReadonlyArray<Character>): Promise<CloudOwnerConflict[]> {
  if (characters.length === 0) return [];
  if (!(await ActiveMsgStore.getGlobalConfig()).workerUrl?.trim()) return [];
  let session: Awaited<ReturnType<typeof ActiveMsgClient.openCloudDataSession>>;
  try {
    session = await ActiveMsgClient.openCloudDataSession();
  } catch (error) {
    if (error instanceof CloudDataError && error.code === 'CLOUD_DATA_UNSUPPORTED') return [];
    throw error;
  }
  const listed = await session.listOwners();
  if (!listed.complete || listed.gaps?.length) {
    throw new Error('云端角色登记列表不完整，本次对账已暂停，不能据此恢复或删除角色。');
  }
  const connection = { workerUrl: session.workerUrl, userId: session.userId };
  const deleting = new Set(pendingCloudRetirements(connection).map(row => row.id));
  return diffCloudOwners(characters, listed.owners,
    id => readCloudOwnerGeneration(connection, { type: 'character', id }), deleting);
}
