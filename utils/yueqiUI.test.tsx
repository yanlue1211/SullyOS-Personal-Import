// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const fake=vi.hoisted(()=>{const listeners=new Set<()=>void>();let revision=0;const session={id:'qa',charId:'a',mode:'story',scene:'online',sleepDay:'2026-11-01',title:'海边的小羊',status:'ended',summary:'原摘要',createdAt:1,elapsedMs:0,targetMinutes:15,speed:1,turns:[],clips:[],cursor:0,offset:0};const moon:any={session:null,busy:false,notice:'',playlist:[],musicIndex:0,musicPlay:vi.fn(async()=>{}),configure:vi.fn(),loadMusic:vi.fn(async()=>{}),subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},snapshot:()=>revision,emit:()=>{revision++;listeners.forEach(fn=>fn());},fail:vi.fn(),select:vi.fn(async()=>{moon.session=session;moon.emit();}),editSummary:vi.fn(async()=>{}),voiceVolume:.85,musicVolume:.35,duckVolume:.12};return {moon,session};});
vi.mock('../context/OSContext',()=>({useOS:()=>({characters:[{id:'a',name:'阿源',avatar:''}],apiConfig:{},userProfile:{},groups:[],realtimeConfig:{},closeApp:vi.fn()})}));
vi.mock('../features/yueqi/runtime',()=>({moon:fake.moon}));
vi.mock('../features/yueqi/storage',()=>({storage:{list:vi.fn(async()=>[fake.session]),get:vi.fn(async()=>fake.session)},blobData:vi.fn()}));
vi.mock('./db',()=>({DB:{getEmojis:vi.fn(async()=>[]),getEmojiCategories:vi.fn(async()=>[]),getAssetRaw:vi.fn(async()=>null),saveAssetRaw:vi.fn(async()=>{})}}));
vi.mock('../hooks/useLocalBackHandler',()=>({useLocalBackHandler:vi.fn()}));
vi.mock('../components/os/TokenImg',()=>({default:()=>null}));
vi.mock('./blobRef',()=>({isImageValue:()=>false}));
import YueqiApp from '../apps/YueqiApp';
let host:HTMLDivElement,root:Root;
async function click(text:string){const target=[...host.querySelectorAll('button')].find(x=>x.textContent?.includes(text));expect(target,`缺少按钮 ${text}`).toBeTruthy();await act(async()=>{target!.click();});}
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;fake.moon.session=null;fake.moon.playlist=[];host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(<YueqiApp/>);});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
it('历史记录的修改摘要按钮打开真实编辑框，保存更新同一记录',async()=>{await click('月光拾音');await click('海边的小羊');await click('修改摘要');expect(host.querySelector('[aria-label="修改月栖摘要"]')).not.toBeNull();const editor=host.querySelector('[aria-label="本场摘要"]') as HTMLTextAreaElement;expect(editor.value).toBe('原摘要');await click('保存摘要');expect(fake.moon.editSummary).toHaveBeenCalledWith('原摘要');expect(host.querySelector('[aria-label="修改月栖摘要"]')).toBeNull();});
it('选择角色后，故事设置同时提供线上与线下场景',async()=>{await click('选择一位熟悉的声音');await click('阿源');await click('枕月听书');expect(host.textContent).toContain('隔屏伴月');expect(host.textContent).toContain('月下相依');await click('月下相依');const selected=[...host.querySelectorAll('.yq-scenes button')].find(x=>x.classList.contains('selected'));expect(selected?.textContent).toContain('月下相依');});

it('首页只保留一个角色入口，音乐入口可选择已导入音乐且无测试免责声明',async()=>{fake.moon.playlist=[{id:'saved',name:'雨声.mp3',audio:'saved-audio'}];await click('月下听风');expect(host.querySelector('h2')?.textContent).toBe('月下听风');await click('雨声.mp3');expect(fake.moon.musicPlay).toHaveBeenCalledWith(0);await act(async()=>{(host.querySelector('[aria-label="设置"]') as HTMLButtonElement).click();});expect(host.textContent).not.toContain('需真机验证');expect(host.textContent).not.toContain('测试');});
