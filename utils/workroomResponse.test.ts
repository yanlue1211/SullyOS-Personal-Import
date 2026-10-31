import {it,expect,vi} from 'vitest';
import {parseCompleteJson,assertResponseComplete,showWorkroomFailure,WorkroomResponseError} from '../features/workroom/response';
it('accepts complete JSON presentation wrappers and preserves string content',()=>{
 expect(parseCompleteJson('结果：\n```json\n{"title":"新题", "items":[1,2,],}\n```')).toEqual({title:'新题',items:[1,2]});
 expect(parseCompleteJson('{"text":"第一行\n第二行",}')).toEqual({text:'第一行\n第二行'});
 expect(parseCompleteJson('{"code":"const x = [1,];",}')).toEqual({code:'const x = [1,];'});
});
it('never salvages a child from truncated JSON or guesses missing brackets',()=>{
 for(const raw of ['[{"ok":true}', '{"child":{"ok":true}', '```json\n{"ok":true}', '{"a":1}{"b":2}']) expect(()=>parseCompleteJson(raw)).toThrow();
});
it('reports a truncated model response with diagnostic details, once, and ignores cancellation',()=>{
 let failure:unknown;try{assertResponseComplete({choices:[{finish_reason:'length'}]},{stage:'游戏生成',maxTokens:8192,model:'test'});}catch(error){failure=error;}
 expect(failure).toBeInstanceOf(WorkroomResponseError);const popup=vi.fn();
 showWorkroomFailure(popup,'失败',failure);showWorkroomFailure(popup,'失败',failure);
 expect(popup).toHaveBeenCalledTimes(1);expect(popup.mock.calls[0][1]).toContain('8192');
 expect(popup.mock.calls[0][1]).toContain('length');
 showWorkroomFailure(popup,'取消',new DOMException('cancelled','AbortError'));expect(popup).toHaveBeenCalledTimes(1);
});

it('accepts complete single-line or same-line-closing JSON fences',()=>{
 for(const raw of ['```json\n{"question":"题目"}```','```json {"question":"题目"}```','这里是结果：\n```json\r\n{"question":"题目"}\r\n```\n完成。'])expect(parseCompleteJson(raw)).toEqual({question:'题目'});
 for(const raw of ['```json {"ok":true}```\n```json {"bad":true}```','```json {"ok":true}```\n```json {"bad":','[{"ok":true}'])expect(()=>parseCompleteJson(raw)).toThrow();
});
it('diagnostic previews redact credentials and reasoning before truncating, without altering the model response',async()=>{
 const {responsePreview}=await import('../features/workroom/response');
 const raw='<think>private reasoning</think>{"apiKey":"unusual-secret","password":"private","text":"Bearer credential sk-abc123 configured-key"}';
 const preview=responsePreview(raw,['configured-key']);
 for(const secret of ['private reasoning','unusual-secret','private"','credential','sk-abc123','configured-key'])expect(preview).not.toContain(secret);
 expect(raw).toContain('configured-key');
 expect(responsePreview('x'.repeat(9000))).toContain('中间内容省略');
 const error=new WorkroomResponseError('格式失败',{stage:'游戏',preview});expect(error.details).toContain(preview);
});
