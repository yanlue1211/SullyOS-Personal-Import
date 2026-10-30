// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {DB} from './db';
import CommerceApp from '../apps/CommerceApp';
import {readCommerce} from './personalCommerce';
import {safeFetchJson} from './safeApi';
vi.mock('../context/OSContext',()=>({useOS:()=>({characters:[{id:'ui-char',name:'小雨'}],userProfile:{name:'我'},apiConfig:{baseUrl:'https://model.example/v1',model:'test',apiKey:'test'},closeApp:vi.fn(),addToast:vi.fn()})}));
vi.mock('./context',()=>({ContextBuilder:{buildCharacterRequest:vi.fn(async(_:unknown,m:unknown)=>m)}}));
vi.mock('./safeApi',async original=>({...await original<typeof import('./safeApi')>(),safeFetchJson:vi.fn()}));
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;await DB.deleteDB();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const click=async(text:string)=>{const btn=[...host.querySelectorAll('button')].find(b=>b.textContent===text);expect(btn).toBeDefined();await act(async()=>{btn!.click();await new Promise(r=>setTimeout(r,30));});};
it('generates and persists a catalog only on request, then places an explicit gift and shows the order',async()=>{
 vi.mocked(safeFetchJson).mockResolvedValue({choices:[{message:{content:JSON.stringify([{title:'蓝色马克杯',shop:'杯子铺',detail:'350毫升',price:29}])}}]});
 await act(async()=>{root.render(React.createElement(CommerceApp));await new Promise(r=>setTimeout(r,30));});
 expect(safeFetchJson).not.toHaveBeenCalled();await click('逛一逛');expect(host.textContent).toContain('蓝色马克杯');
 const productButton=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('蓝色马克杯'))!;await act(async()=>productButton.click());
 await click('我给 TA 买');const {orders}=await readCommerce();expect(orders).toHaveLength(1);expect(orders[0].recipient).toBe('char');expect(host.textContent).toContain('等待发货');expect(host.textContent).toContain('无真实支付');
});
