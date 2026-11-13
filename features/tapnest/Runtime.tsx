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
 const pump=async()=>{if(stopped||!connection.token)return;try{const c=await loadConfig();if(synced!==c.revision)synced=await syncConfig(c,controller.signal);const data=await call('/watch',undefined,controller.signal);if(typeof data.visible==='boolean'&&connection.visible!==data.visible){connection.visible=data.visible;report(data.visible?'桌宠已开启 · 已连接':'桌宠已关闭显示 · 连接脚本后台待命');}
 for(const event of (data.events||[]).slice(0,10)){if(!validEvent(event))continue;if(!connection.visible){await call('/ack',{ids:[event.id]});continue;}if(event.revision!==c.revision||event.charId!==c.activeCharId){await call('/ack',{ids:[event.id]});continue;}
 if(event.kind==='form'||event.kind==='wardrobe'){await call('/ack',{ids:[event.id]});await changeForm(event);return;}
 if(event.kind==='timer'&&(Date.now()-event.at>30000||document.visibilityState==='visible'&&document.activeElement?.matches('input,textarea,[contenteditable=true]')||env.current.activeApp==='call'||env.current.activeApp==='date')){await call('/ack',{ids:[event.id]});continue;}
 connection.busy=true;report('角色正在回复桌宠…');const lease=await call('/busy',{id:event.id,revision:c.revision,busy:true});if(lease.accepted===false){connection.busy=false;await call('/ack',{ids:[event.id]});continue;}
 try{const text=await generatePet(event,env.current,controller.signal);if(!stopped&&connection.token){const delivery=await call('/speech',{id:event.id,revision:event.revision,charId:event.charId,formId:event.formId,text});report(delivery.suppressed?'桌宠已关闭显示 · 旧回复未投递':'已连接 · 回复已送达');}}
 catch(e){if(!controller.signal.aborted){report('桌宠：'+(e instanceof Error?e.message:String(e)));await call('/error',{id:event.id,revision:event.revision,formId:event.formId,text:'本次未完成，请打开糯米机桌宠App查看原因。'}).catch(()=>{});}}
 finally{connection.busy=false;if(connection.token)await call('/ack',{ids:[event.id]}).catch(()=>{});await call('/busy',{revision:c.revision,busy:false}).catch(()=>{});}
 }
 }catch(e){if(!stopped&&!controller.signal.aborted){disconnect('连接中断，请在桌宠App点开启重连；若脚本已停止，到AutoJs6运行一次即可。');}}
 finally{if(!stopped&&!controller.signal.aborted)timer=setTimeout(pump,300);}};
 void pump();return()=>{stopped=true;clearTimeout(timer);controller.abort();window.removeEventListener(CHANGED,changed);};},[]);return null;}
