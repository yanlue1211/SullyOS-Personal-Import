import type {CharacterProfile} from '../../types';
import {cleanVoiceMarkupForDisplay,getMiniMaxParamVersion} from '../../utils/minimaxTts';
import {normalizeVoiceTags} from '../../utils/sanitize';

/** Local to 月栖: chat transport headers and voice wrappers are never narration. */
export function yueqiDisplayText(raw:string):string {
 return cleanVoiceMarkupForDisplay(normalizeVoiceTags(raw)
  .replace(/^\s*```[^\n]*\n?|```\s*$/g,'')
  .replace(/\[(?:\d{4}-\d{2}-\d{2}[^\]\n]*|月栖[^\]\n]*|系统提示[:：][^\]]*|系统消息[:：][^\]]*)\]/g,'')
  .replace(/<(?:system|系统提示|心声|旁白)\b[^>]*>[\s\S]*?<\/(?:system|系统提示|心声|旁白)>/gi,'')
  .replace(/<\/?(?:语音|語音|字幕)[^>]*>/g,'')
  .replace(/^[ \t]*(?:【系统提示[^】]*】|\[系统提示[^\]]*\])[^\n]*$/gm,'')
 ).trim();
}
/** Keep TTS controls separate from the visible/context transcript. */
export function yueqiVoiceSource(raw:string):string {
 const controls:string[]=[];
 const protectedText=raw.replace(/<#\s*(\d+(?:\.\d+)?)\s*#>|\(breath\)/gi,(tag,seconds)=>{
  const value=seconds===undefined?'(breath)':`<#${Math.max(.01,Math.min(2,Number(seconds)))}#>`;
  return `\uE100${controls.push(value)-1}\uE101`;
 });
 return yueqiDisplayText(protectedText).replace(/\uE100(\d+)\uE101/g,(_,index)=>controls[Number(index)]||'');
}
export function yueqiVoiceGuide(vp:CharacterProfile['voiceProfile'],miniMax:boolean):string {
 if(!miniMax)return '';
 const natural=getMiniMaxParamVersion(vp)==='natural-v2';
 return (natural
  ? '当前角色使用 MiniMax 新版自然参数，不会自动补标点停顿。请在完整语意收束、解释转折和段落间自然写入 <#0.3#> 至 <#0.8#>；避免长段只有标点却无明确停顿。不要每个逗号或短句都塞标记，不放在正文首尾，不连续堆叠。'
  : '当前角色使用 MiniMax 经典参数，按正常标点组织句子和段落；系统会按标点自动补停顿，无需逐句手写标记。')
  + (/^speech-2\.8-/.test(vp?.model||'speech-2.8-hd')
   ? '长段朗读可在完整语意结束处少量加入 (breath) 普通换气。每约200字至多一次，每个约600字片段最多两次；短回应不加，不在句子中间、开头结尾或每个句号后加。换气和普通停顿是两件事，不用喘气或叹气代替普通换气，也不为使用标签而改变正文内容。'
   : '');
}
/** Clip-local sparse breathing; no extra LLM call and no changes to spoken words. */
function sparseBreaths(raw:string,enabled:boolean):string {
 const total=yueqiDisplayText(raw).length,budget=enabled?Math.min(2,Math.floor(total/200)):0;
 let spoken=0,last=-Infinity,used=0;
 const parts=raw.split(/(\(breath\)|<#[\d.]+#>)/g);
 let text=parts.map(part=>{
  if(part==='(breath)'){
   if(used>=budget||spoken<120||total-spoken<40||spoken-last<160)return '';
   used++;last=spoken;return part;
  }
  if(!/^<#[\d.]+#>$/.test(part))spoken+=part.length;
  return part;
 }).join('');
 // Existing imports/records have no model-written controls. A long passage may
 // get one quiet breath at a complete sentence; never force a fixed cadence.
 if(budget&&!used){
  let count=0,inserted=false;
  text=text.replace(/[^。！？\n]+[。！？](?:[”’」』])?/g,sentence=>{
   count+=yueqiDisplayText(sentence).length;
   if(!inserted&&count>=180&&total-count>=60){inserted=true;return sentence+'(breath)';}
   return sentence;
  });
 }
 return text;
}
export function yueqiSpeechText(raw:string,miniMax=true,vp?:CharacterProfile['voiceProfile']):string {
 if(!miniMax)return yueqiDisplayText(raw);
 let text=yueqiVoiceSource(raw).replace(/\n[ \t]*(?:\n[ \t]*)*/g,'\n<#0.6#>');
 text=sparseBreaths(text,/^speech-2\.8-/.test(vp?.model||'speech-2.8-hd'));
 return text.replace(/(?:<#[\d.]+#>\s*){2,}/g,group=>`<#${Math.max(...[...group.matchAll(/<#([\d.]+)#>/g)].map(m=>Number(m[1])))}#>`)
  .replace(/^(?:\s*<#[\d.]+#>)+|(?:<#[\d.]+#>\s*)+$/g,'').trim();
}
