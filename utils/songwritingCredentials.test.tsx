// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import HaimianCredentials,{useHaimianCredentials} from '../components/song/HaimianCredentials';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it('credentials persist only after saving, restore across panels, and clear',async()=>{
 localStorage.clear();const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
 function Harness(){const connection=useHaimianCredentials();return <HaimianCredentials connection={connection}/>;}
 const mount=async()=>act(async()=>root.render(<Harness/>));
 const click=async(label:string)=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!.click());
 const input=async(i:number,value:string)=>act(async()=>{const el=host.querySelectorAll('input')[i];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
 try{await mount();await input(0,'test-key');await input(1,'session=test');expect(localStorage.length).toBe(0);await click('记住连接凭证');await act(async()=>root.unmount());root=createRoot(host);await mount();expect(host.querySelectorAll('input')[0].value).toBe('test-key');expect(host.querySelectorAll('input')[1].value).toBe('session=test');await click('清除已存凭证');expect(localStorage.length).toBe(0);expect(host.querySelectorAll('input')[0].value).toBe('');}finally{await act(async()=>root.unmount());host.remove();localStorage.clear();}
});
