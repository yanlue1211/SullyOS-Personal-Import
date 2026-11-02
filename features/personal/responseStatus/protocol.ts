export interface ResponseStatus {
  type: 'response_status';
  kind: 'read' | 'busy';
  reason: string;
  footer: string;
  eta: string;
}
export const RESPONSE_STATUS_SYSTEM = `\n【可选的本轮回应状态】正常交流时自然回复；不要为了使用功能而使用卡片。你可以选择以下其中一种作为本轮全部回应：
1. 已读不回：确实看到了消息，但当下没有想说的话、不想接话、害羞回避、生闷气或懒得回复。这是角色可以选择的消极回应，不需要道歉。正常提问或对方明显需要关心时优先认真回应，不滥用卡片。
2. 忙碌：日程、当前活动或已知状态明确表明无法或不方便看手机或回复；不能在有空时捏造忙碌。忙碌不等于已经读过消息。
选择卡片时，只输出 <回应状态>{"kind":"read或busy","reason":"第三人称的当下状态或具体心理／正在进行的活动，不用我、不向对方说话","footer":"简短状态文字","eta":"仅busy填写大致多久后有空；无法估计就写暂不确定，read留空"}</回应状态>。
卡片本身就是完整回应，不能前后附带台词、表情、动作、购物或其他动作指令，也不要附加心声。本条仅在选择状态卡时替代普通回复及心声格式。reason是给用户展开查看的角色内情，不是已经向对方说过的话；预计有空时间不是保证届时回复，也不表示已经安排定时消息。不要每天或每轮机械输出卡片，依据性格、真实关系及当前情境判断。`;
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function normalizeResponseStatus(value: unknown): ResponseStatus | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'read' && v.kind !== 'busy') return;
  const reason = clean(v.reason, 2000);
  if (!reason) return;
  return { type: 'response_status', kind: v.kind, reason,
    footer: clean(v.footer, 100) || (v.kind === 'read' ? '暂时留白' : '忙碌中'),
    eta: v.kind === 'busy' ? clean(v.eta, 100) || '暂不确定' : '' };
}
export function extractResponseStatus(raw: string): ResponseStatus | undefined {
  // Reasoning examples are not actual decisions.
  const text = raw.replace(/<(think|thinking|thought)>[\s\S]*?(?:<\/\1>|$)/gi, '');
  for (const match of text.matchAll(/<回应状态\s*>([\s\S]*?)<\/回应状态\s*>/g)) {
    try { const card = normalizeResponseStatus(JSON.parse(match[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))); if (card) return card; } catch {}
  }
}
export function readResponseStatus(content: string, metadata?: Record<string, any>): ResponseStatus | undefined {
  try { const raw = metadata?.responseStatus || JSON.parse(content); return raw?.type === 'response_status' ? normalizeResponseStatus(raw) : undefined; } catch { return; }
}
export function responseStatusContext(card: ResponseStatus, name = '角色'): string {
  return card.kind === 'read'
    ? `[已读不回] ${name}看到了消息，选择暂时不回复。状态：${card.footer}。[未说出口的内情，不能当成已告知对方] ${card.reason}`
    : `[忙碌状态，不能据此视为已读] ${name}暂时不方便查看或回复。状态：${card.footer}。预计有空：${card.eta}（仅预估，不是定时回复承诺）。[状态内情，非聊天台词] ${card.reason}`;
}

/** Scheduled outreach is not a response to a freshly received user message. Instant chat remains ordinary chat. */
export function isProactiveStatusDelivery(message:{messageType?:string;messageSubtype?:string}):boolean{
 return message.messageType!=='instant'&&message.messageSubtype!=='instant-chat';
}
export function stripResponseStatus(raw:string):string{
 const text=raw.replace(/<回应状态\s*>[\s\S]*?(?:<\/回应状态\s*>|$)/g,'').trim();
 try{const value=JSON.parse(text);if(value?.type==='response_status'&&normalizeResponseStatus(value))return '';}catch{/* ordinary prose */}
 return text;
}

/** Outreach may show a busy card, but must never deliver a read-without-reply status. */
export function proactiveResponseText(raw:string):string {
 raw=raw.replace(/<(think|thinking|thought)>[\s\S]*?(?:<\/\1>|$)/gi,'').trim();
 const card=extractResponseStatus(raw);
 if(card)return card.kind==='busy'?`<回应状态>${JSON.stringify(card)}</回应状态>`:'';
 try{const card=normalizeResponseStatus(JSON.parse(raw));if(card)return card.kind==='busy'?`<回应状态>${JSON.stringify(card)}</回应状态>`:'';}catch{}
 const text=stripResponseStatus(raw);
 // Context renderings copied from history are internal state, never spoken messages.
 if(/^\s*\[已读不回\]/.test(text))return '';
 const busy=text.match(/^\s*\[忙碌状态[^\]]*\]([\s\S]*)$/);
 if(busy){const body=busy[1].trim(),reason=body.split('[状态内情，非聊天台词]')[1]?.trim()||body;if(!reason)return '';const footer=/状态：([^。]+)。/.exec(body)?.[1],eta=/预计有空：([^（。]+)/.exec(body)?.[1];return `<回应状态>${JSON.stringify(normalizeResponseStatus({kind:'busy',reason,footer,eta}))}</回应状态>`;}
 return text;
}
export const PROACTIVE_STATUS_SYSTEM = `\n【主动联系的回应状态】本轮是你主动联系对方，不能选择已读不回，也不能复述历史中的[已读不回]、[未说出口的内情]等上下文说明。如果确实忙碌，可以只输出 <回应状态>{"kind":"busy","reason":"第三人称的实际忙碌活动","footer":"忙碌中","eta":"暂不确定"}</回应状态>；卡片内情不是聊天台词，不另附心声。否则自然主动说话。`;
