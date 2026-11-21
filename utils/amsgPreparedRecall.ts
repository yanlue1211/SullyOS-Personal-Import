import type { CharacterProfile, Message } from '../types';

export interface AmsgPreparedRecall {
  inputKey: string;
  memory: string;
  roomPlates: string;
}

export function amsgRecallInputKey(char: CharacterProfile, messages: Message[], userName: string): string {
  return JSON.stringify([
    char.id, char.name, userName, char.memoryPalaceEnabled, char.embeddingConfig,
    char.activeBuffs?.[0]?.name, char.personalityStyle, char.ruminationTendency,
    messages.map(message => [
      message.id, message.timestamp, message.role, message.type, message.content, message.metadata,
    ]),
  ]);
}

export function formatAmsgRecalledHistory(memory: string): string {
  if (!memory.trim()) return '';
  const datedMemory = memory.replace(
    /(\d{4}年\d{1,2}月\d{1,2}日)（(?:今天|距今约\d+天|约\d+天后)）/g,
    '$1',
  );
  return `【相关旧记忆】\n按记录日期理解这些往事，以当前时刻为准。\n${datedMemory}`;
}
