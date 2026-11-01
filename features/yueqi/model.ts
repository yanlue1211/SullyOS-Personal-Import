export type Mode = 'story' | 'night';
export interface Turn { id:string; role:'user'|'assistant'; text:string; at:number; source:'user'|'automatic'|'story'; played:boolean }
export interface Clip { id:string; turnId:string; text:string; audio?:string; audioKey?:string; audioBytes?:number; seconds?:number; error?:string }
export interface Session {
 id:string; charId:string; mode:Mode; scene?:'online'|'offline'; sleepDay:string; title:string; kind:string; theme:string;
 createdAt:number; endedAt?:number; targetMinutes:number; intervalMinutes:number; gradual:boolean; allowQuiet:boolean;
 speed:number; turns:Turn[]; clips:Clip[]; status:'draft'|'preparing'|'ready'|'active'|'paused'|'ended';
 checkpointAt?:number; elapsedMs:number; runningSince?:number; cursor:number; offset:number; compactSummary?:string; compactedThrough?:number; plan?:string; plannedParts?:number; summary?:string; cardId?:number;
}
export function sleepDay(at=new Date(), boundary=6):string {
 const date=new Date(at); if(date.getHours()<boundary)date.setDate(date.getDate()-1);
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function elapsed(s:Session,now=Date.now()) { return s.elapsedMs+(s.runningSince?Math.max(0,now-s.runningSince):0); }
export function splitSpeech(text:string,max=600):string[] {
 const result:string[]=[]; let chunk='';
 for(const sentence of text.match(/[^。！？\n]+[。！？\n]*|[。！？\n]+/g)||[text]) {
  if(chunk.length+sentence.length>max&&chunk.trim()){result.push(chunk.trim());chunk='';}
  for(let i=0;i<sentence.length;i+=max){const part=sentence.slice(i,i+max);if(part.length===max){if(chunk.trim())result.push(chunk.trim());result.push(part);chunk='';}else chunk+=part;}
 }
 if(chunk.trim())result.push(chunk.trim());return result;
}
export function nextInterval(s:Session) {const progress=elapsed(s)/(s.targetMinutes*60000);return s.intervalMinutes*60000*(s.gradual&&progress>=.5?2:1);}
export function newSession(charId:string,mode:Mode,options:Partial<Session>={}):Session {
 return {...{id:crypto.randomUUID(),charId,mode,scene:'online',sleepDay:sleepDay(),title:mode==='story'?'枕月听书':'小羊夜话',kind:'睡前故事',theme:'',createdAt:Date.now(),targetMinutes:15,intervalMinutes:5,gradual:true,allowQuiet:true,speed:1,turns:[],clips:[],status:'draft',elapsedMs:0,cursor:0,offset:0},...options};
}

export function sceneRules(scene:Session['scene']){return scene==='offline'
 ? '陪伴场景：月下相依（线下见面）。在本场角色扮演中，你与用户处于同一空间，可以自然地当面轻声交谈。不要说正在隔着屏幕或远程通话。亲密程度遵循既有关系，不默认同床、拥抱或任何身体接触；不代写用户的动作、感受、回答或同意。这是月栖的线下扮演场景，不证明现实世界发生了见面。'
 : '陪伴场景：隔屏伴月（线上陪伴）。你知道双方通过设备远程语音陪伴，不能真的触碰、看见或替用户做事；可以表达愿望和想象，但要明确是想象，不把拥抱等描述成实际发生。';}
