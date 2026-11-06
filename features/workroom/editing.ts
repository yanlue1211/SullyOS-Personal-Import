import type {APIConfig,UserProfile} from '../../types';
import {DB,openDB} from '../../utils/db';
import {loadCharacterContextRange} from '../../utils/chatContextRange';
import {buildChatRequestPayload,type BuildChatPayloadInput} from '../../utils/chatRequestPayload';
import {resolveDialogueApi,dialogueMaxTokens} from '../../utils/characterApi';
import {safeFetchJson,extractContent} from '../../utils/safeApi';
import {WorkroomStorage as W} from './storage';
import {idbResult,transactionDone,validText,type WorkroomTurn} from './schema';
import {WORKROOM_HISTORY_UPDATED} from './delivery';
import {assertResponseComplete,responsePreview} from './response';
import {extractInnerVoice} from '../personal/innerVoice/protocol';
import {parseWorkroomReply} from './reply';
/** Source and delivered chat projection change in one transaction, preserving IDs and timestamps. */
export async function editWorkroomReply(charId:string,workId:string,id:string,expectedText:string,text:string){
 if(!validText(text,8000))throw Error('回复不能为空或超过8000字');const db=await openDB(),tx=db.transaction(['workroom_turns','workroom_works','messages'],'readwrite'),done=transactionDone(tx);void done.catch(()=>{});
 try{const work=await idbResult(tx.objectStore('workroom_works').get(workId)),store=tx.objectStore('workroom_turns'),turn=await idbResult<WorkroomTurn|undefined>(store.get(id));if(work?.charId!==charId||!turn||turn.charId!==charId||turn.workId!==workId||turn.role!=='assistant'||turn.text!==expectedText)throw Error('原回复已变化，请重新打开');
 if(turn.messageId){const messages=tx.objectStore('messages'),message=await idbResult(messages.get(turn.messageId));if(!message||message.charId!==charId||message.metadata?.workroomTurnId!==id)throw Error('对应聊天消息缺失或已变化');await idbResult(messages.put({...message,content:`【造物间·${turn.kind==='play'?'游戏互动':'创作交流'}】《${turn.workTitle}》\n${text}`}));}
 await idbResult(store.put({...turn,text}));await done;if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(WORKROOM_HISTORY_UPDATED,{detail:{charId}}));
 }catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}
}
/** Reword a reply only: never replay a game action, reroll loot or change saved code. */
export async function regenerateWorkroomReply(input:{charId:string;workId:string;turn:WorkroomTurn;api:APIConfig;user:UserProfile;signal:AbortSignal;context?:Pick<BuildChatPayloadInput,'realtimeConfig'|'groups'|'emojis'|'categories'>}){
 const char=await DB.getCharacter(input.charId);if(!char)throw Error('角色不存在');const snapshot=await W.get(char.id,input.workId),turns=input.turn.kind==='play'?await W.playTurns(char.id,input.workId):await W.turns(char.id,input.workId);const turn=turns.find(t=>t.id===input.turn.id);if(!turn||turn.role!=='assistant'||turn.text!==input.turn.text)throw Error('原回复已变化');const api=resolveDialogueApi(input.api,char);if(!api.baseUrl||!api.model)throw Error('请先配置聊天API');
 const range=await loadCharacterContextRange(char),history=range.messages.filter(m=>turn.messageId?m.id<turn.messageId:m.timestamp<turn.createdAt),prior=turns.filter(t=>t.createdAt<turn.createdAt).slice(-12).map(t=>({role:t.role,text:t.text}));input.signal.throwIfAborted();
 const payload=await buildChatRequestPayload({...input.context,char,userProfile:input.user,groups:input.context?.groups||[],emojis:[],categories:[],historyMsgs:history,contextLimit:Math.max(1,history.length),contextHighWaterMark:range.hwm,recallEntryPoint:'workroom',signal:input.signal,stripImages:true,appPrompt:{rules:'重新撰写造物间里这一轮角色的公开回复，保持人设、世界书与记忆，回应本轮之前的交流。只输出自然台词，不输出代码、工具、心声或控制标签。游戏事件已经发生，不能重做操作、重抽结果或改变游戏状态；不能声称生成或修改了代码。',scene:JSON.stringify({作品:snapshot.work.title,简介:snapshot.work.summary,本轮之前的交流:prior})}});
 const data=await safeFetchJson(`${api.baseUrl.replace(/\/+$/,'')}/chat/completions`,{method:'POST',signal:input.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${api.apiKey||'sk-none'}`},body:JSON.stringify({model:api.model,messages:[...payload.fullMessages,{role:'user',content:'请重新回复上述这一轮，只返回这次公开回复的文字。'}],max_tokens:dialogueMaxTokens(api),temperature:api.temperature??.8,stream:false})},0,0,{appName:'造物间',charId:char.id,charName:char.name,purpose:'重新回复'});
 input.signal.throwIfAborted();const raw=extractContent(data);assertResponseComplete(data,{stage:'重新回复',model:api.model,maxTokens:dialogueMaxTokens(api),characters:raw.length,finishReason:data?.choices?.[0]?.finish_reason,preview:responsePreview(raw,[api.apiKey||''])});const parsed=parseWorkroomReply(extractInnerVoice(raw).text);if(parsed.code||parsed.action)throw Error('本次只重写回复，模型返回了代码或工具操作；原回复保留，请重试');await editWorkroomReply(char.id,input.workId,turn.id,turn.text,parsed.text);
}
