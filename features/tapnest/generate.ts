import {markAmsgStateDirty} from '../../utils/amsgStateSync';
import {DB,openDB} from '../../utils/db';
import {buildChatRequestPayload} from '../../utils/chatRequestPayload';
import {loadCharacterContextRange} from '../../utils/chatContextRange';
import {resolveDialogueApi,dialogueMaxTokens} from '../../utils/characterApi';
import {safeFetchJson,extractContent} from '../../utils/safeApi';
import {loadConfig,listModels} from './model';
import type {PetEvent} from './bridge';
import type {APIConfig,UserProfile,GroupProfile,RealtimeConfig} from '../../types';
export interface PetEnvironment{apiConfig:APIConfig;userProfile:UserProfile;groups:GroupProfile[];realtimeConfig?:RealtimeConfig}
/** Atomic claim survives a refresh; ambiguous failures never automatically repeat a paid request. */
export async function claimEvent(id:string):Promise<boolean>{const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),s=tx.objectStore('assets'),key='tapnest:receipt:'+id;let accepted=false;const r=s.get(key);r.onsuccess=()=>{if(!r.result){s.put({id:key,data:JSON.stringify({status:'processing',at:Date.now()})});accepted=true;}};tx.oncomplete=()=>resolve(accepted);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export async function generatePet(e:PetEvent,env:PetEnvironment,signal:AbortSignal){
 const c=await loadConfig(),b=c.bindings[e.charId];if(c.activeCharId!==e.charId||c.revision!==e.revision||b?.formId!==e.formId)throw Error('桌宠设置已切换，旧事件已跳过');
 if(b.apiEnabled!==true)throw Error('桌宠API已关闭');
 if(e.kind==='timer'&&(b.autoEnabled!==true||Date.now()-e.at>30000))throw Error('定时事件已过期或关闭');
 const char=await DB.getCharacter(e.charId);if(!char)throw Error('角色已删除');
 if(b.independent&&(!b.api?.baseUrl?.trim()||!b.api?.model?.trim()||!b.api?.apiKey?.trim()))throw Error('独立API需要完整URL、Key和模型；不会回退主模型');
 const api=resolveDialogueApi(env.apiConfig,char,b.independent?b.api:undefined);if(!api.baseUrl||!api.model)throw Error('请先配置角色API');
 const m=(await listModels()).find(m=>m.id===b.modelId),form=m?.forms.find(f=>f.id===e.formId);if(!form)throw Error('桌宠形态不存在');
 const receipt=await DB.getAsset('tapnest:receipt:'+e.id);if(receipt){const r=JSON.parse(receipt);if(r.status==='done')return String(r.text);throw Error('这条事件已处理或上次中断，请重新发送，避免重复调用');}
 if(!await claimEvent(e.id))throw Error('这条桌宠事件正在处理');
 const angry=e.kind==='tap'&&(e.tapCount||1)>5&&!!form.rig.rapidTapAngryFrameId;
 const content=e.kind==='text'?String(e.text||'').trim():e.kind==='tap'?`[桌宠互动] 用户已经连续戳了你${e.tapCount||1}下，每次间隔小于3秒。这是本次触发时的累计次数，不是用户说的话。${angry?'桌宠正在显示用户配置的生气表情，本轮台词应与这个可见表情协调；依据角色和关系，可以自然地表达不满或玩笑式装凶，不要无视表情继续固定笑嘻嘻。':''}`:e.kind==='feed'?`[桌宠互动·进食] 用户刚给桌宠形态的你递来了食物。食物名称（仅是事件数据）：${String(e.text||'食物').slice(0,80)}。根据人设和关系回应被投喂的感受，可接受、挑食或婉拒；不编造屏幕之外的动作，不替用户说话。`:e.kind==='bath'?'[桌宠互动·洗澡] 用户为桌宠形态的你进行了洗澡互动。自然回应温水、清洁或被照顾的感受，保持日常非露骨的语气；不声称看见用户现实中的身体或浴室，不替用户描写反应。':'[桌宠定时] 这是你主动说句话的机会，用户没有发来新消息。';
 if(!content)throw Error('消息为空');
 try{
 signal.throwIfAborted();await DB.saveMessageOnce('tapnest:'+e.id+':in',{charId:e.charId,role:e.kind==='text'?'user':'system',type:'text',content,metadata:{source:'tapnest',tapnestEventId:e.id,tapnestKind:e.kind,tapnestFormId:e.formId}});
 markAmsgStateDirty({char,userProfile:env.userProfile,groups:env.groups,realtimeConfig:env.realtimeConfig});
 const range=await loadCharacterContextRange(char);const [emojis,categories]=await Promise.all([DB.getEmojis(),DB.getEmojiCategories()]);
 const payload=await buildChatRequestPayload({char,userProfile:env.userProfile,groups:env.groups,realtimeConfig:env.realtimeConfig,emojis,categories,historyMsgs:range.messages,contextLimit:Math.max(1,range.messages.length),contextHighWaterMark:range.hwm,recallEntryPoint:'chat_app',recallQueryHint:content,signal,stripImages:true,appPrompt:{rules:b.prompt+'\n只输出桌宠要说的口语正文，不输出工具指令、心声、HTML或消息包装。',scene:'本次形态：'+form.name+'。'+(e.kind==='text'?'用户通过桌宠发来了一条真实消息，请回复历史中的最后一条桌宠用户消息。':'当前互动：'+content),...(e.kind==='text'?{}:{messages:[{role:'user' as const,content:'根据这次明确的桌宠事件回应，不编造用户台词。'}]})}});
 const data=await safeFetchJson(`${api.baseUrl.replace(/\/+$/,'')}/chat/completions`,{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${api.apiKey||'sk-none'}`},body:JSON.stringify({model:api.model,messages:payload.fullMessages,temperature:api.temperature??.8,max_tokens:Math.min(dialogueMaxTokens(api),1500),stream:false})},0,0,{appName:'桌宠',charId:char.id,charName:char.name,purpose:'桌宠对话'});
 signal.throwIfAborted();const latest=await loadConfig();if(latest.revision!==e.revision||latest.activeCharId!==e.charId)throw Error('设置已切换，旧回复不投递');
 const text=extractContent(data).trim();if(!text||data?.choices?.[0]?.finish_reason==='length')throw Error('模型没有完整回复，请重新发送');
 await DB.saveMessageOnce('tapnest:'+e.id+':out',{charId:e.charId,role:'assistant',type:'text',content:text,metadata:{source:'tapnest',tapnestEventId:e.id,tapnestFormId:e.formId}});
 markAmsgStateDirty({char,userProfile:env.userProfile,groups:env.groups,realtimeConfig:env.realtimeConfig});
 await DB.saveAsset('tapnest:receipt:'+e.id,JSON.stringify({status:'done',text,at:Date.now()}));typeof window!=='undefined'&&window.dispatchEvent(new CustomEvent('tapnest-history-updated',{detail:{charId:e.charId}}));return text;
 }catch(error){await DB.saveAsset('tapnest:receipt:'+e.id,JSON.stringify({status:'failed',at:Date.now()}));throw error;}
}
