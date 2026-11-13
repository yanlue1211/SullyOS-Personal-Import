import React,{useEffect,useRef} from 'react';
import {useOS} from '../../context/OSContext';
import {CHANGED,loadConfig} from './model';
import {call,connection,disconnect,report,syncConfig,validEvent,changeForm,STATE} from './bridge';
import {generatePet} from './generate';
export default function Runtime(){const os=useOS(),env=useRef(os);env.current=os;
 useEffect(()=>{let stopped=false,synced='',timer:ReturnType<typeof setTimeout>;const controller=new AbortController();connection.controller=controller;
 const changed=()=>{synced='';controller.abort();};
 // A settings change restarts the gate's runtime; old generation is aborted immediately.
 window.addEventListener(CHANGED,changed);
 const pump=async()=>{if(stopped||!connection.token)return;try{const c=await loadConfig();if(synced!==c.revision)synced=await syncConfig(c,controller.signal);const data=await call('/watch',undefined,controller.signal);
 for(const event of (data.events||[]).slice(0,10)){if(!validEvent(event))continue;if(event.revision!==c.revision||event.charId!==c.activeCharId){await call('/ack',{ids:[event.id]});continue;}
 if(event.kind==='form'||event.kind==='wardrobe'){await call('/ack',{ids:[event.id]});await changeForm(event);return;}
 if(event.kind==='timer'&&(Date.now()-event.at>30000||document.visibilityState==='visible'&&document.activeElement?.matches('input,textarea,[contenteditable=true]')||env.current.activeApp==='call'||env.current.activeApp==='date')){await call('/ack',{ids:[event.id]});continue;}
 connection.busy=true;report('角色正在回复桌宠…');await call('/busy',{revision:c.revision,busy:true});
 try{const text=await generatePet(event,env.current,controller.signal);if(!stopped&&connection.token)await call('/speech',{id:event.id,revision:event.revision,charId:event.charId,formId:event.formId,text});report('已连接 · 回复已送达');}
 catch(e){if(!controller.signal.aborted){report('桌宠：'+(e instanceof Error?e.message:String(e)));await call('/error',{revision:event.revision,formId:event.formId,text:'本次未完成，请打开糯米机桌宠App查看原因。'}).catch(()=>{});}}
 finally{connection.busy=false;if(connection.token)await call('/ack',{ids:[event.id]}).catch(()=>{});await call('/busy',{revision:c.revision,busy:false}).catch(()=>{});}
 }
 }catch(e){if(!stopped&&!controller.signal.aborted){disconnect('连接中断，请回桌宠App重新配对：'+String(e));}}
 finally{if(!stopped&&!controller.signal.aborted)timer=setTimeout(pump,300);}};
 void pump();return()=>{stopped=true;clearTimeout(timer);controller.abort();window.removeEventListener(CHANGED,changed);};},[]);return null;}
