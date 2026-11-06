// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import AudioApiFields,{audioConfigFromPreset} from '../components/settings/AudioApiFields';
vi.mock('../components/os/Modal',()=>({default:({isOpen,children}:any)=>isOpen?React.createElement('section',null,children):null}));
vi.mock('../components/settings/ModelPicker',()=>({default:({availableModels,confirmModelPicker}:any)=>React.createElement('div',null,...availableModels.map((m:string)=>React.createElement('button',{key:m,onClick:()=>confirmModelPicker(m)},m)))}));
const original={enabled:true,baseUrl:'https://audio.example/v1',apiKey:'audio-key',model:'old-audio',songQuality:'lossless' as const};
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('loads the complete preset while retaining audio switches and quality',()=>{
 const p={id:'p',name:'预设',config:{baseUrl:'https://preset.example/v1/',apiKey:'new-key',model:'new-audio'}} as any;
 const next=audioConfigFromPreset(p,original);expect(next).toEqual({...original,baseUrl:'https://preset.example/v1',apiKey:'new-key',model:'new-audio'});expect(original.model).toBe('old-audio');
});
it('fetches audio endpoint models and changes only the model after explicit selection',async()=>{
 const fetcher=vi.fn(async(_input: RequestInfo | URL, _init?: RequestInit)=>new Response(JSON.stringify({data:[{id:'audio-new'},{id:'other-model'}]})));vi.stubGlobal('fetch',fetcher);
 const change=vi.fn();await act(async()=>root.render(React.createElement(AudioApiFields,{config:original,presets:[],onChange:change})));
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='拉取模型')!;
 await act(async()=>{button.click();await new Promise(r=>setTimeout(r,20));});
 expect(fetcher.mock.calls[0][0]).toBe('https://audio.example/v1/models');expect(change).not.toHaveBeenCalled();
 const choose=[...host.querySelectorAll('button')].find(b=>b.textContent==='audio-new')!;
 await act(async()=>choose.click());expect(change).toHaveBeenCalledWith({...original,model:'audio-new'});
});
it('ignores a model list response after the endpoint has been changed',async()=>{
 let complete!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{complete=r;})));
 const change=vi.fn();await act(async()=>root.render(React.createElement(AudioApiFields,{config:original,presets:[],onChange:change})));
 await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='拉取模型')!.click();});
 await act(async()=>root.render(React.createElement(AudioApiFields,{config:{...original,baseUrl:'https://different.example/v1'},presets:[],onChange:change})));
 await act(async()=>{complete(new Response(JSON.stringify({data:[{id:'stale-model'}]})));await new Promise(r=>setTimeout(r,10));});
 expect(host.textContent).not.toContain('stale-model');expect(change).not.toHaveBeenCalled();
});
