import slangWorldbook from '../test/fixtures/chat-slang-worldbook.json';
import { parseStandardWorldbook } from './worldbook';
import { describe, it, expect } from 'vitest';
import { buildChatRequestPayload } from './chatRequestPayload';
import { buildChatOutputStylePrompt } from './chatOutputStylePrompt';
import { ChatPrompts } from './chatPrompts';
import { extractInnerVoice } from '../features/personal/innerVoice/protocol';
import { DB } from './db';
import { usesHumanStyle, usesInnerVoice, MINIMAL_THINKING_PROMPT } from './chatPromptPreferences';

it('imports the exact delivered four-entry slang worldbook', () => {
 const books=parseStandardWorldbook(JSON.stringify(slangWorldbook),'玩梗与造梗');
 expect(books).toHaveLength(4);expect(books.every(book=>book.constant&&!book.disable&&book.position===1)).toBe(true);
 expect(books.map(book=>book.content).join('')).toContain('不原样复读');
});

describe('independent per-character chat prompt preferences', () => {
 it('keeps existing defaults and stores preferences without changing another character', async () => {
  expect(usesHumanStyle({})).toBe(true); expect(usesInnerVoice({})).toBe(true);
  await DB.saveCharacter({id:'prefs-a',name:'a',humanStyleEnabled:false,innerVoiceEnabled:false} as any);
  await DB.saveCharacter({id:'prefs-b',name:'b'} as any);
  expect((await DB.getCharacter('prefs-a'))?.humanStyleEnabled).toBe(false);
  expect(usesHumanStyle((await DB.getCharacter('prefs-b'))!)).toBe(true);
 });
 it.each([true,false])('keeps functional protocols and history when human style is %s', async humanStyleEnabled => {
  const char = {id:'prefs-payload', name:'角色名', systemPrompt:'PERSONA_SENTINEL',refinedMemories:{'2026-10':'MEMORY_SENTINEL'},humanStyleEnabled,innerVoiceEnabled:false,
   mountedWorldbooks:[{id:'wb',title:'书',content:'WORLDBOOK_SENTINEL',constant:true,position:1}],
  } as any;
  const payload = await buildChatRequestPayload({char,userProfile:{name:'用户'} as any,groups:[],emojis:[],categories:[],
   historyMsgs:[{id:1,charId:char.id,role:'user',type:'text',content:'HISTORY_SENTINEL',timestamp:Date.now()}] as any,contextLimit:20});
  const full = JSON.stringify(payload.fullMessages);
  expect(full).toContain('HISTORY_SENTINEL'); expect(full).toContain('MEMORY_SENTINEL'); expect(full).toContain('ACTION:TRANSFER');
  expect(full).not.toContain('角色心声固定协议');
  if(humanStyleEnabled){expect(full).toContain('PERSONA_SENTINEL');expect(full).toContain('WORLDBOOK_SENTINEL');expect(full).toContain('相对更浓烈的表达');expect(full).toContain('生活多样性');expect(full).toContain('禁止无意义道谢');expect(full).toContain('日常陪伴不升华');expect(full).toContain('不是普通的笑，是……');}
  else {expect(full).not.toContain('PERSONA_SENTINEL');expect(full).not.toContain('WORLDBOOK_SENTINEL');expect(full).not.toContain('最后，回到你自己');expect(full).not.toContain('日程 ·');expect(full).toContain('第一人称、现在时');}
 });
 it.each([true,false])('builds cloud template parts with heart independently %s', async innerVoiceEnabled => {
  const parts=await ChatPrompts.buildSystemPromptParts({id:'prefs-cloud',name:'a',humanStyleEnabled:false,innerVoiceEnabled} as any,{name:'u'} as any,[],[],[],[],undefined,undefined,undefined,undefined,undefined,undefined,{forFirePack:true});
  expect(parts.recencyTail).toBe('');expect(parts.stable.includes('角色心声固定协议')).toBe(innerVoiceEnabled);
 });
 it('retains Chinese first-person thinking rules without roleplay, custom roleplay or third-person analysis', () => {
  const output=buildChatOutputStylePrompt({charName:'a',humanStyleEnabled:false,thinkingChain:{enabled:true,customPrompt:'CUSTOM_ROLE_SENTINEL'}});
  expect(output.prompt).toContain(MINIMAL_THINKING_PROMPT);expect(output.prompt).not.toContain('CUSTOM_ROLE_SENTINEL');expect(output.prompt).not.toContain('双倍叽叽喳喳');expect(output.prompt).toContain('第三人称分析');
 });
 it('recovers a complete trailing three-field heart without consuming ordinary conversation', () => {
  expect(extractInnerVoice('好。\n状态：坐着\n内心：想笑\n暗流：')).toEqual({text:'好。',innerVoice:{state:'坐着',thoughts:'想笑',undercurrent:''}});
  expect(extractInnerVoice('当前状态：待定\n内心：这只是谈论两个字段')).toEqual({text:'当前状态：待定\n内心：这只是谈论两个字段'});
 });
});

it('online IM cadence is stronger, scoped and remains before the final return-to-character tail', async () => {
 const human = {id:'im-cadence',name:'小夏',humanStyleEnabled:true,innerVoiceEnabled:false} as any;
 const user = {name:'用户'} as any;
 const parts = await ChatPrompts.buildSystemPromptParts(human,user,[],[],[],[],undefined,undefined,undefined,undefined,undefined,undefined,{});
 expect(parts.stable).toContain('IM 碎片化聊天｜仅线上打字');
 expect(parts.stable).toContain('每条尽量 5—15 个汉字');
 expect(parts.stable).toContain('普通闲聊不要使用句号');
 expect(parts.stable).toContain('不限制语音／视频通话、看屏陪伴');
 expect(parts.recencyTail).toContain('本轮线上聊天节奏');
 expect(parts.recencyTail.indexOf('本轮线上聊天节奏')).toBeLessThan(parts.recencyTail.indexOf('最后，回到你自己'));
 const nonHuman = await ChatPrompts.buildSystemPromptParts({...human,humanStyleEnabled:false},user,[],[],[],[],undefined,undefined,undefined,undefined,undefined,undefined,{});
 expect(nonHuman.stable).not.toContain('IM 碎片化聊天');
 expect(nonHuman.recencyTail).not.toContain('本轮线上聊天节奏');
 const otherApp = await ChatPrompts.buildSystemPromptParts(human,user,[],[],[],[],undefined,undefined,undefined,undefined,undefined,undefined,{appRules:'这是通话或其他模式的独立输出协议'});
 expect(otherApp.stable).not.toContain('IM 碎片化聊天');
 expect(otherApp.recencyTail).not.toContain('本轮线上聊天节奏');
});

it('preserves authored worldbook slots and places expression rules after the character context', async () => {
 const fixed=[0,1,2,3,5,6].map(position=>({id:`order-${position}`,title:`位置${position}`,content:`FIXED_WB_${position}`,constant:true,position,order:100}));
 const char={id:'prefs-order',name:'角色',systemPrompt:'ORDER_PERSONA',memories:[],mountedWorldbooks:[...fixed,
  {id:'order-d1',title:'深度1',content:'DEPTH_ONE',constant:true,position:4,depth:1,role:0},
  {id:'order-d0',title:'深度0',content:'DEPTH_ZERO',constant:true,position:4,depth:0,role:0},
 ]} as any;
 const payload=await buildChatRequestPayload({char,userProfile:{name:'用户'} as any,groups:[],emojis:[],categories:[],contextLimit:20,
  historyMsgs:[{id:1,charId:char.id,role:'assistant',type:'text',content:'PREVIOUS_TURN',timestamp:Date.now()-1000},{id:2,charId:char.id,role:'user',type:'text',content:'LATEST_USER',timestamp:Date.now()}] as any,
 });
 const messages=payload.fullMessages;
 const stable=String(messages[0].content);
 expect(stable.indexOf('FIXED_WB_0')).toBeLessThan(stable.indexOf('ORDER_PERSONA'));
 for(const position of [1,2,3,5,6]){
  expect(stable.indexOf('ORDER_PERSONA')).toBeLessThan(stable.indexOf(`FIXED_WB_${position}`));
  expect(stable.indexOf(`FIXED_WB_${position}`)).toBeLessThan(stable.indexOf('### 聊天补充'));
 }
 const at=(marker:string)=>messages.findIndex(message=>String(message.content).includes(marker));
 expect(at('DEPTH_ONE')).toBeLessThan(at('LATEST_USER'));
 expect(at('LATEST_USER')).toBeLessThan(at('DEPTH_ZERO'));
 expect(at('【表达硬性要求')).toBeLessThan(at('LATEST_USER'));
 expect(stable.indexOf('ORDER_PERSONA')).toBeLessThan(stable.indexOf('【表达硬性要求'));
 expect(stable).toContain('【本轮心声格式】');
 const tail=String(messages[messages.length-1].content);
 expect(tail).toContain('最后，回到你自己');expect(tail).not.toContain('【表达硬性要求');expect(tail).not.toContain('【反煽情');expect(tail).not.toContain('【本轮心声格式】');
 expect(char.mountedWorldbooks.map((book:any)=>book.id)).toEqual([...fixed.map(book=>book.id),'order-d1','order-d0']);
});

it.each([true,false])('history and per-turn recall changes preserve the fixed prefix (human style=%s)', async humanStyleEnabled => {
 const char={id:'cache-prefix',name:'角色',systemPrompt:'CACHE_PERSONA',humanStyleEnabled,memoryPalaceEnabled:true,memories:[]} as any;
 const build=(memory:string,content:string)=>ChatPrompts.buildSystemPromptParts({...char,memoryPalaceInjection:memory},{name:'用户'} as any,[],[],[],[],undefined,undefined,undefined,undefined,undefined,undefined,{history:[{role:'user',content}]});
 const first=await build('RECALL_A','USER_A');const second=await build('RECALL_B','USER_B');
 expect(first.stable).toBe(second.stable);expect(first.recencyTail).toBe(second.recencyTail);expect(first.recencyTail.includes('最后，回到你自己')).toBe(humanStyleEnabled);expect(first.recencyTail).not.toContain('【反煽情');
 expect(first.stable).not.toContain('RECALL_A');expect(first.stable).not.toContain('USER_A');
 expect(first.volatileState).toContain('RECALL_A');expect(second.volatileState).toContain('RECALL_B');
});
