export type WorkroomCallPhase='context'|'request'|'parse';
export interface ResponseInfo{stage:string;model?:string;maxTokens?:number;finishReason?:string|null;characters?:number}
export class WorkroomResponseError extends Error{
 readonly details:string;
 constructor(message:string,info:ResponseInfo,reason?:unknown){super(message);this.name='WorkroomResponseError';this.details=[message,`阶段：${info.stage}`,info.model&&`模型：${info.model}`,info.maxTokens!==undefined&&`输出额度：${info.maxTokens} Token`,info.finishReason&&`响应结束原因：${info.finishReason}`,info.characters!==undefined&&`收到内容：${info.characters} 字符`,reason&&`格式详情：${reason instanceof Error?reason.message:String(reason)}`,'旧草稿和游戏进度均未被本次失败覆盖。'].filter(Boolean).join('\n');}
}
export function assertResponseComplete(response:any,info:ResponseInfo){
 const reason=response?.choices?.[0]?.finish_reason??response?.stop_reason;
 if(['length','max_tokens'].includes(reason))throw new WorkroomResponseError('模型输出达到额度而被截断。请提高当前模型的输出额度，或让本轮内容更短。',{...info,finishReason:reason});
}
/** Only harmless JSON presentation changes; never close missing brackets or extract a partial child object. */
function normalizePresentation(text:string):string{
 let out='',quoted=false,escaped=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(escaped){out+=c;escaped=false;continue;}if(quoted&&c==='\\'){out+=c;escaped=true;continue;}if(c==='"')quoted=!quoted;
  if(quoted&&c.charCodeAt(0)<32){out+=JSON.stringify(c).slice(1,-1);continue;}
  if(!quoted&&c===','&&/^\s*[}\]]/.test(text.slice(i+1)))continue;out+=c;
 }return out;
}
export function parseCompleteJson(raw:string):unknown{
 let text=raw.replace(/^\uFEFF/,'').trim();
 try{return JSON.parse(text);}catch{/* Try complete wrappers, not truncated data. */}
 const fences=[...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/gi)];
 if(fences.length===1){if(text.replace(fences[0][0],'').includes('```'))throw Error('包含不完整或多个JSON代码块');text=fences[0][1].trim();}
 else if(text.startsWith('```'))throw Error('JSON代码围栏不完整或包含多个数据块');
 try{return JSON.parse(text);}catch{/* Complete object/array with harmless presentation differences. */}
 const start=text.search(/[\[{]/);
 if(start<0)throw Error('未找到完整JSON对象或数组');
 const stack:string[]=[];let quoted=false,escaped=false,end=-1;
 for(let i=start;i<text.length;i++){const c=text[i];if(escaped){escaped=false;continue;}if(quoted&&c==='\\'){escaped=true;continue;}if(c==='"'){quoted=!quoted;continue;}if(quoted)continue;if(c==='{'||c==='[')stack.push(c);else if(c==='}'||c===']'){if(stack.pop()!==(c==='}'?'{':'['))throw Error('JSON括号不匹配');if(!stack.length){end=i+1;break;}}}
 if(end<0||quoted||stack.length)throw Error('JSON内容在结束前被截断');
 const tail=text.slice(end).trim();if(/^[\[{},\]]/.test(tail)||tail.includes('```'))throw Error('收到多个或不完整的数据块');
 const candidate=text.slice(start,end);try{return JSON.parse(candidate);}catch{return JSON.parse(normalizePresentation(candidate));}
}
export function errorDetails(error:unknown):string{return error instanceof WorkroomResponseError?error.details:error instanceof Error?error.message:String(error);}
const reported=new WeakMap<object,number>();
export function showWorkroomFailure(show:((title:string,details:string)=>void)|undefined,title:string,error:unknown){
 if(!show||(error&&typeof error==='object'&&'name' in error&&error.name==='AbortError'))return;
 if(error&&typeof error==='object'){const now=Date.now();if(now-(reported.get(error)||0)<1500)return;reported.set(error,now);}
 show(title,errorDetails(error));
}
