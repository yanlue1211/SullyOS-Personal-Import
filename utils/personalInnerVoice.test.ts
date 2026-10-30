import { describe, expect, it } from 'vitest';
import { extractInnerVoice, INNER_VOICE_SYSTEM } from '../features/personal/innerVoice/protocol';
import { IncrementalCallSpeech } from './incrementalCallSpeech';
import { ChatPrompts } from './chatPrompts';
import { parseCallAssistantMessage } from './callReplyFormat';
const heart = { state: '收起文件，抬眼看屏幕。', thoughts: '总算能歇一会儿。', undercurrent: '' };
const raw = `嗯，我在。<心声>${JSON.stringify(heart)}</心声>`;
describe('fictional character inner voice', () => {
 it('separates optional dark feelings from spoken dialogue', () => { expect(extractInnerVoice(raw)).toEqual({ text: '嗯，我在。', innerVoice: heart }); expect(parseCallAssistantMessage({ content: raw }).innerVoice).toEqual(heart); });
 it('never reads inner voice at any streaming boundary, even malformed or unfinished', () => { const out: string[] = []; const stream = new IncrementalCallSpeech(text => out.push(text)); for(let i=1;i<=raw.length;i++) stream.update(raw.slice(0,i)); stream.finish(raw); expect(out.join('')).toBe('嗯，我在。'); expect(extractInnerVoice('你好。<心声>未完成').text).toBe('你好。'); });
 it('restores inner voice in ordinary history as private fictional character context', () => { const {apiMessages} = ChatPrompts.buildMessageHistory([{id:1,charId:'a',role:'assistant',type:'text',content:'嗯，我在。',timestamp:Date.now(),metadata:{innerVoice:heart}}],10,{id:'a'} as any,{} as any,[]); expect(JSON.stringify(apiMessages)).toContain('总算能歇'); expect(JSON.stringify(apiMessages)).toContain('未说出口'); });
 it('does not require a possessive or sexual undercurrent', () => { expect(INNER_VOICE_SYSTEM).toContain('与用户无关'); expect(INNER_VOICE_SYSTEM).toContain('允许空字符串'); expect(INNER_VOICE_SYSTEM).toContain('不是模型推理过程'); });
});

it('persists one inner voice with the round and removes protocol tags from public messages', async () => {
 const { applyAssistantPostProcessing } = await import('./applyAssistantPostProcessing');
 const { DB } = await import('./db');
 const id = `heart-${Date.now()}`;
 await applyAssistantPostProcessing(raw, { char:{id,name:'测试角色'}, userProfile:{name:'用户'}, emojis:[],contextMsgs:[],fullMessages:[],initialData:{},historyMsgCount:0,xhsCaches:{xsecTokenCache:new Map(),noteTitleCache:new Map(),commentUserIdCache:new Map(),commentAuthorNameCache:new Map(),commentParentIdCache:new Map()},api:{baseUrl:'http://localhost:0',headers:{},effectiveApi:{baseUrl:'http://localhost:0',apiKey:'',model:'test'}},hooks:{setMessages:()=>{},addToast:()=>{}},instantRender:true,skipSecondPassLLM:true } as any);
 const messages=await DB.getMessagesByCharId(id,true);
 expect(messages.filter(message=>message.metadata?.innerVoice)).toHaveLength(1);
 expect(messages.find(message=>message.metadata?.innerVoice)?.metadata.innerVoice).toEqual(heart);
 expect(messages.map(message=>message.content).join('')).not.toContain('<心声>');
});
