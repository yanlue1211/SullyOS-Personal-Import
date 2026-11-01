import React from 'react';
import ReplyEditor from '../../../components/ReplyEditor';
import type {Message} from '../../../types';
import {readResponseStatus} from '../responseStatus/protocol';
import {editMessageDetail} from './storage';
export default function MessageDetailEditor({message,kind,children,disabled}:{message:Message;kind:'heart'|'status';children:React.ReactNode;disabled?:boolean}){
 const heart=message.metadata?.innerVoice,status=readResponseStatus(message.content,message.metadata);
 const fields=kind==='heart'?[{key:'state',label:'当前状态',value:heart?.state||''},{key:'thoughts',label:'内心想法',value:heart?.thoughts||''},{key:'undercurrent',label:'深层暗流',value:heart?.undercurrent||''}]:[{key:'reason',label:'状态内情',value:status?.reason||'',required:true},{key:'footer',label:'状态文字',value:status?.footer||''},...(status?.kind==='busy'?[{key:'eta',label:'预计有空',value:status.eta}]:[])];
 return <ReplyEditor key={message.id} inline={kind==='heart'} disabled={disabled} title={kind==='heart'?'修改心声':status?.kind==='read'?'修改已读不回':'修改忙碌状态'} fields={fields} onSave={async values=>{await editMessageDetail(message,kind,values);}}>{children}</ReplyEditor>;
}
