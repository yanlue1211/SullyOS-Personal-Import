import {cloneWorkroomState,validText} from './schema';
export interface RuntimeRequest{instruction:string;context?:unknown;format:'text'|'json';publicEvent?:string;shareReply?:boolean}
export function readRuntimeRequest(value:unknown):RuntimeRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('运行生成任务无效');const v=value as Record<string,unknown>;
 if(!validText(v.instruction,4000)||!['text','json'].includes(String(v.format??'text'))||(v.publicEvent!==undefined&&!validText(v.publicEvent,1500))||(v.shareReply!==undefined&&typeof v.shareReply!=='boolean'))throw Error('运行生成参数无效');
 const context=v.context===undefined?null:cloneWorkroomState(v.context);if(JSON.stringify(context).length>12000)throw Error('本轮游戏材料过长，请只发送必要部分');
 return {instruction:v.instruction,context,format:(v.format??'text') as 'text'|'json',...(v.publicEvent?{publicEvent:v.publicEvent as string}:{}),shareReply:v.shareReply===true};
}
