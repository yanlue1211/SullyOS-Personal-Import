import type { CharacterProfile } from '../../../types';
import { DB } from '../../../utils/db';
export type IncomingCallMode = 'voice' | 'video';
export interface IncomingCall { id: string; charId: string; mode: IncomingCallMode; createdAt: number; expiresAt: number; }
export const INCOMING_CALL_CHANGED = 'personal-incoming-call-changed';
export const INCOMING_CALL_LAUNCH = 'personal-incoming-call-launch';
let activeCallSession: string | null = null;
export const isLocalCallActive = () => activeCallSession !== null;
export function setLocalCallPresence(sessionId:string, active:boolean) {
 const next=active?sessionId:activeCallSession===sessionId?null:activeCallSession;
 if(next!==activeCallSession){activeCallSession=next;emit();}
}
const KEY = 'personal-incoming-call-v1', SEEN_KEY = 'personal-incoming-call-seen-v1', LAUNCH_KEY = 'personal-incoming-call-launch-v1';
export const CALL_RING_MS = 45_000;
export function allowsIncomingCall(char: Partial<CharacterProfile> | undefined, mode: IncomingCallMode) {
  return mode === 'voice' ? char?.allowIncomingVoiceCalls === true : char?.allowIncomingVideoCalls === true;
}
export function incomingCallGuide(char: CharacterProfile): string {
  const modes = (['voice','video'] as const).filter(mode=>allowsIncomingCall(char,mode));
  if (!modes.length) return '';
  return `\n【主动来电权限】用户允许你主动发起${modes.map(mode=>mode==='voice'?'语音':'视频').join('、')}通话邀请。想来电时，正常发一句简短邀请，并单独输出 ${modes.map(mode=>`[[CALL_INVITE:${mode}]]`).join(' 或 ')}。这是一次等待用户接听的邀请，不代表已经接通；不能假定用户已接听、打开麦克风或摄像头。根据聊天、关系和时机自行决定，不为用功能而来电；未接或拒接后，你可以直接问为什么没接，也可以继续拨打，由你结合性格、真实关系、对方明确表达和当时情境自行决定；不强制停止，也不要求一定追打。系统仅限制同一时刻显示一通来电，并去重同一条已投递邀请；没有按角色设置的来电冷却。仅使用本轮明确允许的类型。\n`;
}
function emit() { if(typeof window!=='undefined')window.dispatchEvent(new Event(INCOMING_CALL_CHANGED)); }
export function readIncomingCall(): IncomingCall | null {
  try { const v=JSON.parse(localStorage.getItem(KEY)||'null');return v&&typeof v.id==='string'&&typeof v.charId==='string'&&['voice','video'].includes(v.mode)&&Number.isFinite(v.createdAt)&&Number.isFinite(v.expiresAt)?v:null; } catch{return null;}
}
export async function requestIncomingCall(charId: string, mode: IncomingCallMode, sourceTime?:number): Promise<string> {
  const char=await DB.getCharacter(charId),now=Date.now();
  const requestedAt=sourceTime??now;
  if(!allowsIncomingCall(char,mode)) return 'permission-denied';
  // Old offline notifications become history, never a fresh ringing call hours later.
  if(!Number.isFinite(requestedAt)||now-requestedAt>90_000||requestedAt>now+60_000)return 'expired';
  try {
    const current=readIncomingCall();if(current&&current.expiresAt>now)return 'busy';
    // Deduplicate an offline/replayed source without limiting a fresh deliberate call.
    if(sourceTime!==undefined){const seen=JSON.parse(localStorage.getItem(SEEN_KEY)||'{}');const key=`${charId}:${sourceTime}:${mode}`;if(seen[key])return 'duplicate';seen[key]=now;for(const id of Object.keys(seen))if(now-seen[id]>86_400_000)delete seen[id];localStorage.setItem(SEEN_KEY,JSON.stringify(seen));}
    const call:IncomingCall={id:`incoming-${charId}-${requestedAt}-${mode}-${Math.random().toString(36).slice(2,8)}`,charId,mode,createdAt:now,expiresAt:now+CALL_RING_MS};
    localStorage.setItem(KEY,JSON.stringify(call));emit();return 'ringing';
  }catch{return 'storage-unavailable';}
}
export function clearIncomingCall(id: string) {
  if(readIncomingCall()?.id!==id)return false;
  try{localStorage.removeItem(KEY);emit();return true;}catch{return false;}
}
export async function settleIncomingCall(call:IncomingCall,outcome:'accepted'|'declined'|'missed'|'busy'|'permission-revoked') {
  if(!clearIncomingCall(call.id))return false;

  const label={accepted:'已接听',declined:'已拒接',missed:'未接听',busy:'通话占线', 'permission-revoked':'来电权限已关闭'}[outcome];
  await DB.saveMessage({charId:call.charId,role:'assistant',type:'text',content:`[${call.mode==='video'?'视频':'语音'}通话邀请：${label}]`,metadata:{source:'incoming_call',incomingCallId:call.id,incomingCallOutcome:outcome}}).catch(error=>console.warn('[IncomingCall] 保存来电记录失败',error));
  return true;
}
export function queueIncomingCallLaunch(call:IncomingCall) { localStorage.setItem(LAUNCH_KEY,JSON.stringify(call));if(typeof window!=='undefined')window.dispatchEvent(new Event(INCOMING_CALL_LAUNCH)); }
export function takeIncomingCallLaunch():IncomingCall|null {
  try{const raw=localStorage.getItem(LAUNCH_KEY);localStorage.removeItem(LAUNCH_KEY);const v=raw?JSON.parse(raw):null;return v&&Date.now()-v.createdAt<90_000&&['voice','video'].includes(v.mode)?v:null;}catch{return null;}
}
export async function consumeIncomingCallInvites(text:string,charId:string,sourceTime?:number):Promise<string> {
  // Ignore quoted/hidden thinking and private heart content: only top-level final actions execute.
  const hidden=/<(think|thinking|thought|心声)(?:\s[^>]*)?>[\s\S]*?(?:<\/\1\s*>|$)|```[\s\S]*?```|`[^`\n]*`|^>[^\n]*/gim;
  const visible=text.replace(hidden,'');
  const matches=[...visible.matchAll(/\[\[CALL_INVITE\s*:\s*(voice|video)\s*\]\]/gi)];
  if(matches.length)await requestIncomingCall(charId,matches[0][1].toLowerCase() as IncomingCallMode,sourceTime);
  return text.replace(/\[\[CALL_INVITE\s*:[^\]\n]*\]\]/gi,'').trim();
}
