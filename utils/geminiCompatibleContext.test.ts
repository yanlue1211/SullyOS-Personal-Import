import {describe,it,expect,vi} from 'vitest';
import {prepareGeminiCompatibleContext,GEMINI_CONTEXT_NOTE,markGeminiLiveContext} from './geminiCompatibleContext';
import {fetchLlm} from './anthropicApi';
const body=(round=0)=>({model:'[channel] gemini-4-argon-high',tools:[{type:'function',function:{name:'schedule',parameters:{type:'object'}}}],messages:[
 {role:'system',content:'character and worldbooks'},
 {role:'user',content:'old input'},
 {role:'system',name:'sully_history_context',content:'archived social event'},
 {role:'assistant',content:'old answer'},
 ...(round?[{role:'user',content:'new input'},{role:'assistant',content:'new answer'}]:[]),
 {role:'user',content:'latest '+round},
 {role:'system',content:'pending task order '+round},
 {role:'system',name:'sully_live_context',content:'recall '+round+' song '+round+' time '+round},
]});
describe('tagged Gemini compatible context',()=>{
 it('retains history prefix while recall, songs, task order and dialogue change',()=>{
  const a=body(),saved=structuredClone(a),first=prepareGeminiCompatibleContext(a),next=prepareGeminiCompatibleContext(body(1));
  expect(a).toEqual(saved);expect(first.messages.slice(0,4)).toEqual(next.messages.slice(0,4));
  expect(first.messages[0].content).toBe('character and worldbooks\n'+GEMINI_CONTEXT_NOTE);
  expect(first.messages[2]).toEqual({role:'user',content:'<system-reminder>\narchived social event\n</system-reminder>'});
  expect(next.messages.at(-1).content).toContain('recall 1 song 1 time 1');expect(next.messages.at(-2).content).toContain('pending task order 1');
  expect(first.tools).toBe(a.tools);
 });
 it('leaves other models, untagged paths including Lite, and unknown system blocks unchanged',()=>{
  const other={...body(),model:'claude-test'};expect(prepareGeminiCompatibleContext(other)).toBe(other);
  const untagged={...body(),messages:body().messages.map(({name,...m}:any)=>m)};expect(prepareGeminiCompatibleContext(untagged)).toBe(untagged);
  const unknown=body();(unknown.messages.at(-1) as any).content=[{type:'unknown',data:'must survive'}];expect(prepareGeminiCompatibleContext(unknown)).toBe(unknown);
 });
 it('preserves image blocks, tool calls/results, leading developer instructions and text-array context',()=>{
  const b:any=body();b.messages.splice(1,0,{role:'developer',content:[{type:'text',text:'prefix'}]});
  const image={role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,abc'}}]};
  const call={role:'assistant',content:null,tool_calls:[{id:'c',type:'function',function:{name:'schedule',arguments:'{}'}}]};
  const result={role:'tool',tool_call_id:'c',content:'created'};b.messages.splice(-1,0,image,call,result);
  b.messages.at(-1).content=[{type:'text',text:'recall'},{type:'text',text:'song'}];
  const out=prepareGeminiCompatibleContext(b);expect(out.messages).toContain(image);expect(out.messages).toContain(call);expect(out.messages).toContain(result);
  expect(out.messages[1].content.at(-1).text).toBe(GEMINI_CONTEXT_NOTE);expect(out.messages.at(-1).content).toBe('<system-reminder>\nrecall\nsong\n</system-reminder>');
 });
 it.each([false,true])('applies at fetch boundary and preserves response/credentials (Request=%s)',async asRequest=>{
  const source=body(),raw=JSON.stringify(source),headers={'authorization':'Bearer secret','content-type':'application/json'};
  const response=new Response(JSON.stringify({usage:{prompt_tokens_details:{cached_tokens:35221}}}));const transport=vi.fn().mockResolvedValue(response);
  const request=new Request('https://relay.test/v1/chat/completions',{method:'POST',headers,body:raw});
  expect(await fetchLlm(asRequest?request:request.url,asRequest?undefined:{method:'POST',headers,body:raw},transport)).toBe(response);
  const init=transport.mock.calls[0][1];expect(JSON.parse(init.body)).toEqual(prepareGeminiCompatibleContext(source));expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret');
  expect(await request.text()).toBe(raw);
 });
 it('forwards unrelated relative POST and native Gemini without compatible rewriting',async()=>{
  const transport=vi.fn().mockResolvedValue(new Response('{}'));const init={method:'POST',body:'{}'};
  await fetchLlm('/api/other',init,transport);expect(transport).toHaveBeenCalledWith('/api/other',init);
 });
});

it('restores the cloud marker from the existing tail index without changing the fire_pack contract',()=>{
 const source=body().messages.map(({name,...m}:any)=>m),saved=structuredClone(source);
 const marked=markGeminiLiveContext(source,source.length-1);
 expect(marked.at(-1).name).toBe('sully_live_context');expect(source).toEqual(saved);
 expect(prepareGeminiCompatibleContext({...body(),messages:marked}).messages.at(-1).role).toBe('user');
 for(const invalid of [undefined,-1,0,1,1.5,source.length,'7'])expect(markGeminiLiveContext(source,invalid)).toBe(source);
});
