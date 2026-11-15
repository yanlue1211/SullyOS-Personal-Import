import {deriveUserEncryptionKey,decryptPayload,encryptPayload} from '@rei-standard/amsg-server/cloudflare';
import {constantTimeEqual,kickInstantTick,readMaybeGzippedBody,type InstantChatUpstream} from './instantChat';
import {PET_CLOUD_CONFIG,PET_CLOUD_KIND,petCloudNamespace,parsePetRecords,petEventContent,type PetCloudConfig,type PetCloudEvent} from '../../../utils/tapnestCloud';
import {amsgStateNamespace} from '../../../utils/amsgFirePack';
interface PetEnv {AMSG_MASTER_KEY:string;AMSG_SERVER_TOKEN?:string;INSTANT_TICK?:any}
export interface PetRouteArgs {userId:string;charId:string;operation:string;payload:any}
const encoder=new TextEncoder();
async function sign(env:PetEnv,data:string){const key=await crypto.subtle.importKey('raw',encoder.encode(env.AMSG_MASTER_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(data)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function petCapability(env:PetEnv,config:PetCloudConfig,userId:string){const data=JSON.stringify({userId,charId:config.charId,revision:config.revision,nonce:config.nonce,expiresAt:config.expiresAt});return btoa(data)+'.'+await sign(env,data);}
export async function verifyPetCapability(env:PetEnv,token:unknown):Promise<any>{if(typeof token!=='string'||token.length>4000)throw Error('桌宠凭据无效');const [encoded,mac,...rest]=token.split('.');if(rest.length)throw Error('桌宠凭据无效');const data=atob(encoded),p=JSON.parse(data);if(!(await constantTimeEqual(await sign(env,data),mac||''))||!Number.isFinite(p.expiresAt)||p.expiresAt<Date.now()||!validId(p.userId)||!validId(p.charId))throw Error('桌宠凭据已失效，请回网页重新同步');return p;}
const validId=(s:unknown):s is string=>typeof s==='string'&&/^[-\w]{1,100}$/.test(s);
export function validPetCloudEvent(e:any):e is PetCloudEvent{return !!e&&validId(e.id)&&validId(e.charId)&&validId(e.revision)&&validId(e.formId)&&['text','tap','feed','bath','timer'].includes(e.kind)&&Number.isFinite(e.at)&&e.at>0&&e.at<=Date.now()+300000&&(e.text===undefined||typeof e.text==='string'&&e.text.length<=1000)&&(e.tapCount===undefined||Number.isInteger(e.tapCount)&&e.tapCount>=1&&e.tapCount<=1000)&&!!petEventContent(e);}
function headers(env:PetEnv,userId:string){return {'Content-Type':'application/json','X-User-Id':userId,'X-Payload-Encrypted':'true','X-Encryption-Version':'1',...(env.AMSG_SERVER_TOKEN?{'X-Client-Token':env.AMSG_SERVER_TOKEN}:{})};}
/** Uses the SDK's encrypted/owned state and admission limits, never direct unencrypted D1 writes. */
export async function petStateIO(env:PetEnv,upstream:InstantChatUpstream,userId:string){const key=await deriveUserEncryptionKey(userId,env.AMSG_MASTER_KEY);const call=async(path:string,method='GET',payload?:unknown)=>{const r=await upstream.fetch(new Request('https://internal/'+path,{method,headers:headers(env,userId),...(payload?{body:JSON.stringify(await encryptPayload(payload,key))}:{})}),env);const b:any=await r.json();if(path==='schedule-message'&&r.status===409&&b.error?.code==='TASK_UUID_CONFLICT')return {existing:true};if(!r.ok||!b.success||b.data?.rejected?.length||b.data?.unknown)throw Error('桌宠云端存储失败');return b.encrypted?await decryptPayload(b.data,key):b.data;};return {read:async(namespace:string)=>(await call('client-state?namespace='+encodeURIComponent(namespace))).entries as {key:string;value:string}[],write:async(namespace:string,charId:string,entries:any[])=>call('client-state','PUT',{entries:entries.map(e=>({...e,namespace,owner:{type:'character',id:charId}}))}),schedule:(payload:unknown)=>call('schedule-message','POST',payload)};}
/** Admission is called inside the existing DO's short per-character lock, not in the model alarm. */
export async function admitPetCloud(args:PetRouteArgs,env:PetEnv,upstream:InstantChatUpstream){
 const io=await petStateIO(env,upstream,args.userId),namespace=petCloudNamespace(args.charId);let rows=await io.read(namespace);let config:PetCloudConfig|undefined;try{config=JSON.parse(rows.find(r=>r.key===PET_CLOUD_CONFIG)?.value||'null');}catch{}
 if(args.operation==='register'){
  const p=args.payload;if(!p||p.charId!==args.charId||!validId(p.revision))throw Error('桌宠配置无效');
  if(p.enabled!==true){if(config)await io.write(namespace,args.charId,[{key:PET_CLOUD_CONFIG,value:JSON.stringify({...config,enabled:false,nonce:crypto.randomUUID()})}]);return {disabled:true};}
  if(!Array.isArray(p.messages)||!p.messages.length||p.messages.length>3000||p.messages.some((m:any)=>!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')||JSON.stringify(p.messages).length>3000000||!p.api||!/^https:\/\//.test(p.api.url)||!p.api.key||!p.api.model||!Array.isArray(p.forms)||!p.forms.length||p.forms.length>24||p.forms.some((f:any)=>!validId(f.id)||typeof f.name!=='string')||!Array.isArray(p.coveredIds)||p.coveredIds.some((id:any)=>typeof id!=='string'))throw Error('桌宠上下文或API配置不完整');
  // A stale webpage cannot acknowledge unknown records merely by supplying a timestamp.
  config={...p,nonce:config?.enabled&&config.revision===p.revision?config.nonce:crypto.randomUUID(),expiresAt:Date.now()+30*86400000,api:{...p.api,maxTokens:Math.min(1500,Math.max(64,Number(p.api.maxTokens)||1000))}};
  await io.write(namespace,args.charId,[{key:PET_CLOUD_CONFIG,value:JSON.stringify(config)}]);
  const covered=new Set(config!.coveredIds),mainRows=await io.read(amsgStateNamespace(args.charId));
  // Only remove supplemental text that is actually present in BOTH consumers' snapshots.
  let mainCovered=new Set<string>();try{const raw=mainRows.find(r=>r.key==='fire_pack')?.value; if(raw){const {unpackStateValue}=await import('../../../utils/amsgFirePack');const pack=JSON.parse(await unpackStateValue(raw));mainCovered=new Set([...(pack.petCloudCoveredIds||[]),...(pack.receivedCloudOccurrences||[]).map((id:string)=>'proactive:'+id)]);}}catch{}
  const remove=rows.filter(r=>r.key.startsWith('record:')).filter(r=>{try{const rec=JSON.parse(r.value);return covered.has(rec.id)&&mainCovered.has(rec.id);}catch{return false;}}).map(r=>({key:r.key,value:null}));
  // Keep event/claim/result receipts (no model replay); these small rows are also user-owned.
  for(let i=0;i<remove.length;i+=100)await io.write(namespace,args.charId,remove.slice(i,i+100));
  return {capability:await petCapability(env,config!,args.userId),expiresAt:config!.expiresAt};
 }
 const cap=args.payload.scope;
 // Revocation prevents new sends; a previously accepted event may still retrieve its own result.
 // No history/config/API secrets are returned through this read-only exception.
 if(args.operation==='status'){
  const e=args.payload.event;if(!validPetCloudEvent(e)||e.charId!==args.charId||e.revision!==cap.revision)throw Error('桌宠事件无效');
  const savedRow=rows.find(r=>r.key==='event:'+e.id);if(!savedRow)return {status:'missing'};
  const saved=JSON.parse(savedRow.value);if(JSON.stringify(saved.event)!==JSON.stringify(e))throw Error('同一消息编号不能修改内容');
  const result=rows.find(r=>r.key==='result:'+e.id);if(result)return JSON.parse(result.value);
  if(saved.scheduled!==true&&!rows.some(r=>r.key==='claim:'+e.id))return {status:'missing'};
  if(Date.now()-saved.acceptedAt>15*60000)return {status:'queued',notice:'云端仍在排队或处理，请勿重复发送；可回网页查看记录。'};
  return {status:'queued'};
 }
 if(!config?.enabled||config.nonce!==cap.nonce||config.revision!==cap.revision)throw Error('桌宠设置已变更，请回网页同步');
 const records=parsePetRecords(rows);
 if(args.operation==='history')return {records:records.filter(r=>r.source==='pet'),revision:config.revision};
 const e=args.payload.event;if(!validPetCloudEvent(e)||e.charId!==args.charId||e.revision!==config.revision||!config.forms.some(f=>f.id===e.formId))throw Error('桌宠事件无效或形态已变更');
 const eventKey='event:'+e.id,existing=rows.find(r=>r.key===eventKey);let saved:any=existing?JSON.parse(existing.value):null;
 if(saved&&JSON.stringify(saved.event)!==JSON.stringify(e))throw Error('同一消息编号不能修改内容');
 const result=rows.find(r=>r.key==='result:'+e.id);if(result)return JSON.parse(result.value);
 if(args.operation!=='send')throw Error('桌宠操作无效');
 if(!saved){
  if(e.kind==='timer'&&Date.now()-e.at>30000)return {status:'expired'};
  if(records.filter(r=>r.source==='pet').length>=500)throw Error('桌宠云端待同步记录已满，请回网页补齐聊天');
  // Persist the immutable accepted input before enqueueing. Retries use this saved UUID.
  saved={event:e,uuid:crypto.randomUUID(),acceptedAt:Date.now(),scheduled:false};
  await io.write(namespace,args.charId,[{key:eventKey,value:JSON.stringify(saved)},{key:'record:'+e.id+':in',value:JSON.stringify({id:e.id+':in',eventId:e.id,at:saved.acceptedAt,role:e.kind==='text'?'user':'system',content:petEventContent(e),kind:e.kind,formId:e.formId,source:'pet'})}]);
 }
 if(!rows.some(r=>r.key==='record:'+e.id+':in')&&!rows.some(r=>r.key==='claim:'+e.id))await io.write(namespace,args.charId,[{key:'record:'+e.id+':in',value:JSON.stringify({id:e.id+':in',eventId:e.id,at:saved.acceptedAt,role:e.kind==='text'?'user':'system',content:petEventContent(e),kind:e.kind,formId:e.formId,source:'pet'})}]);
 if(!saved.scheduled){
  // UUID + idempotency key prevent an interrupted acknowledgement from enqueueing twice.
  await io.schedule({uuid:saved.uuid,idempotencyKey:'tapnest:'+saved.uuid,contactName:config.name,messageType:'auto',messageSubtype:'job',immediate:true,recurrenceType:'none',tzId:'UTC',messages:[{role:'user',content:'桌宠事件'}],apiUrl:config.api.url,apiKey:config.api.key,primaryModel:config.api.model,temperature:config.api.temperature??.8,maxTokens:config.api.maxTokens,metadata:{charId:args.charId,amsgKind:PET_CLOUD_KIND,petEventId:e.id,petRevision:e.revision}});
  saved.scheduled=true;await io.write(namespace,args.charId,[{key:eventKey,value:JSON.stringify(saved)}]);
 }
 await kickInstantTick(env,saved.uuid);return {status:'queued'};
}
export async function handlePetCloud(request:Request,env:PetEnv,upstream:InstantChatUpstream,json:(status:number,body:unknown)=>Response){
 if(request.method!=='POST')return json(405,{success:false,error:'POST required'});
 try{
  if(Number(request.headers.get('Content-Length')||0)>4500000)throw Error('桌宠请求过大');
  const operation=new URL(request.url).pathname.split('/').pop()!;let userId:string,charId:string,payload:any;
  if(operation==='register'){
   if(env.AMSG_SERVER_TOKEN&&!(await constantTimeEqual(request.headers.get('X-Client-Token')||'',env.AMSG_SERVER_TOKEN)))return json(401,{success:false,error:'Unauthorized'});
   userId=request.headers.get('X-User-Id')||'';if(!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(userId))throw Error('用户编号无效');
   const envelope=JSON.parse(await readMaybeGzippedBody(request));payload=await decryptPayload(envelope as any,await deriveUserEncryptionKey(userId,env.AMSG_MASTER_KEY));charId=payload.charId;
  }else{
   const body:any=JSON.parse(await readMaybeGzippedBody(request)),scope=await verifyPetCapability(env,body.capability);userId=scope.userId;charId=scope.charId;payload={scope,event:body.event};
  }
  if(!validId(charId)||!env.INSTANT_TICK)throw Error('Worker桌宠通道尚未就绪，请更新Worker');
  const args={operation,userId,charId,payload};const data=await env.INSTANT_TICK.get(env.INSTANT_TICK.idFromName('tapnest-admit:'+userId+':'+charId)).petAdmit(args);return json(200,{success:true,data});
 }catch(e){return json(400,{success:false,error:e instanceof Error?e.message:'桌宠请求未完成'});}
}
