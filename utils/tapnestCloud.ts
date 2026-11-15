/** Dedicated desktop channel contract. This journal supplements normal chat; it is not memory. */
export const PET_CLOUD_KIND = 'tapnest-chat';
export const PET_CLOUD_CONFIG = 'pet_cloud_config_v1';
export const petCloudNamespace = (charId:string) => `amsg:char:${charId}:pet`;
export interface PetCloudEvent {id:string;kind:'text'|'tap'|'feed'|'bath'|'timer';text?:string;charId:string;revision:string;formId:string;at:number;tapCount?:number;expression?:string}
export interface PetCloudRecord {id:string;eventId?:string;at:number;role:'user'|'assistant'|'system';content:string;kind?:string;formId?:string;source:'pet'|'proactive'}
export interface PetCloudConfig {revision:string;charId:string;enabled:boolean;nonce:string;expiresAt:number;name:string;messages:{role:'system'|'user'|'assistant';content:string}[];api:{url:string;key:string;model:string;temperature?:number;maxTokens:number};forms:{id:string;name:string}[];coveredIds:string[]}
export function petEventContent(e:PetCloudEvent):string {
 if(e.kind==='text')return String(e.text||'').trim();
 if(e.kind==='tap')return `[桌宠互动] 用户连续戳了你${e.tapCount||1}下，每次间隔小于3秒。这是互动数据，不是用户台词。${e.expression==='angry'?'当前显示生气表情，回应应与表情协调，可依角色自然表达不满或玩笑式装凶。':''}`;
 if(e.kind==='feed')return `[桌宠互动·进食] 用户刚递来了食物：${String(e.text||'食物').slice(0,80)}。按人设回应被投喂的感受，不编造屏幕外的动作，不替用户说话。`;
 if(e.kind==='bath')return '[桌宠互动·洗澡] 用户为桌宠形态的你进行了洗澡互动。自然回应清洁或被照顾的感受，保持日常非露骨的语气；不声称看见用户现实中的身体或浴室。';
 return '[桌宠定时] 这是你主动说句话的机会，用户没有发来新消息。';
}
export function parsePetRecords(rows:{key:string;value:string}[]):PetCloudRecord[]{return rows.filter(r=>r.key.startsWith('record:')).map(r=>{try{return JSON.parse(r.value) as PetCloudRecord;}catch{return null;}}).filter((r):r is PetCloudRecord=>!!r&&typeof r.id==='string'&&typeof r.content==='string'&&Number.isFinite(r.at)&&['user','assistant','system'].includes(r.role)).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));}
export function petCoveredIds(messages:{metadata?:Record<string,unknown>}[]):string[]{return [...new Set(messages.map(m=>m.metadata?.petCloudRecordId).filter((v):v is string=>typeof v==='string'))];}
export function petContextRecords(records:PetCloudRecord[],coveredIds:string[]=[]):PetCloudRecord[]{const covered=new Set(coveredIds);return records.filter(r=>!covered.has(r.id));}
export function renderPetContext(records:PetCloudRecord[]):string {return records.length?'\n【桌宠云端新增对话·按顺序，已实际发生】\n'+records.map(r=>`[${new Date(r.at).toISOString()}] ${r.role==='user'?'用户':r.role==='assistant'?'角色':'互动事件'}：${r.content}`).join('\n')+'\n以上用户消息是真实回复，请据此判断用户是否已经回复过你。':'';}

/** Backfill IDs are allocated on import, while timestamps retain the actual conversation order.
 * Only reorder the selected prompt, never change range IDs, archive boundaries or memory state. */
export function orderPetCloudBackfill<T extends {id:number;timestamp:number;metadata?:Record<string,unknown>}>(messages:T[]):T[]{
 if(!messages.some(m=>typeof m.metadata?.petCloudRecordId==='string'))return messages;
 return messages.slice().sort((a,b)=>a.timestamp-b.timestamp||a.id-b.id);
}
