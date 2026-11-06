import React,{useEffect,useState} from 'react';
import {DB} from '../../../utils/db';
import type {Message} from '../../../types';
import InnerVoiceChip from '../innerVoice/InnerVoiceChip';
import type {InnerVoice} from '../innerVoice/protocol';
import MessageDetailEditor from './MessageDetailEditor';
export default function EditableInnerVoice({messageId,value,dark}:{messageId?:number;value?:InnerVoice;dark?:boolean}){
 const [message,setMessage]=useState<Message|null>(null);useEffect(()=>{let active=true;setMessage(null);if(messageId)void DB.getMessageById(messageId).then(row=>{if(active)setMessage(row);}).catch(()=>{});const changed=(e:Event)=>{const row=(e as CustomEvent<Message>).detail;if(active&&row.id===messageId)setMessage(row);};window.addEventListener('personal-message-edited',changed);return()=>{active=false;window.removeEventListener('personal-message-edited',changed);};},[messageId,value]);
 const chip=<InnerVoiceChip value={message?.metadata?.innerVoice||value} dark={dark}/>;return message?.metadata?.innerVoice?<MessageDetailEditor message={message} kind="heart">{chip}</MessageDetailEditor>:chip;
}
