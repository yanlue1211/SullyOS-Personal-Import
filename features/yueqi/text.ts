import {cleanVoiceMarkupForDisplay} from '../../utils/minimaxTts';
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
/** Same native <#秒#> syntax as the built-in MiniMax guide, only at paragraphs. */
export function yueqiSpeechText(raw:string,miniMax=true):string {
 const text=yueqiDisplayText(raw);
 return miniMax?text.replace(/\n[ \t]*(?:\n[ \t]*)*/g,'\n<#0.6#>'):text;
}
