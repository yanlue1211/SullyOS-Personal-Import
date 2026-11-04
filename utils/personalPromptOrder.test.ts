import { expect, it, vi } from 'vitest';
import { buildChatRequestPayload } from './chatRequestPayload';
import { toAnthropicRequest } from './anthropicApi';
import { ChatPrompts } from './chatPrompts';
import { buildInnerVoiceSystem, memoryMessagesWithoutInnerVoice } from '../features/personal/innerVoice/protocol';
import { formatMessageForPrompt, formatMessageWithTime } from './messageFormat';

vi.mock('./memoryPalace/pipeline', async original => ({...await original<any>(), injectMemoryPalace: vi.fn(async (character:any) => {character.memoryPalaceInjection='RECALL_SENTINEL';})}));
const heart = {state:'STATE_SENTINEL',thoughts:'HEART_SENTINEL',undercurrent:''};
const message = {id:1,charId:'order-heart',role:'assistant',type:'text',content:'BODY_SENTINEL',timestamp:1,metadata:{innerVoice:heart}} as any;
it('independently controls historical hearts without removing speech or mutating saved data', () => {
  for (const innerVoiceEnabled of [true,false]) {
    const build = (innerVoiceContextEnabled:boolean) => JSON.stringify(ChatPrompts.buildMessageHistory([message],20,{id:message.charId,innerVoiceEnabled,innerVoiceContextEnabled} as any,{name:'u'} as any,[]).apiMessages);
    expect(build(true)).toContain('HEART_SENTINEL');
    expect(build(false)).not.toContain('HEART_SENTINEL');
    expect(build(false)).toContain('BODY_SENTINEL');
  }
  const projected=memoryMessagesWithoutInnerVoice([message]);
  expect(formatMessageForPrompt(projected[0],'c','u')).not.toContain('HEART_SENTINEL');
  expect(formatMessageForPrompt(message,'c','u',false)).not.toContain('HEART_SENTINEL');
  expect(formatMessageWithTime(message,'c','u',()=>'',false)).toContain('BODY_SENTINEL');
  expect(message.metadata.innerVoice).toEqual(heart);
});
it('adds custom heart instructions without replacing the protocol', () => {
  const prompt=buildInnerVoiceSystem({innerVoiceCustomPrompt:'CUSTOM_HEART_80'});
  expect(prompt).toContain('CUSTOM_HEART_80');expect(prompt).toContain('三个固定字符串字段');
  expect(prompt).toContain('角色心声固定协议');
});
it('retains global mounting in authored slots, personal identity, user data, memory, depth and late recall', async () => {
  const books=[0,1,2,3,5,6].map(position=>({id:`g-${position}`,title:'global',content:`GLOBAL_SLOT_${position}`,constant:true,position,globalMount:true}));
  const character={id:'order-heart',name:'角色',systemPrompt:'PERSONA_SENTINEL',refinedMemories:{'2026-10':'MEMORY_SENTINEL'},memoryPalaceEnabled:true,memoryPalaceInjection:'RECALL_SENTINEL',
    mountedWorldbooks:[...books,{id:'depth',title:'depth',constant:true,position:4,depth:0,content:'DEPTH_SENTINEL'}]} as any;
  const result=await buildChatRequestPayload({char:character,userProfile:{name:'USER_SENTINEL',bio:'USER_BIO_SENTINEL'} as any,groups:[],emojis:[],categories:[],historyMsgs:[{...message,role:'user',content:'LATEST_SENTINEL'}],contextLimit:20});
  const stable=String(result.fullMessages[0].content), full=JSON.stringify(result.fullMessages);
  for (const marker of ['PERSONA_SENTINEL','MEMORY_SENTINEL','USER_BIO_SENTINEL',...books.map(b=>b.content)]) expect(stable.split(marker)).toHaveLength(2);
  expect(stable.indexOf('GLOBAL_SLOT_0')).toBeLessThan(stable.indexOf('PERSONA_SENTINEL'));
  expect(stable.indexOf('PERSONA_SENTINEL')).toBeLessThan(stable.indexOf('GLOBAL_SLOT_1'));
  expect(stable.indexOf('USER_BIO_SENTINEL')).toBeLessThan(stable.indexOf('### 聊天补充'));
  expect(stable).not.toContain('RECALL_SENTINEL');expect(full).toContain('DEPTH_SENTINEL');
  expect(full.indexOf('LATEST_SENTINEL')).toBeLessThan(full.indexOf('RECALL_SENTINEL'));
  expect(result.fullMessages.filter(m=>m.name?.startsWith('sully_shared'))).toHaveLength(0);
  const native=toAnthropicRequest({model:'c',messages:result.fullMessages});
  const recall=native.messages.flatMap((m:any)=>m.content).find((b:any)=>b.text?.includes('RECALL_SENTINEL'));
  expect(recall).not.toHaveProperty('cache_control');
  expect(character.mountedWorldbooks).toHaveLength(7);
});
