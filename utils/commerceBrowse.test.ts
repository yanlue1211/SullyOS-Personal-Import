// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { DB } from './db';
import { ActiveMsgStore } from './activeMsgStore';
import { commerceContext, readCommerce, saveProducts, saveCommerceMembers } from './personalCommerce';
import { queryCommerceProducts, resolveCommerceBrowse, COMMERCE_BROWSE_LIMIT, COMMERCE_BROWSE_ROUNDS } from './commerceBrowse';
import { applyAssistantPostProcessing } from './applyAssistantPostProcessing';
import { safeFetchJson } from './safeApi';
import { sanitizeIntoSegments } from './sanitize';
import { computeStreamPreviewBubbles } from './streamPreview';
vi.mock('./safeApi', async original => ({ ...await original<typeof import('./safeApi')>(), safeFetchJson: vi.fn() }));
const p = (i: number, kind: 'taobao'|'meituan' = 'taobao') => ({id:`product-${kind}-${i}`,kind,title:`棉麻衬衫${i}`,shop:'棉麻记',detail:'日常衣服',price:79});
beforeEach(async()=>{vi.clearAllMocks();await DB.deleteDB();await saveProducts(Array.from({length:200},(_,i)=>p(i)),'taobao');await saveProducts([p(1,'meituan')],'meituan');await saveCommerceMembers('taobao',['a']);});
it('a growing catalog never enters the ordinary prompt',async()=>{
 const guide=(await commerceContext('a')).guide;
 expect(guide).toContain('<逛商城>');expect(guide).not.toContain('product-');expect(guide).not.toContain('棉麻衬衫');
 await saveProducts([p(1)],'taobao');expect((await commerceContext('a')).guide).toBe(guide);
});
it('queries paginate without the old first-48 cutoff and enforce membership',async()=>{
 const first=await queryCommerceProducts('a',{query:'衬衫'});
 expect(first.products).toHaveLength(COMMERCE_BROWSE_LIMIT);expect(first.total).toBe(200);expect(first.nextOffset).toBe(8);
 expect((await queryCommerceProducts('a',{query:'棉麻衬衫199'})).products[0].id).toBe(p(199).id);
 expect((await queryCommerceProducts('a',{kind:'meituan'})).products).toEqual([]);
 await saveCommerceMembers('taobao',[]);expect((await queryCommerceProducts('a',{})).total).toBe(0);
});
it('ordinary conversation makes no follow-up request',async()=>{
 const complete=vi.fn();expect(await resolveCommerceBrowse({text:'今天吃什么',charId:'a',messages:[],complete})).toBe('今天吃什么');expect(complete).not.toHaveBeenCalled();
});
it('bounds repeated queries and does not leak protocol tags or create orders',async()=>{
 const complete=vi.fn(async()=>'<逛商城>{"query":"衬衫"}</逛商城>');
 expect(await resolveCommerceBrowse({text:'<逛商城>{}</逛商城>',charId:'a',messages:[],complete})).toBe('');
 expect(complete).toHaveBeenCalledTimes(COMMERCE_BROWSE_ROUNDS);expect((await readCommerce()).orders).toHaveLength(0);
});
it.each([false,true])('local/cloud postprocessing queries before ordering and preserves heart (cloud=%s)',async cloud=>{
 const id=p(199).id;
 vi.mocked(safeFetchJson).mockResolvedValue({choices:[{message:{content:`挑了件衬衫\n<购物>{"productId":"${id}","recipient":"user"}</购物>\n<心声>{"state":"开心","thoughts":"想给她挑合适的","undercurrent":""}</心声>`}}]});
 const originals=[{role:'system',content:'原有稳定提示'},{role:'user',content:'聊完了'}];
 await applyAssistantPostProcessing('<逛商城>{"query":"棉麻衬衫199"}</逛商城>',{
  char:{id:'a',name:'甲',innerVoiceEnabled:true} as any,userProfile:{name:'我'} as any,emojis:[],contextMsgs:[],fullMessages:originals,initialData:{},historyMsgCount:1,
  xhsCaches:{xsecTokenCache:new Map(),noteTitleCache:new Map(),commentUserIdCache:new Map(),commentAuthorNameCache:new Map(),commentParentIdCache:new Map()},
  api:{baseUrl:'https://model.invalid/v1',headers:{},effectiveApi:{baseUrl:'https://model.invalid/v1',apiKey:'',model:'same-model'}},
  hooks:{setMessages:vi.fn(),addToast:vi.fn()},instantRender:true,skipSecondPassLLM:cloud,directives:[],
 });
 expect(safeFetchJson).toHaveBeenCalledTimes(1);
 const body=JSON.parse(vi.mocked(safeFetchJson).mock.calls[0][1]!.body as string);
 expect(body.model).toBe('same-model');expect(body.messages.slice(0,2)).toEqual(originals);expect(JSON.stringify(body)).toContain(id);
 expect((await readCommerce()).orders).toHaveLength(1);
 const messages=await DB.getMessagesByCharId('a');expect(messages.some(m=>m.role==='assistant'&&m.metadata?.innerVoice)).toBe(true);
 expect(messages.filter(m=>m.role==='assistant').map(m=>m.content).join('')).not.toContain('<逛商城>');
});

it('keeps multiline cloud queries atomic and out of banners and previews',()=>{
 const raw='<逛商城>\n{"query":"衬衫"}\n</逛商城>';
 const parts=sanitizeIntoSegments(raw);
 expect(parts).toHaveLength(1);expect(parts[0].raw).toBe(raw);expect(parts[0].sanitized).toBe('[正在逛商城]');
 expect(computeStreamPreviewBubbles(raw+'\n')).toEqual([]);
});

it('frozen cloud context survives reload-style reads and never crosses characters or request IDs',async()=>{
 const messages=[{role:'system',content:'原人设与世界书'},{role:'user',content:'原始消息'}];
 await ActiveMsgStore.saveCommerceContinuation('snapshot-a',{uuid:'old',model:'same',messages});
 expect((await ActiveMsgStore.getCommerceContinuation('snapshot-a','old'))?.messages).toEqual(messages);
 expect(await ActiveMsgStore.getCommerceContinuation('snapshot-b','old')).toBeNull();
 await ActiveMsgStore.saveCommerceContinuation('snapshot-a',{uuid:'new',model:'same',messages});
 await ActiveMsgStore.clearCommerceContinuation('snapshot-a','old');
 expect(await ActiveMsgStore.getCommerceContinuation('snapshot-a','old')).toBeNull();
 expect(await ActiveMsgStore.getCommerceContinuation('snapshot-a','new')).not.toBeNull();
 await ActiveMsgStore.clearCommerceContinuation('snapshot-a','new');
 expect(await ActiveMsgStore.getCommerceContinuation('snapshot-a','new')).toBeNull();
});
