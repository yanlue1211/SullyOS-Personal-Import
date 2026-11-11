/** 见面状态是语义判断的背景，不是普通排程的硬闸。 */
import { AMSG_SILENT_MARK } from './amsgFirePack';

export function buildAmsgInPersonContext(active: boolean): string {
  return [
    '【线上联系前的见面状态判断】',
    active ? '状态记录：这场线下见面尚未明确结束。此记录只供参考，以最新对话里的实际情境为准。'
      : '先从最新对话确认你们此刻是在当面相处，还是已经分开。',
    '切换应用、锁屏、没有新消息或现实时间流逝，都不代表剧情中对方离开；对方可能回来后指定时间继续补齐剧情。不要自行把这些操作编成离开、失联或冷落。',
    '如果上下文表明仍在当面相处，且你此刻没有符合已有剧情与本次任务的分开打算，就不发线上主动消息，也不要为了发送而临时编造离开。',
    '如果已经分开，或者本次联系正是已有的合理计划（例如六点半起床、轻手轻脚出门后报备），允许你决定现在离开再发消息；未点结束见面不能否决这次联系。不要替对方补行动或台词。',
    `仍在见面、此次不发 → 只输出 ${AMSG_SILENT_MARK}。不把这条改成私聊里的当面台词，也不自动顺延补发。`,
    '这条场景判断优先于笼统的「拿不准就说」；除此之外仍照原来的开口规则判断。',
  ].join('\n');
}

/** 普通任务由模型决定分开并发送；旧场次预约不得解掉后来新开的见面。 */
export function resolveAmsgDateExitEncounter(
  lock: string | null | undefined,
  encounter: string | null | undefined,
  taskEncounter: unknown,
): string | null {
  if (lock !== 'date' || !encounter) return null;
  if (typeof taskEncounter === 'string' && taskEncounter !== encounter) return null;
  return encounter;
}
