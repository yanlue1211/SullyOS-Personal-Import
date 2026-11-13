// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({prepare:vi.fn(),error:vi.fn()}));vi.mock('../features/experience/media',()=>({prepareRealMedia:mocks.prepare}));vi.mock('../context/OSContext',()=>({useOS:()=>({showError:mocks.error,characters:[]})}));
import Tools from '../features/experience/Tools';
let container:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');container.style.overflow='hidden';container.style.transform='translateZ(0)';document.body.append(container);root=createRoot(container);mocks.prepare.mockReset();mocks.error.mockReset();});afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('places the menu outside a clipped transformed parent and uses separate simple labels',async()=>{await act(async()=>root.render(<Tools scopeId="a" onSend={async()=>{}} initialOpen/>));expect(container.querySelector('h3')).toBeNull();expect(document.body.textContent).toContain('更多功能');expect(document.body.textContent).toContain('照片');expect(document.body.textContent).toContain('视频');expect(document.body.textContent).not.toContain('真实图片');expect(document.body.textContent).not.toContain('真实视频');});
it('removes the blocking menu during capture and cancels without sending or showing an API error',async()=>{let signal:AbortSignal|undefined;const send=vi.fn();mocks.prepare.mockImplementation((_f,_p,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(signal!.reason)));});await act(async()=>root.render(<Tools scopeId="a" onSend={send} initialOpen initialTool="video"/>));const input=document.querySelector('[aria-label="选择视频文件"]') as HTMLInputElement;Object.defineProperty(input,'files',{value:[new File(['video'],'test.mp4',{type:'video/mp4'})]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(document.querySelector('h3')).toBeNull();expect(document.body.textContent).toContain('视频处理中');const cancel=[...document.querySelectorAll('button')].find(b=>b.textContent==='取消视频处理')!;await act(async()=>cancel.click());expect(signal?.aborted).toBe(true);expect(send).not.toHaveBeenCalled();expect(mocks.error).not.toHaveBeenCalled();});

it('stages selected photos without sending, centers photo and video controls, and leaves sending to the composer',async()=>{const stage=vi.fn(),send=vi.fn(),preparing=vi.fn();mocks.prepare.mockResolvedValue({content:'本地照片',metadata:{realMedia:{kind:'image'}}});await act(async()=>root.render(<Tools scopeId="a" onSend={send} onStageMedia={stage} onMediaPreparing={preparing} initialOpen/>));const input=document.querySelector('[aria-label="选择照片文件"]') as HTMLInputElement;for(const text of ['照片','视频'])expect([...document.querySelectorAll('button')].find(b=>b.textContent===text)?.tagName).toBe('BUTTON');Object.defineProperty(input,'files',{value:[new File(['image'],'p.jpg',{type:'image/jpeg'})]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(stage).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();expect(preparing.mock.calls.map(v=>v[0])).toEqual([true,false]);expect(document.querySelector('h3')).toBeNull();});

it('opens the video picker once and isolates portal clicks from the scene, then removes every blocking dialog',async()=>{
 const parent=vi.fn(),stage=vi.fn(),send=vi.fn();
 mocks.prepare.mockResolvedValue({content:'视频',metadata:{realMedia:{kind:'video'}}});
 await act(async()=>root.render(<div onClick={parent}><Tools scopeId="a" onSend={send} onStageMedia={stage} initialOpen initialTool="video"/></div>));
 const input=document.querySelector('[aria-label="选择视频文件"]') as HTMLInputElement;
 const picker=vi.spyOn(input,'click');
 const choose=[...document.querySelectorAll('button')].find(b=>b.textContent==='选择视频')!;
 await act(async()=>choose.click());
 expect(picker).toHaveBeenCalledOnce();expect(parent).not.toHaveBeenCalled();
 Object.defineProperty(input,'files',{value:[new File(['v'],'v.mp4',{type:'video/mp4'})]});
 await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(mocks.prepare).toHaveBeenCalledOnce();expect(stage).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.querySelector('[role="status"]')).toBeNull();
 expect(picker).toHaveBeenCalledOnce();expect(parent).not.toHaveBeenCalled();
});
it('recovers after failed capture and lets the user close the menu',async()=>{
 mocks.prepare.mockRejectedValue(new Error('解码失败'));
 await act(async()=>root.render(<Tools scopeId="a" onSend={vi.fn()} initialOpen initialTool="video"/>));
 const input=document.querySelector('[aria-label="选择视频文件"]') as HTMLInputElement;
 Object.defineProperty(input,'files',{value:[new File(['v'],'v.mp4',{type:'video/mp4'})]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(mocks.error).toHaveBeenCalledOnce();
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='关闭')!.click());
 expect(document.querySelector('[role="dialog"]')).toBeNull();
});
