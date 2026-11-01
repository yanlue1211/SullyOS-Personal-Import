import {DB} from '../../utils/db';
import {loadCharacterContextRange} from '../../utils/chatContextRange';
import {readWorkroomEvent} from '../../utils/workroomEvent';
import {WorkroomStorage as W} from './storage';
import {drainWorkroomOutbox} from './delivery';
const locks=new Map<string,Promise<void>>();
/** A new introduction is needed only when this game has left the active chat range. */
export function ensureGameStarted(charId:string,workId:string,versionId:string,userName='用户'):Promise<void>{
 const key=JSON.stringify([charId,workId]);const previous=locks.get(key)||Promise.resolve();
 const task=previous.catch(()=>{}).then(async()=>{const char=await DB.getCharacter(charId);if(!char||!char.workroomLinkEnabled)return;
  await drainWorkroomOutbox(charId);const range=await loadCharacterContextRange(char);
  if(range.messages.some(m=>{const e=readWorkroomEvent(m.metadata?.workroomEvent,charId);return e?.subjectId===workId&&['started','progress'].includes(e.kind)&&!e.detail.startsWith('作品提出修改请求');}))return;
  await W.recordEvent(charId,workId,versionId,'start-'+crypto.randomUUID(),userName+'与'+char.name+'开始玩这款游戏。',{kind:'started',actor:'game',userName});
  await drainWorkroomOutbox(charId);
 });locks.set(key,task);void task.finally(()=>{if(locks.get(key)===task)locks.delete(key);}).catch(()=>{});return task;
}
export function gameNarration(actorName:string,details:string[],charName:string,userName:string):string{
 const clean=[...new Set(details.map(t=>t.trim()).filter(Boolean))].map(t=>t.replace(/\bchar\b/gi,charName).replace(/\buser\b/gi,userName));
 return `【游戏旁白】\n操作者：${actorName}\n本轮行为与游戏变化：${clean.join('；').slice(0,7000)}`;
}
