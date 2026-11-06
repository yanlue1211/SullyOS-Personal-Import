import React,{useState} from 'react';
import {MoonStars} from '@phosphor-icons/react';
import {useOS} from '../../context/OSContext';
import {AppID,type Message} from '../../types';
import {yueqiLaunch} from '../../features/yueqi/launch';
export default function YueqiCard({message,disabled=false}:{message:Message;disabled?:boolean}){
 const os=useOS(),[expanded,setExpanded]=useState(false);
 return <article style={{width:280,maxWidth:'100%',padding:20,borderRadius:23,background:'linear-gradient(145deg,#20352e,#203040)',border:'1px solid #b8d6ad66',color:'#edf3e8',textAlign:'left'}}>
  <MoonStars size={28} color="#cfdfb9"/><p style={{fontSize:15,margin:'10px 0'}}>月栖 · 夜间记录</p><p style={{fontSize:12,lineHeight:1.9,whiteSpace:'pre-wrap',maxHeight:expanded?undefined:110,overflow:'hidden'}}>{message.content}</p><button disabled={disabled} onClick={()=>setExpanded(!expanded)} style={{fontSize:12,padding:8}}>{expanded?'收起摘要':'查看完整摘要'}</button><button disabled={disabled} style={{fontSize:12,padding:8}} onClick={()=>{yueqiLaunch.request(message.metadata.yueqiSessionId);os.openApp(AppID.Yueqi);}}>查看记录 / 修改 / 重新总结 ↗</button>
 </article>;
}
