import {afterEach,it,expect,vi} from 'vitest';
import {ChatPrompts} from './chatPrompts';
import {buildChatRequestPayload} from './chatRequestPayload';
import {toAnthropicRequest} from './anthropicApi';
import {buildEmojiNameReminder} from './emojiNameResolver';
vi.mock('./emojiNameResolver',async original=>({...await original<any>(),buildEmojiNameReminder:vi.fn()}));
afterEach(()=>{localStorage.removeItem('sully_anthropic_prompt_cache_ttl');vi.useRealTimers();vi.restoreAllMocks();});
const char={id:'sticker-cache',name:'角色',persona:'角色资料保持不动',humanStyleEnabled:true,timeAwarenessEnabled:false,scheduleEnabled:false,emotionEnabled:false} as any;
const user={name:'用户',bio:'用户资料保持不动'} as any;
const emojis=[{name:'懵',url:'https://example.invalid/sticker.png'}];
const history=[{id:1,charId:char.id,role:'user',type:'text',content:'看到了吗',timestamp:1},{id:2,charId:char.id,role:'assistant',type:'text',content:'看到了',timestamp:2}] as any;
const reminder='\n[表情包名称校验] 只从可用表情库复制准确名称。\n';
it('leaves shared and personal stable prefixes byte-identical; reminder goes only into the existing tail',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-04T09:00:00Z'));
 const build=()=>ChatPrompts.buildSystemPromptParts(char,user,[],emojis,[],history,{weatherEnabled:false,newsEnabled:false} as any);
 vi.mocked(buildEmojiNameReminder).mockReturnValue('');const before=await build();
 vi.mocked(buildEmojiNameReminder).mockReturnValue(reminder);const after=await build();
 for(const key of ['stable','sharedPrefix','sharedWorldbookPrefix','volatileState','history'] as const)expect(after[key]).toEqual(before[key]);
 expect(after.recencyTail).toBe(reminder+before.recencyTail);
 expect(after.stable).not.toContain('[表情包名称校验]');
});
it.each(['5m','1h'])('preserves %s Anthropic cache breakpoints and every cached prefix byte, including history',async ttl=>{
 localStorage.setItem('sully_anthropic_prompt_cache_ttl',ttl);
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-04T09:00:00Z'));
 const input={char,userProfile:user,groups:[],emojis,categories:[],historyMsgs:history,contextLimit:20,realtimeConfig:{weatherEnabled:false,newsEnabled:false}} as any;
 vi.mocked(buildEmojiNameReminder).mockReturnValue('');const before=await buildChatRequestPayload(input);
 vi.mocked(buildEmojiNameReminder).mockReturnValue(reminder);const after=await buildChatRequestPayload(input);
 const oldRequest=toAnthropicRequest({model:'claude-opus-4-6',messages:before.fullMessages});
 const newRequest=toAnthropicRequest({model:'claude-opus-4-6',messages:after.fullMessages});
 // Cacheable system blocks and all history up to the final boundary are unchanged.
 expect(newRequest.system).toEqual(oldRequest.system);
 const prefix=(r:any)=>{const blocks=r.messages.flatMap((m:any)=>m.content);const last=blocks.map((b:any,i:number)=>b.cache_control?i:-1).filter((i:number)=>i>=0).at(-1);return blocks.slice(0,last===undefined?0:last+1);};
 expect(prefix(newRequest).length).toBeGreaterThan(0);
 expect(prefix(newRequest)).toEqual(prefix(oldRequest));
 expect(JSON.stringify(newRequest.messages).replace(JSON.stringify(reminder).slice(1,-1),'')).toBe(JSON.stringify(oldRequest.messages));
});
it('does not add a sticker reminder for an empty library or another App scene',async()=>{
 vi.mocked(buildEmojiNameReminder).mockReturnValue(reminder);
 const empty=await ChatPrompts.buildSystemPromptParts(char,user,[],[],[],[]);
 const app=await ChatPrompts.buildSystemPromptParts(char,user,[],emojis,[],[],undefined,undefined,undefined,undefined,undefined,undefined,{appRules:'另一个App'});
 expect(empty.recencyTail).not.toContain('[表情包名称校验]');expect(app.recencyTail).not.toContain('[表情包名称校验]');
});
