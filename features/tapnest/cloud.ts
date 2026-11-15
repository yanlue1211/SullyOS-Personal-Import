import {ActiveMsgClient} from '../../utils/activeMsgClient';
import {DB} from '../../utils/db';
import {buildChatRequestPayload} from '../../utils/chatRequestPayload';
import {loadCharacterContextRange} from '../../utils/chatContextRange';
import {resolveDialogueApi,dialogueMaxTokens} from '../../utils/characterApi';
import {normalizeChatApiUrl} from '../../utils/amsgLlmCredentials';
import {receivedCloudOccurrences} from '../../utils/amsgFirePack';
import {petCoveredIds,type PetCloudConfig} from '../../utils/tapnestCloud';
import {loadConfig,listModels,type PetConfig} from './model';
import type {PetEnvironment} from './generate';
export {recoverPetCloudHistory} from '../../utils/tapnestCloudHistory';
import {recoverPetCloudHistory} from '../../utils/tapnestCloudHistory';
const prepared=new Map<string,{fingerprint:string;result:any;at:number}>();
/** Browser prepares the existing worldbook/memory context; native gets only a scoped capability. */
export async function refreshPetCloudContext(charId:string,env:PetEnvironment,c?:PetConfig){
 c=c||await loadConfig();const b=c.bindings[charId];if(!b?.cloudEnabled||!b.apiEnabled)return null;
 await recoverPetCloudHistory(charId);
 const char=await DB.getCharacter(charId);if(!char)throw Error('桌宠角色已删除');
 if(b.independent&&(!b.api?.baseUrl?.trim()||!b.api?.apiKey?.trim()||!b.api?.model?.trim()))throw Error('桌宠独立API配置不完整，不会回退主模型');
 const api=resolveDialogueApi(env.apiConfig,char,b.independent?b.api:undefined);if(!api.baseUrl||!api.model||!api.apiKey)throw Error('请先配置桌宠使用的API');
 const m=(await listModels()).find(m=>m.id===b.modelId);if(!m)throw Error('桌宠模型不存在');
 const range=await loadCharacterContextRange(char);
 const fingerprint=JSON.stringify({revision:c.revision,char,api,user:env.userProfile,groups:env.groups,realtime:env.realtimeConfig,history:range.messages.map(m=>[m.id,m.content,m.metadata]),hwm:range.hwm});
 const previous=prepared.get(charId);if(previous?.fingerprint===fingerprint&&Date.now()-previous.at<3600000)return previous.result;
 const [emojis,categories]=await Promise.all([DB.getEmojis(),DB.getEmojiCategories()]);
 const payload=await buildChatRequestPayload({char,userProfile:env.userProfile,groups:env.groups,realtimeConfig:env.realtimeConfig,emojis,categories,historyMsgs:range.messages,contextLimit:Math.max(1,range.messages.length),contextHighWaterMark:range.hwm,recallEntryPoint:'chat_app',stripImages:true,appPrompt:{rules:b.prompt+'\n只输出桌宠气泡中的口语正文，不输出时间戳、来源标签、心声、工具指令或HTML。',scene:'你正通过桌宠与用户聊天。末尾的云端新增对话是此份网页上下文之后真实发生的对话，按最新事件自然回应。'}});
 const config:Omit<PetCloudConfig,'nonce'|'expiresAt'>={charId,revision:c.revision,enabled:true,name:char.name,messages:payload.fullMessages.map((v:any)=>({role:v.role,content:typeof v.content==='string'?v.content:JSON.stringify(v.content)})),api:{url:normalizeChatApiUrl(api.baseUrl,api.apiType),key:api.apiKey,model:api.model,temperature:api.temperature,maxTokens:Math.min(1500,dialogueMaxTokens(api))},forms:m.forms.map(f=>({id:f.id,name:f.name})),coveredIds:[...petCoveredIds(range.messages),...receivedCloudOccurrences(range.messages).map(id=>'proactive:'+id)]};
 if((await loadConfig()).revision!==c.revision)throw Error('桌宠设置已更新，旧上下文不再上传');
 const result={...await ActiveMsgClient.registerPetCloud(config),charId,revision:c.revision};prepared.set(charId,{fingerprint,result,at:Date.now()});return result;
}
