import type { CharacterProfile, Message } from '../types';
import { AWAY_SEGMENT_MARK } from './awayMessageCore';
import { getLatestAwayInPersonActivity } from './awayPresenceAnchor';
import { resolveCharTimeZone } from './timezone';

const DATE_AFTERGLOW_MS = 3 * 60 * 60_000;
const formatCharClock = (ms: number, tz: string | undefined): string =>
  new Date(ms).toLocaleString('zh-CN', {
    timeZone: tz, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

/** Request-only instructions; recent includes archived messages, but their prose is never copied here. */
export const buildNativeLocalAwayHint = (
  char: CharacterProfile, userName: string, lastUserAt: number, slots: number[],
  recent: Pick<Message, 'role' | 'timestamp' | 'metadata'>[], now: number,
): string => {
  const n = slots.length;
  const showClock = char.timeAwarenessEnabled !== false;
  const tz = resolveCharTimeZone(char);
  const lastOnlineUser = [...recent].reverse().find(m => m.role === 'user'
    && !m.metadata?.proactiveHint && !m.metadata?.hidden);
  const lastScene = getLatestAwayInPersonActivity(recent);
  const sceneIsLatest = !!lastScene && (lastOnlineUser?.timestamp ?? 0) <= lastScene.timestamp;
  const isRecentScene = sceneIsLatest && now >= lastScene!.timestamp
    && now - lastScene!.timestamp < DATE_AFTERGLOW_MS;
  const justMetOffline = isRecentScene && lastScene?.metadata?.source === 'date';
  const justCalled = isRecentScene && (lastScene?.metadata?.source === 'call'
    || lastScene?.metadata?.source === 'call-end-popup');
  const anchorDescription = sceneIsLatest
    ? (lastScene?.metadata?.source === 'date' ? '与你最近一次线下相处'
      : '与你最近一次实时通话')
    : '最后一次在线上给你发消息';
  const when = showClock
    ? `${userName}${anchorDescription}的参考时间是在 ${formatCharClock(lastUserAt, tz)}。这段时间里你主动给${userName}发过 ${n} 次消息，分别在 ${slots.map(t => formatCharClock(t, tz)).join('、')}（你那边的时间）。`
    : `你们自从上次线上聊天或线下/通话相处后已有一段时间未在线上交流；你主动给${userName}发过 ${n} 次消息。`;
  return [
    `[系统提示（非${userName}发言）: ${when}`,
    `${userName}此刻并没有发来新消息，是你自己想起了${userName}，拿起手机主动找对方。`,
    justMetOffline
      ? `你和${userName}刚刚在线下见过面，现在暂时分开了。请从这份见面后的心情出发：可以回味上下文里已有的见面细节、补一句当时没说出口的话、关心对方到家了没，或者刚分开就有点想念。不要表现得像很久没联系，也不要对刚才的见面毫不知情；如果具体细节已不在可见上下文里，不要编造，表达分别后的心情即可。`
      : justCalled
        ? `你和${userName}刚结束实时通话，现在各自回到线上生活。可以接上通话后的自然话题或分享新发生的小事；如果通话细节不在可见上下文里，不要编造内容，也不要表现得像刚从未联系过。`
        : `你自己的生活也在继续：可以分享随手拍的照片、刚看到的趣事、突然想到的冷知识，吐槽天气、食物或见闻，接上之前聊过的话，或者单纯想找${userName}聊两句。结合你的人设和当时的生活自然选，不用每一类都写。`,
    '像真人随手发来的私聊，不要刻意汇报近况，不要像完成任务，也不要解释自己为什么发消息。',
    '关心不要变成查岗：不要每次都催问在干嘛、怎么还不回，也不要反复叮嘱喝水早睡。后面几次可以有想念或没等到回复的心情，也可以继续分享新的生活小事，不必次次围着“没回复”打转。',
    `请把这 ${n} 次按时间先后分别写出来，每次一到两句就好，最多三句。`,
    ...(n > 1 ? [`两次之间单独一行写 ${AWAY_SEGMENT_MARK} 隔开。`] : []),
    '不要写时间、序号或旁白，只写你发出去的消息本身。]',
  ].join('\n');
};
