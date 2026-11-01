import {openDB} from '../../../utils/db';
import type {Message} from '../../../types';
import {readResponseStatus,normalizeResponseStatus} from '../responseStatus/protocol';
export async function editMessageDetail(message:Message,kind:'heart'|'status',values:Record<string,string>):Promise<Message>{
 const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('messages','readwrite'),store=tx.objectStore('messages');let result:Message,error:unknown;const req=store.get(message.id);req.onsuccess=()=>{try{const row=req.result as Message;if(!row||row.charId!==message.charId||row.role!=='assistant')throw Error('找不到可修改的角色消息');const key=kind==='heart'?'innerVoice':'responseStatus';if(JSON.stringify(row.metadata?.[key])!==JSON.stringify(message.metadata?.[key])||row.content!==message.content)throw Error('这条消息已经变化，请重新打开后修改');if(Object.values(values).some(v=>typeof v!=='string'||v.length>12000))throw Error('修改内容过长');
 if(kind==='heart'){if(!row.metadata?.innerVoice)throw Error('这条消息没有心声');result={...row,metadata:{...row.metadata,innerVoice:{state:values.state||'',thoughts:values.thoughts||'',undercurrent:values.undercurrent||''}}};}
 else{const previous=readResponseStatus(row.content,row.metadata);if(row.type!=='score_card'||!previous)throw Error('这条消息不是回应状态卡');const status=normalizeResponseStatus({...previous,...values});if(!status)throw Error('请填写状态内情');result={...row,content:JSON.stringify(status),metadata:{...row.metadata,responseStatus:status}};}
 store.put(result);
 }catch(e){error=e;tx.abort();}};tx.oncomplete=()=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('personal-message-edited',{detail:result}));resolve(result);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(error||tx.error||Error('保存失败'));});
}
