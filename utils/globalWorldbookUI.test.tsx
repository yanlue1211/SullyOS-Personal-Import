// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import WorldbookApp from '../apps/WorldbookApp';
import {GlobalWorldbookSettings} from '../components/character/GlobalWorldbookSettings';
import type {Worldbook} from '../types';
const state=vi.hoisted(()=>({os:null as any}));
vi.mock('../context/OSContext',()=>({useOS:()=>state.os}));
vi.mock('../utils/appShortcutLaunch',()=>({useAppShortcut:()=>{}}));
vi.mock('../utils/analytics',()=>({trackEvent:()=>{}}));
vi.mock('../utils/pngShare',()=>({readShareFile:async(file:File)=>({name:file.name,text:async()=>JSON.stringify({entries:{0:{uid:0,content:'imported content',comment:'Imported',constant:true}}})})}));
let root:Root,host:HTMLDivElement;
const base=(id:string):Worldbook=>({id,title:id,content:'content',category:'Group',createdAt:1,updatedAt:1});
const render=async(node:React.ReactNode)=>act(async()=>root.render(node));
const click=async(label:string)=>{const b=[...host.querySelectorAll('button')].find(el=>el.textContent?.trim()===label);expect(b,label).toBeTruthy();await act(async()=>b!.click());};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
function Harness(){
 const [books,setBooks]=useState([base('Legacy')]);
 state.os={worldbooks:books,closeApp:vi.fn(),addToast:vi.fn(),addWorldbook:async(book:Worldbook)=>setBooks(prev=>[...prev,book]),updateWorldbook:async(id:string,patch:any)=>setBooks(prev=>prev.map(b=>b.id===id?{...b,...patch}:b)),updateWorldbooks:async(ids:string[],patch:any)=>setBooks(prev=>prev.map(b=>ids.includes(b.id)?{...b,...patch}:b)),deleteWorldbook:vi.fn(),deleteWorldbooks:vi.fn()};
 return <WorldbookApp/>;
}
it('keeps legacy personal, moves without enabling and imports external formats into global off',async()=>{
 await render(<Harness/>);expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('个人');
 await click('移至全局');expect(state.os.worldbooks[0]).toMatchObject({id:'Legacy',scope:'global',globalEnabled:false});
 await act(async()=>host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0].click());
 expect(host.querySelector('[aria-label="开启全局世界书 Legacy"]')).toBeTruthy();
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="开启全局世界书 Legacy"]')!.click());expect(state.os.worldbooks[0].globalEnabled).toBe(true);
 const input=host.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(input,'files',{value:[new File(['{}'],'External.json',{type:'application/json'})],configurable:true});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(state.os.worldbooks.find((b:Worldbook)=>b.title==='Imported')).toMatchObject({scope:'global',globalEnabled:false,content:'imported content'});
});
it('per-character exclusions change only the selected role and remain reversible',async()=>{
 const change=vi.fn();const book={...base('Global'),scope:'global' as const,globalEnabled:true};
 await render(<GlobalWorldbookSettings character={{id:'A'} as any} books={[book]} onChange={change}/>);
 await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());expect(change).toHaveBeenLastCalledWith(['Global']);expect(book.globalEnabled).toBe(true);
 await render(<GlobalWorldbookSettings character={{id:'A',disabledGlobalWorldbookIds:['Global']} as any} books={[book]} onChange={change}/>);
 await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());expect(change).toHaveBeenLastCalledWith([]);
});
