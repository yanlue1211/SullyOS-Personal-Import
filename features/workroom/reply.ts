import {assertCode,validText,type WorkroomCode} from './schema';
export interface WorkroomReply{text:string;code?:WorkroomCode;action?:'read_code'|'test_code'}
/** Code is not JSON-escaped in the preferred protocol. Never repair truncated executable code. */
export function parseWorkroomReply(raw:string):WorkroomReply{
 const text=raw.trim().replace(/^```(?:json|xml|html|text)?\s*\n?/i,'').replace(/\n?```\s*$/,'');
 if(text.length>1_520_000)throw Error('创作回复过大，请分步修改');
 const tool=text.match(/^<workroom-tool>\s*(read_code|test_code)\s*<\/workroom-tool>$/);
 if(tool)return {text:'',action:tool[1] as 'read_code'|'test_code'};
 if(text.includes('<workroom-text>')){
  const parts:Record<string,string>={};let rest=text;
  for(const key of ['text','html','css','js']){
   const pattern=new RegExp('<workroom-'+key+'>([\\s\\S]*?)<\\/workroom-'+key+'>','g');const matches=[...rest.matchAll(pattern)];
   if(matches.length>1)throw Error('创作回复包含重复片段，请重试');
   if(matches.length){parts[key]=matches[0][1];rest=rest.replace(matches[0][0],'');}
  }
  if(/<workroom-|```/.test(rest)||!validText(parts.text,8000))throw Error('创作回复不完整，请重试；旧草稿未覆盖');
  const hasCode=['html','css','js'].some(k=>k in parts);
  if(hasCode){if(!['html','css','js'].every(k=>k in parts))throw Error('代码片段不完整，请重试；旧草稿未覆盖');const code={html:parts.html,css:parts.css,js:parts.js};assertCode(code);return {text:parts.text.trim(),code};}
  return {text:parts.text.trim()};
 }
 if(validText(text,8000)&&!(/^[\[{"]|```|<workroom-|^\s*(?:const|let|function|class|import|export)\s|<\/?(?:script|html|style|button|div)\b/m.test(text)))return {text};
 let value:any;
 try{value=JSON.parse(text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));if(typeof value==='string')value=JSON.parse(value);}catch{throw Error('角色返回的创作格式不完整或JSON转义错误。请点“重试上一条”；旧草稿和进度未被覆盖。');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('角色回复格式不正确，请重试');
 if(['read_code','test_code'].includes(value.action)&&value.code===undefined)return {text:'',action:value.action};
 if(!validText(value.text,8000))throw Error('没有收到完整的创作回复');if(value.code!==undefined)assertCode(value.code);
 return {text:value.text,...(value.code?{code:{html:value.code.html,css:value.code.css,js:value.code.js}}:{})};
}
