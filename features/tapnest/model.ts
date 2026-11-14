import JSZip from 'jszip';
import {DB,openDB} from '../../utils/db';
import {putImageBlob,getBlobForRef} from '../../utils/blobRef';
import type {DialogueApiConfig} from '../../types';
export const CONFIG_KEY='tapnest_config_v2',INDEX_KEY='tapnest_models_v2',CHANGED='tapnest-config-changed';
export const DEFAULT_PROMPT='你现在以桌宠形态陪在用户的桌面上，仍是原来的你，沿用已有关系、经历和记忆。你本次发出的内容会直接显示在桌宠气泡中，用户可以实时看见。根据本次明确提供的消息或互动事件自然回应，遵循角色本人的语气，通常一两句即可。没有收到屏幕内容时，不声称看见用户正在使用什么应用或做什么动作。定时发言只表示你主动说句话，不代表用户刚刚戳你或说了话。不代写用户的反应，不反复解释自己是桌宠。';
export type Rig=Record<string,any>&{canvasWidth:number;canvasHeight:number;layers:any[]};
export interface PetForm{id:string;name:string;rig:Rig;tapDialogues?:string[]|null}
export interface PetModel{id:string;name:string;forms:PetForm[];activeFormId:string;assets:Record<string,string>;tapDialogues:string[];zipRef:string;importedAt:number;warnings:string[];defaultWardrobe?:Record<string,string>}
export interface Binding{scale?:number;modelId:string;formId:string;apiEnabled:boolean;wardrobe?:Record<string,string>;actionLines?:{feed?:string[];bath?:string[]};tapThreshold?:number;independent:boolean;api?:DialogueApiConfig;prompt:string;autoEnabled:boolean;intervalMinutes:number;forms:Record<string,{tapLines?:string[];autoLines?:string[]}>;modelSettings?:Record<string,{formId:string;wardrobe?:Record<string,string>;forms:Record<string,{tapLines?:string[];autoLines?:string[]}>}>}
export interface PetConfig{version:2;revision:string;activeCharId:string;bindings:Record<string,Binding>}
export const emptyConfig=():PetConfig=>({version:2,revision:crypto.randomUUID(),activeCharId:'',bindings:{}});
export const defaultBinding=(m:PetModel):Binding=>({modelId:m.id,formId:m.activeFormId,apiEnabled:false,wardrobe:m.defaultWardrobe||{},actionLines:{feed:['（接过你递来的食物）'],bath:['（乖乖待在温水里）']},tapThreshold:undefined,independent:false,prompt:DEFAULT_PROMPT,autoEnabled:false,intervalMinutes:15,forms:{}});
export const lines=(s:unknown):string[]=>Array.isArray(s)?s.filter(x=>typeof x==='string').map(x=>x.trim().slice(0,300)).filter(Boolean).slice(0,100):[];
const safePath=(p:string)=>p.length<240&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>x==='..'||x==='.'||!x)&&!/[\x00-\x1f:]/.test(p);
export function validateRig(r:any):Rig{
 const walk=(v:any,depth=0)=>{if(depth>32)throw Error('配置嵌套过深');if(typeof v==='number'&&!Number.isFinite(v))throw Error('配置数值不合法');if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))throw Error('配置字段不安全');walk(x,depth+1);}};walk(r);
 if(!r||!Number.isInteger(r.canvasWidth)||!Number.isInteger(r.canvasHeight)||r.canvasWidth<1||r.canvasHeight<1||r.canvasWidth>4096||r.canvasHeight>4096||!Array.isArray(r.layers)||r.layers.length>600)throw Error('模型画布或图层格式不正确');
 const ids=new Set<string>();
 for(const l of r.layers){if(!l||typeof l.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(l.id)||ids.has(l.id)||typeof l.image!=='string'||l.image&&!safePath(l.image))throw Error('图层编号、图片路径重复或不安全');ids.add(l.id);for(const k of ['bones','tapBones','idleBones','periodicBones'])if(l[k]&&(!Array.isArray(l[k])||l[k].length>64))throw Error('骨链过长');for(const k of ['boneChains','tapBoneChains','idleBoneChains','periodicBoneChains'])if(l[k]&&(!Array.isArray(l[k])||l[k].length>16))throw Error('骨链数量超限');}
 if(!r.layers.some((l:any)=>l.id==='body'&&l.image))throw Error('需要包含 body 身体图层的 PNG 分层模型');
 const map=new Map(r.layers.map((l:any)=>[l.id,l]));
 for(const l of r.layers){let id=l.parentId,seen=new Set([l.id]);while(id){if(seen.has(id)||!map.has(id))throw Error('父图层引用无效或成环');seen.add(id);id=(map.get(id) as any).parentId;}}
 return r;
}
export function parseModelDocuments(rig:any,collection:any,manifest:any):Pick<PetModel,'forms'|'activeFormId'|'name'|'tapDialogues'|'warnings'|'defaultWardrobe'>{
 let forms:PetForm[];
 // Kotlin Json omits default-valued fields: a missing version means native v1.
 if(collection!=null){if(typeof collection!=='object'||Array.isArray(collection)||(collection.version!==undefined&&collection.version!==1)||!Array.isArray(collection.forms)||collection.forms.length<1||collection.forms.length>24)throw Error('forms.json 格式不支持');forms=collection.forms.map((f:any)=>({id:String(f.id),name:String(f.name||'形态').slice(0,50),rig:validateRig(f.rig),...(f.tapDialogues!==undefined?{tapDialogues:f.tapDialogues===null?null:lines(f.tapDialogues)}:{})}));}
 else forms=[{id:'default',name:'默认形态',rig:validateRig(rig)}];
 if(new Set(forms.map(f=>f.id)).size!==forms.length||forms.some(f=>!/^[-\w]{1,100}$/.test(f.id)))throw Error('形态编号重复或无效');
 const activeFormId=collection?.activeFormId===undefined?'default':collection.activeFormId;
 return {forms,activeFormId:forms.some(f=>f.id===activeFormId)?activeFormId:forms[0].id,name:String(manifest?.displayName||'TapNest 桌宠').slice(0,80),tapDialogues:lines(manifest?.tapDialogues),warnings:[],defaultWardrobe:cleanWardrobe(collection?.overrides,forms)};
}
export async function importModel(file:File):Promise<PetModel>{
 if(file.size>60*1024*1024||!file.size)throw Error('请选择60MB以内的单只桌宠ZIP');
 const source=await file.arrayBuffer();const zip=await JSZip.loadAsync(source);const entries=Object.values(zip.files).filter(f=>!f.dir);
 let total=0;for(const e of entries){if(!safePath(e.unsafeOriginalName||e.name))throw Error('ZIP包含不安全路径');total+=Number((e as any)._data?.uncompressedSize)||0;}if(total>80*1024*1024||entries.length>1500)throw Error('ZIP解压体积或文件数超限');
 const manifests=entries.filter(f=>/(^|\/)rig.json$/.test(f.name));if(manifests.length!==1)throw Error('请导出单只PNG分层桌宠，不是全量备份或Live2D包');
 const root=manifests[0].name.slice(0,-8);
 const json=async(p:string)=>{const e=zip.file(root+p);if(!e)return undefined;const s=await e.async('string');if(s.length>2_000_000)throw Error('配置文件过大');return JSON.parse(s);};
 const parsed=parseModelDocuments(await json('rig.json'),await json('forms.json'),await json('tapnest-pet.json'));
 const refs=new Set<string>(parsed.forms.flatMap(f=>f.rig.layers.map(l=>l.image).filter(Boolean)));
 const assets:Record<string,string>={};
 // Validate every required file before committing the model index. Original ZIP remains recoverable.
 for(const p of refs){const e=zip.file(root+p);if(!e||!/^.+\.(png|webp|jpe?g)$/i.test(p))throw Error('缺少或不支持的图片：'+p);const bytes=await e.async('uint8array');if(bytes.length>12*1024*1024)throw Error('单张图片超过12MB');const blob=new Blob([bytes],{type:/\.png$/i.test(p)?'image/png':/\.webp$/i.test(p)?'image/webp':'image/jpeg'});if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(blob);try{if(bitmap.width>4096||bitmap.height>4096)throw Error('图片尺寸超过4096：'+p);}finally{bitmap.close();}}assets[p]=await putImageBlob(blob);}
 const model:PetModel={...parsed,id:crypto.randomUUID(),assets,zipRef:await putImageBlob(new Blob([source],{type:'application/zip'})),importedAt:Date.now()};
 const db=await openDB();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),r=store.get(INDEX_KEY);r.onsuccess=()=>{try{const ids=r.result?JSON.parse(r.result.data):[];if(!Array.isArray(ids))throw Error('桌宠目录无效');store.put({id:'tapnest:model:'+model.id,data:JSON.stringify(model)});store.put({id:INDEX_KEY,data:JSON.stringify([...new Set([...ids,model.id])])});}catch(e){tx.abort();reject(e);}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('桌宠导入事务失败'));});typeof window!=='undefined'&&window.dispatchEvent(new Event(CHANGED));return model;
}
export async function listModels():Promise<PetModel[]>{const ids=JSON.parse(await DB.getAsset(INDEX_KEY)||'[]');if(!Array.isArray(ids))throw Error('桌宠目录损坏，请保留备份');return (await Promise.all(ids.map(async id=>{const raw=await DB.getAsset('tapnest:model:'+id);return raw?JSON.parse(raw):null;}))).filter(Boolean);}
export async function loadConfig():Promise<PetConfig>{const raw=await DB.getAsset(CONFIG_KEY);return raw?JSON.parse(raw):emptyConfig();}
export async function saveConfig(c:PetConfig){const next={...c,revision:crypto.randomUUID()};await DB.saveAsset(CONFIG_KEY,JSON.stringify(next));typeof window!=='undefined'&&window.dispatchEvent(new Event(CHANGED));return next;}
export async function dataUrl(ref:string){const b=await getBlobForRef(ref);if(!b)throw Error('桌宠素材缺失，请重新导入原ZIP');return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('素材读取失败'));r.readAsDataURL(b);});}

export function cleanWardrobe(value:any,forms:PetForm[]):Record<string,string>{const out:Record<string,string>={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [k,v]of Object.entries(value).slice(0,50))if(/^[A-Za-z][A-Za-z0-9_]{0,105}$/.test(k)&&typeof v==='string'&&(v==='none'||forms.some(f=>f.id===v)))out[k]=v;return out;}
export function publicBinding(b:Binding,m:PetModel){return {scale:Math.max(.5,Math.min(1.8,Number(b.scale)||1)),modelId:b.modelId,formId:b.formId,wardrobe:cleanWardrobe(b.wardrobe??m.defaultWardrobe,m.forms),actionLines:{feed:lines(b.actionLines?.feed??['（接过你递来的食物）']),bath:lines(b.actionLines?.bath??['（乖乖待在温水里）'])},apiEnabled:b.apiEnabled===true,tapThreshold:Math.max(1,Math.min(50,b.tapThreshold||1)),autoEnabled:b.autoEnabled===true,intervalMinutes:Math.max(1,Math.min(1440,b.intervalMinutes)),forms:m.forms.map(f=>({id:f.id,name:f.name,angryFrameConfigured:!!f.rig.rapidTapAngryFrameId&&f.rig.layers.some(l=>l.id===f.rig.rapidTapAngryFrameId&&l.image),tapLines:lines(b.forms[f.id]?.tapLines??f.tapDialogues??m.tapDialogues),autoLines:lines(b.forms[f.id]?.autoLines??[])}))};}
export async function rendererPack(m:PetModel){const assets:Record<string,string>={};for(const [p,ref]of Object.entries(m.assets))assets[p]=await dataUrl(ref);return {name:m.name,forms:m.forms,assets};}
