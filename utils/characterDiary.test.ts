import {ChatPrompts} from './chatPrompts';
import {it,expect} from 'vitest';
import {characterDiaryInstructions} from './characterDiary';
import {normalizeMessageContent} from './messageFormat';
it('supports an independent diary without a user entry and retains exchange mode',()=>{
 expect(characterDiaryInstructions(true,'2026-10-31')).toContain('不需要用户先写');expect(characterDiaryInstructions(false,'2026-10-31')).toContain('回应具体内容');
});
it('does not describe an independent diary as a response to a blank user page',()=>{
 const text=normalizeMessageContent({type:'score_card',role:'system',content:JSON.stringify({type:'diary_card',diaryKind:'character',date:'2026-10-31',charText:'今天打了个哈欠。',userText:''})} as any,'甲','我');expect(text).toContain('个人日记');expect(text).not.toContain('那页是空的');
});

it('keeps the actual chat history aware that the diary was written independently',()=>{
 const {apiMessages}=ChatPrompts.buildMessageHistory([{id:1,charId:'a',timestamp:Date.now(),type:'score_card',role:'system',content:JSON.stringify({type:'diary_card',diaryKind:'character',date:'2026-10-31',charText:'在花店买了盆薄荷。'})}] as any,20,{id:'a',name:'甲'} as any,{name:'我'} as any,[]);
 expect(JSON.stringify(apiMessages)).toContain('个人日记');expect(JSON.stringify(apiMessages)).not.toContain('那页是空的');
});
