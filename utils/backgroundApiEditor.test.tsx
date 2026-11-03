// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {BackgroundApiEditor} from '../components/settings/BackgroundApiEditor';
import type {ApiPreset,DialogueApiConfig} from '../types';
const presets:ApiPreset[]=[{id:'one',name:'日常按次模型',group:'日常',config:{baseUrl:'https://daily.test/v1',apiKey:'daily-key',model:'daily-model',apiType:'openai',stream:false,temperature:.7,maxTokens:1234}},{id:'two',name:'原生预设',group:'写作',config:{baseUrl:'https://native.test/v1',apiKey:'native-key',model:'native-model',apiType:'anthropic'}}] as ApiPreset[];
let root:Root,host:HTMLDivElement;const save=vi.fn();
const inherited={baseUrl:'https://main.test/v1',apiKey:'main-key',model:'main-model'};
const render=async(value?:DialogueApiConfig)=>act(async()=>{root.render(<BackgroundApiEditor title="主动消息 API" help="所有角色共用" presets={presets} inheritedApi={inherited} value={value} onSave={save}/>);});
const button=(label:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);
const click=async(label:string)=>{const b=button(label);expect(b,label).toBeTruthy();await act(async()=>b!.click());};
const open=async()=>{await act(async()=>host.querySelector('button[aria-expanded]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
const preset=async(name:string)=>{await act(async()=>host.querySelector<HTMLButtonElement>('.sully-background-api__preset-trigger')!.click());await click(name);};
const input=async(element:HTMLInputElement,value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));});
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);save.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe('background API draft and picker',()=>{
 it('loads a whole preset snapshot only into the draft; cancel keeps the saved API and preset untouched',async()=>{
  const saved={baseUrl:'https://old.test/v1',apiKey:'old',model:'old-model'};await render(saved);expect(host.textContent).not.toContain('API Key');await open();await preset('日常按次模型');expect(save).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('daily-key');await click('取消');expect(save).not.toHaveBeenCalled();await open();expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('old');expect(presets[0].config.model).toBe('daily-model');
 });
 it('saves only the chosen background API and preserves its stream, temperature and output limit',async()=>{
  await render();await open();await preset('日常按次模型');await click('保存配置');expect(save).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledWith(presets[0].config);expect(inherited.model).toBe('main-model');
 });
 it('switching preset providers never carries parameters from the previous preset',async()=>{
  await render();await open();await preset('日常按次模型');await preset('原生预设');await click('保存配置');expect(save.mock.calls[0][0]).not.toHaveProperty('maxTokens');expect(save.mock.calls[0][0]).not.toHaveProperty('temperature');expect(save.mock.calls[0][0]).not.toHaveProperty('stream');
 });
 it('the same editor isolates the Moments save target and never saves preset selection immediately',async()=>{
  await act(async()=>root.render(<BackgroundApiEditor title="朋友圈独立 API" kind="moments" help="全局共用" presets={presets} inheritedApi={inherited} onSave={save}/>));
  expect(host.querySelector('.sully-background-api--moments')).toBeTruthy();await open();await preset('日常按次模型');expect(save).not.toHaveBeenCalled();await click('保存配置');expect(save).toHaveBeenCalledWith(presets[0].config);
 });
 it('pulls/searches models from this draft endpoint, selects one and saves it only on confirmation',async()=>{
  const network=vi.fn(async()=>new Response(JSON.stringify({data:[{id:'daily-a'},{id:'daily-b'}]})));vi.stubGlobal('fetch',network);await render();await open();await preset('日常按次模型');await click('拉取模型');
  expect((network.mock.calls[0] as any)[0]).toBe('https://daily.test/v1/models');expect(save).not.toHaveBeenCalled();await input(document.querySelector<HTMLInputElement>('input[placeholder*="搜索"]')!,'daily-b');expect(button('daily-a')).toBeUndefined();await click('daily-b');await click('保存配置');expect(save.mock.calls[0][0].model).toBe('daily-b');
 });
 it('uses native model-list URL and authentication when loading an Anthropic preset',async()=>{
  const network=vi.fn(async()=>new Response(JSON.stringify({data:[{id:'native-choice'}]})));vi.stubGlobal('fetch',network);await render();await open();await preset('原生预设');await click('拉取模型');
  const [url,options]=network.mock.calls[0] as any;expect(url).toBe('https://native.test/v1/models');expect(new Headers(options.headers).get('x-api-key')).toBe('native-key');expect(new Headers(options.headers).has('Authorization')).toBe(false);
  await click('native-choice');await click('保存配置');expect(save.mock.calls[0][0]).toMatchObject({apiType:'anthropic',baseUrl:'https://native.test/v1/messages',model:'native-choice'});
 });
 it('ignores a late model response after switching presets',async()=>{
  let deliver:(value:Response)=>void=()=>{};vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>deliver=resolve)));await render();await open();await preset('日常按次模型');await click('拉取模型');await preset('原生预设');
  await act(async()=>deliver(new Response(JSON.stringify({data:[{id:'stale-model'}]}))));expect(document.body.textContent).not.toContain('stale-model');expect(document.body.textContent).not.toContain('获取 1 个模型');await click('保存配置');expect(save.mock.calls[0][0].model).toBe('native-model');
 });
 it('allows manual model entry after a failed list request, and restores following only explicitly',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:404})));await render(inherited);await open();await click('拉取模型');expect(host.querySelector('[role="alert"]')?.textContent).toContain('HTTP 404');
  await act(async()=>host.querySelector<HTMLButtonElement>('.sully-background-api__model-picker')!.click());await input(document.querySelector<HTMLInputElement>('input[placeholder="手动输入模型名称..."]')!,'manual-model');await click('确定');await click('保存配置');expect(save.mock.calls[0][0].model).toBe('manual-model');
  save.mockClear();await open();await click('恢复跟随角色 API');expect(save).toHaveBeenCalledWith(undefined);
 });
});
