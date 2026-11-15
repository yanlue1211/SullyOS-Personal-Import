// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi,afterEach} from 'vitest';
import HaimianProduction from '../components/song/HaimianProduction';
import {productionFingerprint} from '../features/songwriting/production';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const state=vi.hoisted(()=>({song:null as any,call:vi.fn(),text:vi.fn(),turn:vi.fn()}));
vi.mock('../features/songwriting/voiceClone',()=>({loadVoiceClone:async()=>null}));
vi.mock('../context/MusicContext',()=>({useMusic:()=>({addLocalSong:vi.fn()})}));
vi.mock('../context/OSContext',()=>({useOS:()=>({apiConfig:{},userProfile:{name:'我'},characters:[],groups:[]})}));
vi.mock('../features/songwriting/storage',()=>({getSong:async()=>state.song,writeTurn:(...a:any[])=>state.turn(...a),mutateSong:async(_id:string,change:any)=>{const d=change(state.song);state.song=d.song;return d.song}}));
vi.mock('../features/songwriting/production',async original=>({...await original<any>(),haimianCall:(...a:any[])=>state.call(...a),generateProductionText:(...a:any[])=>state.text(...a)}));
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.restoreAllMocks()});
it('production UI previews editable summary and submits one task; refresh restores it',async()=>{
 state.song={id:'s',title:'测试',genre:'folk',mood:'dreamy',collaboratorId:'c',lines:[{id:'l',section:'verse',content:'晚风轻轻吹'}],production:{vision:'自由设想',prompt:''}};
 state.text.mockResolvedValue('民谣与爵士融合，弱混响');state.call.mockImplementation(async(path:string)=>path.includes('balance')?{data:{status_code:0,data:{total_balance:100}}}:path.includes('voices')?{data:{status_code:0,data:{voices:[{id:123,title:'测试音色',status:2},{id:456,title:'另一个音色',status:2}]}}}:{songTaskId:'testTask',deductedCredit:5});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 function Harness(){const [song,setSong]=useState(state.song);return <HaimianProduction song={song} onUpdate={setSong}/>}
 await act(async()=>root.render(<Harness/>));
 const click=async(label:string)=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===label)!;expect(b).toBeTruthy();await act(async()=>b.click())};
 await click('整理海绵创作说明');expect((host.querySelector('[aria-label="海绵创作说明"]') as HTMLTextAreaElement).value).toContain('爵士');expect(state.call).not.toHaveBeenCalled();expect(state.song.production.basedOn).toBe(productionFingerprint(state.song));
 async function input(el:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})}
 const passwords=host.querySelectorAll('input[type="password"]');await input(passwords[0] as HTMLInputElement,'fake-key');await input(passwords[1] as HTMLInputElement,'session=fake');await click('读取积分与音色');await act(async()=>{(host.querySelector('[aria-label="海绵演唱音色"]') as HTMLButtonElement).click()});await click('另一个音色');expect(host.querySelector('[aria-label="海绵演唱音色"]')!.textContent).toContain('另一个音色');await act(async()=>{(host.querySelector('[aria-label="海绵演唱音色"]') as HTMLButtonElement).click()});await click('测试音色');vi.spyOn(window,'confirm').mockImplementation(()=>{throw Error('broken native confirm')});await click('确认消耗积分，生成一首');expect(state.call.mock.calls.filter(c=>c[0]==='/music/original')).toHaveLength(0);await click('确认提交生成');expect(state.song.production.task.id).toBe('testTask');expect(state.call.mock.calls.filter(c=>c[0]==='/music/original')).toHaveLength(1);expect([...host.querySelectorAll('button')].find(b=>b.textContent==='确认消耗积分，生成一首')!.disabled).toBe(true);expect(JSON.stringify(state.song)).not.toContain('fake-key');await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<Harness/>));expect(host.textContent).toContain('testTask');expect((host.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
});
