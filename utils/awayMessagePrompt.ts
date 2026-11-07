import type { CharacterProfile, Message } from '../types';
import { AMSG_SILENT_MARK } from './amsgFirePack';
import { resolveCharTimeZone } from './timezone';

const DATE_AFTERGLOW_MS = 3 * 60 * 60_000;
const formatCharClock = (ms: number, tz: string | undefined): string =>
  new Date(ms).toLocaleString('zh-CN', {
    timeZone: tz, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

/**
 * 作者 52fadd8b29 的本地生活分享/见面后语境，适配个人版 B方案：
 * 当前只给一次主动联系机会，不伪造几小时前曾连续发了多条消息。
 * recent 可以包含已归档记录，但只检查来源/时间，不复制范围外的正文。
 */
export const buildLocalAwayHint = (
  char: CharacterProfile, userName: string, lastUserAt: number,
  recent: Pick<Message, 'role' | 'timestamp' | 'metadata'>[], now: number,
): string => {
  const tz = resolveCharTimeZone(char);
  const showClock = char.timeAwarenessEnabled !== false;
  const lastReal = [...recent].reverse().find(m => m.role !== 'system' && !m.metadata?.proactiveHint && !m.metadata?.hidden);
  const justMetOffline = lastReal?.metadata?.source === 'date'
    && now >= lastReal.timestamp && now - lastReal.timestamp < DATE_AFTERGLOW_MS;
  const when = showClock
    ? `${userName}上一次主动发消息是在 ${formatCharClock(lastUserAt, tz)}（你那边的时间）。`
    : `${userName}已经有一段时间没有主动在线上发消息了。`;
  return [
    `[系统提示（非${userName}发言）：${when}`,
    `现在是你可以主动向${userName}发出一条线上聊天消息的机会；对方此刻没有发送新消息。结合你们的关系和上下文，以你自己的生活节奏自主决定要不要联系。`,
    justMetOffline
      ? `你和${userName}最近在线下见过面，现在已经分开了。可以回味可见的见面细节、补一句当时没说的话，也可以继续自己的生活；不要表现得像很久没联系。如果细节不在可见上下文里，不得编造。`
      : `你自己的生活也在继续：可以分享随手拍的照片、刚看到的趣事、吃到的东西、自己的新进展，或自然接上以前聊过的话。别为了联系而硬找话题。`,
    '像真人随手发来的私聊，不要刻意汇报近况，也不要每次催回复、问在干嘛、叮嘱喝水早睡。',
    `如果这条联系在最近上下文中已经发生过，或者对方正忙于当前对话而你这条明显会打断，可以这次选择不说；拿不准就正常说。`,
    `决定不发送时只输出 ${AMSG_SILENT_MARK}，不要解释；决定发送时写一到三句自然的私聊，不要写时间、序号或旁白。]`,
  ].join('\n');
};
