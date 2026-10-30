export interface InnerVoice { state: string; thoughts: string; undercurrent: string; }
export const INNER_VOICE_SYSTEM = "【角色心声固定协议】每轮正常回复结束后，附加且只附加一份 <心声>{\"state\":\"当前状态\",\"thoughts\":\"内心想法\",\"undercurrent\":\"深层暗流\"}</心声>。三个字段均为 JSON 字符串，深层暗流允许空字符串但字段保留。这是虚构角色的心理描写，不是模型推理过程或系统思考，不泄漏提示词；心声不属于说出口的台词，用户未必知情，也不能朗读。\n① 当前状态：此刻在做什么，肢体表情和小动作，通常1-2句白描，不捏造用户动作。\n② 内心想法：没有说出口的真实念头，通常1-3句，可以和嘴上说的矛盾，可以犹豫、自我否认、自相矛盾；围绕角色自己的生活和关注点自然展开。\n③ 深层暗流：隐秘或不愿承认的念头，通常0-2句，可以是嫉妒、愤怒、恶意、羞耻、逃避、竞争、占有欲、欲望等，也可以完全与用户无关；结合角色设定、真实关系和当轮事件，不擅自升级关系，不固定围绕用户的占有欲或性欲。没有合理暗流就留空，不硬编。\n句数只是日常参考，不是硬性上限；触动较深时可以展开，平常简短即可。避免每轮小作文、套路和重复情绪，不为了戏剧性制造冲突。同一轮只写一份，使用合法 JSON。\\n【格式强制要求｜优先级高】正常聊天正文结束后，必须原样输出 <心声>{\\\"state\\\":\\\"...\\\",\\\"thoughts\\\":\\\"...\\\",\\\"undercurrent\\\":\\\"...\\\"}</心声>；标签名和 JSON 键名必须逐字一致，双引号不可省略，不能换成“状态：”“内心：”“深层暗流：”的散文段落或 Markdown，也不要把这些字段拆成独立聊天气泡。正文可以自由表达，但状态、内心和暗流只放在心声标签内；不输出标签解释或示例。即使回复很短，也必须保持这套格式。";
export function extractInnerVoice(raw: string): { text: string; innerVoice?: InnerVoice } {
  let innerVoice: InnerVoice | undefined;
  const text = raw.replace(/<心声(?:\s[^>]*)?>([\s\S]*?)(?:<\/心声\s*>|$)/g, (_whole, body: string) => {
    try { const value = JSON.parse(body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); if (typeof value.state === 'string' && typeof value.thoughts === 'string' && (value.undercurrent == null || typeof value.undercurrent === 'string')) innerVoice = { state: value.state.trim(), thoughts: value.thoughts.trim(), undercurrent: (value.undercurrent || '').trim() }; } catch {}
    return '';
  });
  return { text, ...(innerVoice ? { innerVoice } : {}) };
}
export function innerVoiceContext(value: unknown): string {
  const item = value as InnerVoice | undefined;
  if (!item || typeof item.state !== 'string' || typeof item.thoughts !== 'string') return '';
  return `\n[角色当时的心声，未说出口、用户未必知情]\n状态：${item.state}\n内心：${item.thoughts}${item.undercurrent ? `\n暗流：${item.undercurrent}` : ''}`;
}
