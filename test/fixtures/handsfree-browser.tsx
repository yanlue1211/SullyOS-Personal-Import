import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../components/chat/chatRuntime.generated.css';
import HandsFreeCallControl from '../../features/personal/calls/HandsFreeCallControl';
const ctx=new AudioContext(),source=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=0;source.connect(gain);source.start();
const q={sent:0,level:async(value:number)=>{await ctx.resume();gain.gain.value=value;}};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{const stream=ctx.createMediaStreamDestination();gain.connect(stream);return stream.stream;}}});
(window as any).__hfQA=q;
function Preview(){
 const [enabled,setEnabled]=useState(false),[ready,setReady]=useState(true),[sent,setSent]=useState(0);
 return <main style={{padding:'24px 12px'}}><h1 style={{fontSize:18,marginBottom:24}}>语音通话 · 免手持</h1><section className="flex items-start justify-between gap-2"><select aria-label="通话识别方式" style={{maxWidth:'42%',borderRadius:20,padding:'8px 6px',fontSize:11,color:'white',background:'#263c4c'}}><option>音频 API · 原话与语气</option></select><HandsFreeCallControl enabled={enabled} onEnabledChange={setEnabled} ready={ready} waitReason={ready?'':'等待对方回应'} sessionId="qa" inputMode="real" apiConfig={{}} onStart={()=>{void ctx.resume();}} onUtterance={async value=>{if(!value.audio?.size)throw Error('No captured audio');q.sent++;setSent(q.sent);setReady(false);setTimeout(()=>setReady(true),800);}}/></section><p style={{fontSize:12,marginTop:32}}>已发送：{sent}</p></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
