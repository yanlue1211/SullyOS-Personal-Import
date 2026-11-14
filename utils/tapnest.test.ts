import {beforeEach,expect,it,vi} from 'vitest';
import JSZip from 'jszip';
import {DB,openDB} from './db';
import {defaultBinding,emptyConfig,importModel,listModels,parseModelDocuments,publicBinding,saveConfig,validateRig} from '../features/tapnest/model';
import {claimEvent} from '../features/tapnest/generate';
const rig=()=>({canvasWidth:100,canvasHeight:100,layers:[{id:'body',image:'body.png'}]});
beforeEach(async()=>{const db=await openDB();await new Promise<void>((r,j)=>{const t=db.transaction(['assets'],'readwrite');t.objectStore('assets').clear();t.oncomplete=()=>r();t.onerror=()=>j(t.error);});});
it('preserves multi-form rigs, explicit quiet forms and independent touch lines',()=>{
 const p=parseModelDocuments(rig(),{version:1,activeFormId:'work',forms:[{id:'chat',name:'小金毛',rig:rig(),tapDialogues:['摸摸']},{id:'work',name:'戴帽子',rig:rig(),tapDialogues:[]}]},{displayName:'GPT',tapDialogues:['通用']});
 expect(p.activeFormId).toBe('work');expect(p.forms[1].tapDialogues).toEqual([]);expect(p.forms[0].tapDialogues).toEqual(['摸摸']);
});
it('rejects cycles, duplicate IDs, unsafe image paths and invalid forms',()=>{
 expect(()=>validateRig({...rig(),layers:[{id:'body',image:'body.png',parentId:'ear'},{id:'ear',image:'ear.png',parentId:'body'}]})).toThrow('成环');
 expect(()=>validateRig({...rig(),layers:[{id:'body',image:'../private.png'}]})).toThrow();
 expect(()=>parseModelDocuments(rig(),{version:2,forms:[]},{})).toThrow();
});
it('never includes credentials or state prompt in desktop settings; separates each form and channel',()=>{
 const m={...parseModelDocuments(rig(),{version:1,forms:[{id:'chat',rig:rig(),tapDialogues:['chat']},{id:'work',rig:rig(),tapDialogues:['work']}]},{}),id:'m'} as any;
 const b={...defaultBinding(m),api:{apiKey:'SECRET',baseUrl:'https://secret',model:'m'},forms:{chat:{autoLines:['定时chat']},work:{autoLines:['定时work']}}};
 const p=publicBinding(b,m);expect(JSON.stringify(p)).not.toContain('SECRET');expect(JSON.stringify(p)).not.toContain('https://secret');expect(p.forms.map(f=>f.autoLines)).toEqual([['定时chat'],['定时work']]);expect(b.apiEnabled).toBe(false);expect(b.autoEnabled).toBe(false);
});
it('persists each char binding without overwriting another, and gives each save a new generation',async()=>{const a=emptyConfig();a.bindings.a={modelId:'one',formId:'chat'} as any;a.bindings.b={modelId:'one',formId:'work'} as any;const b=await saveConfig(a);expect(b.revision).not.toBe(a.revision);expect(JSON.parse(await DB.getAsset('tapnest_config_v2')||'').bindings.b.formId).toBe('work');});
it('claims a request once across concurrent handlers and retains ambiguity after reload',async()=>{const results=await Promise.all([claimEvent('same-event'),claimEvent('same-event')]);expect(results.sort()).toEqual([false,true]);expect(await claimEvent('same-event')).toBe(false);});
it('imports a real native-compatible ZIP with forms and keeps original ZIP in media storage',async()=>{
 const zip=new JSZip();zip.file('rig.json',JSON.stringify(rig()));zip.file('tapnest-pet.json',JSON.stringify({displayName:'桌宠'}));zip.file('forms.json',JSON.stringify({version:1,activeFormId:'work',forms:[{id:'chat',name:'chat',rig:rig()},{id:'work',name:'work',rig:rig(),tapDialogues:['work']}]}));zip.file('body.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8qkAAAAASUVORK5CYII=','base64'));
 const bytes=await zip.generateAsync({type:'nodebuffer'});const file=Object.assign(bytes,{name:'pet.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}) as any;
 const m=await importModel(file);expect(m.activeFormId).toBe('work');expect(m.assets['body.png']).toMatch(/^blobref:/);expect(m.zipRef).toMatch(/^blobref:/);expect((await listModels())[0].forms).toHaveLength(2);
});
it('does not commit a partially missing model',async()=>{const zip=new JSZip();zip.file('rig.json',JSON.stringify(rig()));const bytes=await zip.generateAsync({type:'nodebuffer'});await expect(importModel(Object.assign(bytes,{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}) as any)).rejects.toThrow('缺少');expect(await listModels()).toEqual([]);});

it('preserves native wardrobe overrides and independent action lines without leaking private context',()=>{const p=parseModelDocuments(rig(),{version:1,activeFormId:'chat',overrides:{hat:'work',tail:'none'},forms:[{id:'chat',rig:rig()},{id:'work',rig:rig()}]},{}),m={...p,id:'m'} as any,b={...defaultBinding(m),actionLines:{feed:['只吃饭'],bath:['只洗澡']}};const pub=publicBinding(b,m);expect(pub.wardrobe).toEqual({hat:'work',tail:'none'});expect(pub.actionLines).toEqual({feed:['只吃饭'],bath:['只洗澡']});});

it('accepts native Kotlin forms with omitted v1 defaults and resolves default form by ID',()=>{
 const collection={forms:[{id:'work',name:'工作',rig:rig(),tapDialogues:[]},{id:'default',name:'默认',rig:rig()}]};
 const p=parseModelDocuments(rig(),collection,{});
 expect(p.activeFormId).toBe('default');expect(p.forms[0].tapDialogues).toEqual([]);expect(p.forms[1].tapDialogues).toBeUndefined();expect(p.defaultWardrobe).toEqual({});
 for(const version of [null,0,2,'1'])expect(()=>parseModelDocuments(rig(),{...collection,version},{})).toThrow('格式不支持');
 expect(()=>parseModelDocuments(rig(),{forms:[]},{})).toThrow('格式不支持');
 expect(()=>parseModelDocuments(rig(),{forms:[{id:'default',rig:{...rig(),layers:[{id:'body',image:'../body.png'}]}}]},{})).toThrow();
});
it('imports an unmodified Kotlin-style ZIP without default version or activeFormId',async()=>{
 const zip=new JSZip();
 zip.file('rig.json',JSON.stringify(rig()));
 // TapNestForms.encode uses Json with encodeDefaults=false; version=1 and activeFormId="default" are absent.
 zip.file('forms.json',JSON.stringify({forms:[{id:'work',name:'工作',rig:rig(),tapDialogues:[]},{id:'default',name:'默认',rig:rig()}],overrides:{hat:'work'}}));
 zip.file('tapnest-pet.json',JSON.stringify({displayName:'伙伴',tapDialogues:['你好']}));
 zip.file('body.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8qkAAAAASUVORK5CYII=','base64'));
 const bytes=await zip.generateAsync({type:'nodebuffer'});
 const m=await importModel({size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)} as File);
 expect(m.activeFormId).toBe('default');expect(m.name).toBe('伙伴');expect(m.tapDialogues).toEqual(['你好']);expect(m.forms[0].tapDialogues).toEqual([]);expect(m.defaultWardrobe).toEqual({hat:'work'});expect(m.zipRef).toMatch(/^blobref:/);expect((await listModels())[0]).toEqual(m);
});
