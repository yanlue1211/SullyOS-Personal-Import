// @vitest-environment jsdom
import {readFileSync} from 'node:fs';import {expect,it,vi} from 'vitest';
it('loads a real player DOM, switches imported forms, keeps typing with presets and clears it on final reply',async()=>{
 const doc=readFileSync('public/tapnest/viewer.html','utf8'),scripts=[...doc.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 document.body.innerHTML=doc.slice(doc.indexOf('<canvas'),doc.indexOf('<script src='));
 const engine={load:vi.fn().mockResolvedValue(undefined),select:vi.fn(),tap:vi.fn(),thinking:vi.fn(),held:vi.fn(),formId:'chat'};
 (window as any).TapNestEngine={make:()=>engine};(globalThis as any).TapNestEngine=(window as any).TapNestEngine;
 const originalFocus=HTMLInputElement.prototype.focus;HTMLInputElement.prototype.focus=vi.fn();
 try{window.eval(scripts.at(-1)!);const p=(window as any).PetPreview;
 const payload={revision:'r',binding:{formId:'chat',apiEnabled:true},pack:{forms:[{id:'chat',name:'小金毛',rig:{}},{id:'work',name:'帽子',rig:{}}],assets:{}}};
 expect(await p.apply(payload)).toBe(true);expect(p.getLoadState()).toMatchObject({revision:'r',status:'ready'});
 expect([...document.querySelectorAll('#forms option')].map(x=>x.textContent)).toEqual(['小金毛','帽子']);
 const select=document.getElementById('forms') as HTMLSelectElement;select.value='work';select.dispatchEvent(new Event('change'));expect(engine.select).toHaveBeenCalledWith('work');expect(p.popOutgoing()).toMatchObject({kind:'form',formId:'work'});
 p.setThinking(true);expect(document.getElementById('typing')!.style.display).toBe('block');expect(document.getElementById('bubble')!.textContent).toBe('…');p.preset('戳动的预设');expect(document.getElementById('typing')!.style.display).toBe('block');expect(document.getElementById('bubble')!.textContent).toBe('戳动的预设');p.speak('角色最终回应');expect(document.getElementById('typing')!.style.display).toBe('none');
 const canvas=document.getElementById('pet')!;for(let i=0;i<6;i++){(canvas as any).onpointerdown({clientX:20,clientY:20});(canvas as any).onpointerup({clientX:20,clientY:20});expect(p.popOutgoing()).toMatchObject({kind:'tap'});}expect(engine.tap).toHaveBeenLastCalledWith(6);expect(document.getElementById('chat')!.style.display).not.toBe('flex');
 document.getElementById('say')!.click();expect(document.getElementById('chat')!.style.display).toBe('flex');(document.getElementById('message') as HTMLInputElement).value='你好';document.getElementById('chat')!.dispatchEvent(new Event('submit',{cancelable:true}));expect(p.popOutgoing()).toMatchObject({kind:'text',text:'你好'});
 let finishOld:any;engine.load.mockImplementationOnce(()=>new Promise(r=>finishOld=r));const old=p.apply({...payload,revision:'old'});await p.apply({...payload,revision:'new'});finishOld();expect(await old).toBe(false);expect(p.getLoadState()).toMatchObject({revision:'new',status:'ready'});
 await p.apply({...payload,binding:{...payload.binding,apiEnabled:false}});document.getElementById('say')!.click();expect(document.getElementById('chat')!.style.display).toBe('none');
 }finally{HTMLInputElement.prototype.focus=originalFocus;}
});
