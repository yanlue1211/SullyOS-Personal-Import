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
