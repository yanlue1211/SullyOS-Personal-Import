import {petControlAbort,petTransportFailure} from './transport';
import React,{useEffect,useRef} from 'react';
import {useOS} from '../../context/OSContext';
import {CHANGED,loadConfig} from './model';
import {call,connection,disconnect,report,syncConfig,validEvent,changeForm,recoverSession,STATE} from './bridge';
import {generatePet} from './generate';
export default function Runtime(){const os=useOS(),env=useRef(os);env.current=os;
 useEffect(()=>{let stopped=false,synced='',failures=0,retryMs=300,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();connection.controller=controller;
 const changed=()=>{synced='';controller.abort(petControlAbort());};
 // A settings change restarts the gate's runtime; old generation is aborted immediately.
 window.addEventListener(CHANGED,changed);
 const pump=async()=>{if(stopped||!connection.token)return;try{const c=await loadConfig();if(synced!==c.revision)synced=await syncConfig(c,controller.signal);const data=await call('/watch',undefined,controller.signal);if(failures){failures=0;report('已连接 · 桌宠通信已恢复');}retryMs=300;if(typeof data.visible==='boolean'&&connection.visible!==data.visible){connection.visible=data.visible;report(data.visible?'桌宠已开启 · 已连接':'桌宠已关闭显示 · 连接脚本后台待命');}
 for(const event of (data.events||[]).slice(0,10)){if(!validEvent(event))continue;if(!connection.visible){await call('/ack',{ids:[event.id]});continue;}if(event.revision!==c.revision||event.charId!==c.activeCharId){await call('/ack',{ids:[event.id]});continue;}
 if(event.kind==='form'||event.kind==='wardrobe'){await call('/ack',{ids:[event.id]});await changeForm(event);return;}
 if(event.kind==='timer'&&(Date.now()-event.at>30000||document.visibilityState==='visible'&&document.activeElement?.matches('input,textarea,[contenteditable=true]')||env.current.activeApp==='call'||env.current.activeApp==='date')){await call('/ack',{ids:[event.id]});continue;}
 connection.busy=true;report('角色正在回复桌宠…');const lease=await call('/busy',{id:event.id,revision:c.revision,busy:true});if(lease.accepted===false){connection.busy=false;await call('/ack',{ids:[event.id]});continue;}
 try{const text=await generatePet(event,env.current,controller.signal);if(!stopped&&connection.token){const delivery=await call('/speech',{id:event.id,revision:event.revision,charId:event.charId,formId:event.formId,text});report(delivery.suppressed?'桌宠已关闭显示 · 旧回复未投递':'已连接 · 回复已送达');}}
 catch(e){if(!controller.signal.aborted){report('桌宠：'+(e instanceof Error?e.message:String(e)));await call('/error',{id:event.id,revision:event.revision,formId:event.formId,text:'本次未完成，请打开糯米机桌宠App查看原因。'}).catch(()=>{});}}
 finally{connection.busy=false;if(connection.token)await call('/ack',{ids:[event.id]}).catch(()=>{});await call('/busy',{revision:c.revision,busy:false}).catch(()=>{});}
 }
 }catch(e){if(!stopped&&!controller.signal.aborted){
 if(petTransportFailure(e)){failures++;retryMs=Math.min(30000,1000*2**Math.min(failures-1,5));report('桌宠通信暂时中断 · 正在自动重连，请保持糯米机运行');
  try{if(await recoverSession(controller.signal))synced='';}catch(recovery){if(!stopped&&!controller.signal.aborted&&connection.token&&!petTransportFailure(recovery))report(recovery instanceof Error?recovery.message:'桌宠恢复连接失败');}
 }else disconnect('桌宠连接失败：'+(e instanceof Error?e.message:String(e)));
 }}
 finally{if(!stopped&&!controller.signal.aborted)timer=setTimeout(pump,retryMs);}};
 void pump();return()=>{stopped=true;clearTimeout(timer);controller.abort(petControlAbort());window.removeEventListener(CHANGED,changed);};},[]);return null;}
