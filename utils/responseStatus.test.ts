import { describe, it, expect } from 'vitest';
import { extractResponseStatus, responseStatusContext, readResponseStatus } from '../features/personal/responseStatus/protocol';
import { computeStreamPreviewBubbles } from './streamPreview';
import { normalizeMessageContent } from './messageFormat';
import { ChatPrompts } from './chatPrompts';
import { sanitizeForNotification } from './sanitize';
const card = { type:'response_status' as const, kind:'read' as const, reason:'他有些害羞，暂时找不到话接。',footer:'稍微缓一缓',eta:'' };
const tag = `<回应状态>${JSON.stringify(card)}</回应状态>`;
it('parses a typed status and keeps narration separate from spoken dialogue', () => {
  expect(extractResponseStatus(tag)).toEqual(card);
  expect(responseStatusContext(card,'阿甲')).toContain('未说出口');
  expect(readResponseStatus(JSON.stringify(card))).toEqual(card);
  const msg = {id:1,charId:'a',role:'assistant',type:'score_card',content:JSON.stringify(card),timestamp:1} as any;
  expect(normalizeMessageContent(msg,'阿甲','用户')).toContain('[已读不回]');
  const history=ChatPrompts.buildMessageHistory([msg],50,{id:'a',name:'阿甲'} as any,{name:'用户'} as any,[]);
  expect(JSON.stringify(history)).toContain('选择暂时不回复');
});
it('busy means unavailable, not read, and estimates do not promise a timed reply', () => {
  const busy=extractResponseStatus(`<回应状态>${JSON.stringify({...card,kind:'busy',eta:'半小时'})}</回应状态>`)!;
  expect(responseStatusContext(busy)).toContain('不能据此视为已读');
  expect(responseStatusContext(busy)).toContain('不是定时回复承诺');
  expect(sanitizeForNotification(`<回应状态>${JSON.stringify(busy)}</回应状态>`)).toContain('半小时');
});
it('does not execute a status example in reasoning or accept malformed payloads', () => {
  expect(extractResponseStatus(`<think>${tag}</think>正常回复`)).toBeUndefined();
  expect(extractResponseStatus('<回应状态>{"kind":"read"}</回应状态>')).toBeUndefined();
});
it('suppresses partial status JSON and all extra speech in streaming and notifications', () => {
  for(const raw of ['<回应','<回应状','<回应状态>',tag,`多余台词\n${tag}\n另一句`]) expect(computeStreamPreviewBubbles(raw)).toEqual([]);
  expect(sanitizeForNotification(`${tag}不应该出现的台词`)).toBe('消息已读，暂时不回复');
});

it('strips read and busy protocols from proactive delivery without dropping actual speech', async () => {
  const {stripResponseStatus,isProactiveStatusDelivery}=await import('../features/personal/responseStatus/protocol');
  for(const kind of ['read','busy']){
    const value={...card,kind};const status=`<回应状态>${JSON.stringify(value)}</回应状态>`;
    expect(stripResponseStatus(status)).toBe('');
    expect(stripResponseStatus(`想和你聊聊。${status}`)).toBe('想和你聊聊。');
    expect(stripResponseStatus(JSON.stringify(value))).toBe('');
    expect(stripResponseStatus('<回应状态>{"kind":')).toBe('');
  }
  expect(isProactiveStatusDelivery({messageType:'scheduled'})).toBe(true);
  expect(isProactiveStatusDelivery({})).toBe(true);
  expect(isProactiveStatusDelivery({messageType:'instant'})).toBe(false);
  expect(isProactiveStatusDelivery({messageSubtype:'instant-chat'})).toBe(false);
});
