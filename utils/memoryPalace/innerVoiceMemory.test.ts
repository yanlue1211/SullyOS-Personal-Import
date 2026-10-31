import {beforeEach,it,expect,vi} from 'vitest';
import type {Message} from '../../types';
import {safeFetchJson} from '../safeApi';
import {extractMemoriesFromBuffer} from './extraction';
import {formatMessageForPrompt,formatMessageWithTime,isMessageSemanticallyRelevant,normalizeMessageContent} from '../messageFormat';
import {ChatPrompts} from '../chatPrompts';
vi.mock('../safeApi',async original=>({...await original<any>(),safeFetchJson:vi.fn()}));
const config={baseUrl:'https://example.invalid/v1',apiKey:'test',model:'test'};
const heart={state:'他转着杯子，嘴角却压着。',thoughts:'他其实很高兴被记住了。',undercurrent:'他有点嫉妒那位同行的人，但没有表现出来。'};
const row=(patch:Partial<Message>={}):Message=>({id:1,charId:'heart-memory',role:'assistant',type:'text',content:'回来就好。',timestamp:1793433600000,metadata:{innerVoice:heart},...patch});
beforeEach(()=>{vi.mocked(safeFetchJson).mockReset().mockResolvedValue({choices:[{message:{content:'[]'},finish_reason:'stop'}]});});
it('includes all three heart fields exactly once in automatic and manual archive material',()=>{
 for(const text of [formatMessageForPrompt(row(),'角色','用户'),formatMessageWithTime(row(),'角色','用户',()=> '16:00')]){
  expect(text).toContain('回来就好。');
  for(const value of Object.values(heart))expect(text.split(value)).toHaveLength(2);
  expect(text).toContain('不能记成已经向用户说过');expect(text).toContain('不等于实际行动');
 }
});
it('sends heart and its epistemic boundary in the actual extraction request without additional API calls',async()=>{
 await extractMemoriesFromBuffer([row()],'heart-memory','角色',config,undefined,'用户');
 expect(safeFetchJson).toHaveBeenCalledTimes(1);
 const request=JSON.parse(String(vi.mocked(safeFetchJson).mock.calls[0][1]?.body));
 const input=request.messages.find((m:any)=>m.role==='user').content;
 for(const value of Object.values(heart))expect(input).toContain(value);
 expect(input).toContain('用户未必知情');expect(input).toContain('双方已达成共识');
});
it('keeps heart-only assistant records eligible, but ignores missing, malformed and user-owned hearts',()=>{
 expect(isMessageSemanticallyRelevant(row({content:''}))).toBe(true);
 const user=row({role:'user'});expect(formatMessageForPrompt(user,'角色','用户')).not.toContain(heart.thoughts);
 for(const value of [undefined,{}, {state:1,thoughts:'bad'}, {state:' ',thoughts:'',undercurrent:''}]){
  const malformed=row({content:'',metadata:{innerVoice:value}});
  expect(isMessageSemanticallyRelevant(malformed)).toBe(false);
  expect(formatMessageForPrompt(malformed,'角色','用户')).not.toContain('心声记忆边界');
 }
});
it('does not duplicate heart in normal chat or change image/share/audio material',()=>{
 const result=ChatPrompts.buildMessageHistory([row()],50,{id:'heart-memory',name:'角色',timeAwarenessEnabled:false} as any,{name:'用户'} as any,[]);
 expect(JSON.stringify(result.apiMessages).split(heart.thoughts)).toHaveLength(2);
 expect(normalizeMessageContent(row(),'角色','用户')).toBe('回来就好。');
 const image=row({role:'user',type:'image',content:'https://example.invalid/photo',metadata:{visionDescription:'不要新增的识图内容'}});
 expect(isMessageSemanticallyRelevant(image)).toBe(false);expect(formatMessageForPrompt(image,'角色','用户')).toBe('[用户]: [图片]');
 const share=row({role:'user',type:'xhs_card',metadata:{xhsNote:{title:'分享',desc:'分享的文字'},visionDescription:'不要新增的识图内容'}});
 expect(formatMessageForPrompt(share,'角色','用户')).toContain('分享的文字');expect(formatMessageForPrompt(share,'角色','用户')).not.toContain('不要新增的识图内容');
});
it('allows empty undercurrent and preserves existing records without hearts unchanged',()=>{
 const noDark=row({metadata:{innerVoice:{...heart,undercurrent:''}}});
 expect(formatMessageForPrompt(noDark,'角色','用户')).not.toContain('暗流：');
 const old=row({metadata:{}});
 expect(formatMessageForPrompt(old,'角色','用户')).toBe('[角色]: 回来就好。');
 expect(formatMessageWithTime(old,'角色','用户',()=> '16:00')).toBe('[16:00] 角色: 回来就好。');
});
