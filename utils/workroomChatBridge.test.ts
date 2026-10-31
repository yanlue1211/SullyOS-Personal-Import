import { beforeEach, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
import { transactionDone, WORKROOM_STORES } from '../features/workroom/schema';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { shareWork } from '../features/workroom/collaboration';
import { buildChatRequestPayload } from './chatRequestPayload';
import { loadCharacterContextRange } from './chatContextRange';
import { applyAssistantPostProcessing, type PostProcessCtx } from './applyAssistantPostProcessing';
import { computeStreamPreviewBubbles } from './streamPreview';
import { sanitizeForNotification } from './sanitize';
const char={id:'a',name:'阿源',systemPrompt:'角色设定',workroomLinkEnabled:true,contextRangeMode:'manual',contextRangePolicyVersion:1,contextLimit:100} as any;
beforeEach(async()=>{localStorage.clear();const db=await openDB(),tx=db.transaction(['characters','messages',...WORKROOM_STORES],'readwrite'),done=transactionDone(tx);for(const n of ['characters','messages',...WORKROOM_STORES])tx.objectStore(n).clear();tx.objectStore('characters').put(char);tx.objectStore('characters').put({id:'c',name:'Claude',workroomLinkEnabled:true});await done;});
function ctx():PostProcessCtx{return {char,userProfile:{name:'User'} as any,emojis:[],contextMsgs:[],fullMessages:[],initialData:{},historyMsgCount:0,xhsCaches:{xsecTokenCache:new Map(),noteTitleCache:new Map(),commentUserIdCache:new Map(),commentAuthorNameCache:new Map(),commentParentIdCache:new Map()},api:{baseUrl:'http://localhost:0',headers:{},effectiveApi:{baseUrl:'http://localhost:0',apiKey:'',model:'test'}},hooks:{setMessages:vi.fn(),addToast:vi.fn()},instantRender:true,skipSecondPassLLM:true};}
it('实际普通聊天载荷有轻量协议，原后处理执行灵感并剥掉控制标签，心声仍单独保存',async()=>{
    await DB.saveMessage({charId:'a',role:'user',type:'text',content:'想做点好玩的'});
    const range=await loadCharacterContextRange(char);
    const payload=await buildChatRequestPayload({char,userProfile:{name:'User'} as any,groups:[],emojis:[],categories:[],historyMsgs:range.messages,contextLimit:100,contextHighWaterMark:range.hwm,recallEntryPoint:'chat_app'});
    expect(JSON.stringify(payload.fullMessages)).toContain('造物间轻量联动');
    await applyAssistantPostProcessing('想做一个小狗。<造物间>{"action":"idea","title":"狗狗","summary":"可以摸摸小狗"}</造物间><心声>{"state":"微笑","thoughts":"期待","undercurrent":""}</心声>',ctx());
    const rows=await DB.getMessagesByCharId('a',true);
    expect(rows.some(m=>m.type==='workroom_card'&&m.metadata.workroomEvent.kind==='inspiration')).toBe(true);
    expect(rows.filter(m=>m.role==='assistant'&&m.type==='text').map(m=>m.content).join('')).toBe('想做一个小狗。');
    expect(rows.some(m=>m.metadata?.innerVoice?.thoughts==='期待')).toBe(true);
    expect(await W.list('a')).toHaveLength(1);
});
it('用户分享后由模型明确动作接收，主后处理产生独立副本及接收卡',async()=>{
    const work=await W.create('c','日历','看日期');await W.saveDraft('c',work.id,{html:'<p>日历</p>',css:'',js:''},0,null);await W.publish('c',work.id,1);
    const share=await shareWork('c',work.id,'a');
    await applyAssistantPostProcessing('我想留下一个。<造物间>'+JSON.stringify({action:'accept',shareId:share.id})+'</造物间>',ctx());
    expect(await W.list('a')).toHaveLength(1);
    expect((await DB.getMessagesByCharId('a',true)).some(m=>m.metadata?.workroomEvent?.kind==='accepted')).toBe(true);
});
it('所有流式边界、通知和关闭状态下都不泄漏控制 JSON，关闭时不创建灵感',async()=>{
    const raw='有个想法。<造物间>\n{"action":"idea","title":"私有控制字段","summary":"想法"}\n</造物间>';
    for(let i=1;i<=raw.length;i++)expect(computeStreamPreviewBubbles(raw.slice(0,i)).join('')).not.toMatch(/action|私有控制字段|summary|造物间/);
    expect(sanitizeForNotification(raw)).toBe('有个想法。');
    await DB.saveCharacter({...char,workroomLinkEnabled:false});await applyAssistantPostProcessing(raw,ctx());
    expect(await W.list('a')).toEqual([]);
    expect((await DB.getMessagesByCharId('a',true)).map(m=>m.content).join('')).not.toContain('私有控制字段');
});
