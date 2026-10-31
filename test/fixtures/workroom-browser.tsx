import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OSPreviewProvider} from '../../context/OSContext';
import ErrorDialog from '../../components/os/ErrorDialog';
import WorkroomApp from '../../apps/WorkroomApp';
import {DB} from '../../utils/db';
import {WorkroomStorage as W} from '../../features/workroom/storage';
import {buildWorkroomDocument,WORKROOM_SANDBOX} from '../../features/workroom/runner';
import {createWorkroomHost} from '../../features/workroom/host';
import {smokeTestWorkroom} from '../../features/workroom/smokeTest';
import {proposeIdea,shareWork,acceptShare} from '../../features/workroom/collaboration';
import {drainWorkroomOutbox} from '../../features/workroom/delivery';
import {exportPortableWork,importPortableWork} from '../../features/workroom/portable';
import {listWorkroomNotices,dismissWorkroomNotice} from '../../features/workroom/notices';
import {formatMessageForPrompt} from '../../utils/messageFormat';
import {ChatPrompts} from '../../utils/chatPrompts';
import JSZip from 'jszip';
import {writeV2Backup,assembleV2Backup} from '../../utils/backupFormat';
const code={html:'<button id="feed">喂小狗</button><p id="level">读取中</p><button id="question">生成新题目</button><p id="puzzle"></p>',css:'button{font-size:20px;padding:12px}',js:`(async()=>{let s=await window.workroom.loadState();document.querySelector('#level').textContent='等级 '+(s.level||1);document.querySelector('#puzzle').textContent=s.puzzle?.question||'';document.querySelector('#question').onclick=async()=>{try{const puzzle=await window.workroom.generate({instruction:'为本轮游戏生成全新题目和隐藏答案，返回question和solution字段',format:'json',publicEvent:'开始了一道新题目'});s.puzzle=puzzle;await window.workroom.saveState(s);document.querySelector('#puzzle').textContent=puzzle.question;}catch{};};document.querySelector('#feed').onclick=async()=>{s.level=(s.level||1)+1;await window.workroom.saveState(s);await window.workroom.emitEvent('小狗升到'+s.level+'级','level-'+s.level);document.querySelector('#level').textContent='等级 '+s.level;};})();`};
const a='qa-creator-'+crypto.randomUUID(),b='qa-recipient-'+crypto.randomUUID();
const chars=[{id:a,name:'测试 Claude',workroomLinkEnabled:true,contextLimit:100},{id:b,name:'测试阿源',workroomLinkEnabled:true,contextLimit:100}];
let workId='';
function check(value:unknown,message:string){if(!value)throw Error(message);}
async function seed(){for(const char of chars)await DB.saveCharacter(char as any);const work=await proposeIdea(a,'浏览器小狗屋','喂食和保存进度，支持与角色一起体验不同场景。这里是一段很长的作品简介，用于验证手机窄屏可以点击三角展开，简介末尾也能读到。','browser-idea');workId=work.id;await W.saveDraft(a,work.id,code,0,null);await W.publish(a,work.id,1);await drainWorkroomOutbox(a);return work;}
async function verifyBoundaries(){
 await new Promise<void>((resolve,reject)=>{
  const frame=document.createElement('iframe'),session=crypto.randomUUID();let timer:ReturnType<typeof setTimeout>;
  const finish=(error?:unknown)=>{clearTimeout(timer);host.close();frame.remove();error?reject(error):resolve();};
  const host=createWorkroomHost('qa','qa','qa',session,{onError:finish,onNotify:text=>text==='BOUNDARIES_PASS'?finish():finish(Error('未知边界结果'))},true);
  frame.setAttribute('sandbox',WORKROOM_SANDBOX);frame.style.cssText='position:fixed;left:-10000px;width:360px;height:640px';
  frame.onload=()=>{const channel=new MessageChannel();host.bind(channel.port1);frame.contentWindow!.postMessage({workroomSession:session},'*',[channel.port2]);};
  frame.srcdoc=buildWorkroomDocument({html:'',css:'',js:`(async()=>{let denied=0;try{parent.document.body;}catch{denied++;}try{localStorage.getItem('qa-parent-secret');}catch{denied++;}try{await fetch('http://127.0.0.1:4179/qa-network-canary');}catch{denied++;}if(denied!==3)throw Error('沙盒边界不符合预期:'+denied);await window.workroom.notify('BOUNDARIES_PASS');})();`},session);
  timer=setTimeout(()=>finish(Error('沙盒边界验证超时')),5000);document.body.append(frame);
 });
}
function Harness(){const [failure,setFailure]=useState<{title:string;details:string}|null>(null);const [ready,setReady]=useState(false),[result,setResult]=useState('尚未验证'),[characters,setCharacters]=useState(chars);const [nonce,setNonce]=useState(0);
 const action=async(fn:()=>Promise<void>)=>{try{await fn();}catch(error){setResult('FAIL: '+String(error));}};
 return <><section id="qa" style={{padding:12,background:'#eef2ff'}}><button disabled={ready} onClick={()=>void action(async()=>{await seed();setReady(true);setResult('测试数据已准备');})}>准备隔离测试数据</button>
 <button disabled={!ready} onClick={()=>void action(async()=>{const report=await smokeTestWorkroom(code,new AbortController().signal);check(!report.errors.length,JSON.stringify(report));setResult('PASS: 真实浏览器启动观察');})}>验证启动观察</button>
 <button disabled={!ready} onClick={()=>void action(async()=>{const before=await W.get(a,workId),v=before.versions.find(v=>v.id===before.work.currentVersionId)!;const state=await W.loadState(a,workId,v.id);check((state.data as any).level===2,'进度未保存为2级');const share=await shareWork(a,workId,b);check((await W.list(b)).length===0,'分享不应自动收藏');const copy=await acceptShare(b,share.id);check(JSON.stringify((await W.loadState(b,copy.id,copy.currentVersionId!)).data)==='{}','副本泄露进度');const portable=await exportPortableWork(a,workId);await importPortableWork(b,JSON.stringify(portable));
 const messages=[...await DB.getMessagesByCharId(a,true),...await DB.getMessagesByCharId(b,true)];const history=JSON.stringify(ChatPrompts.buildMessageHistory(messages,100,chars[0] as any,{} as any,[]).apiMessages);const memory=messages.map(m=>formatMessageForPrompt(m,'测试角色','User')).join('\n');for(const kind of ['灵感邀请','作品完成','互动进度','作品分享','作品收藏'])check(memory.includes(kind)||history.includes(kind),'缺少卡片语义：'+kind);
 const notices=await listWorkroomNotices();const notice=notices.find(n=>n.workId===workId);check(notice,'没有完成通知');await dismissWorkroomNotice(notice!.id);
 const full=await DB.exportFullData(),zip=new JSZip();await writeV2Backup(zip as any,full);const reader=await JSZip.loadAsync(await zip.generateAsync({type:'uint8array'}));const data=await assembleV2Backup(reader as any,JSON.parse(await reader.file('manifest.json')!.async('string')));await DB.importFullData(data as any);await drainWorkroomOutbox(a);check((await W.loadState(a,workId,v.id)).data&&JSON.stringify((await W.loadState(a,workId,v.id)).data)===JSON.stringify(state.data),'恢复进度不一致');check((await DB.getMessagesByCharId(a,true)).length+(await DB.getMessagesByCharId(b,true)).length===messages.length,'恢复后消息重复');check(!(await listWorkroomNotices()).some(n=>n.id===notice!.id),'恢复后通知重复');setResult('PASS: 进度、独立分享、五类卡片语义、组件文件、真实ZIP恢复');})}>验证分享与备份整链</button>
 <button disabled={!ready} onClick={()=>void action(async()=>{await verifyBoundaries();setResult('PASS: 父页面隔离、存储隔离与CSP网络限制');})}>验证沙盒边界</button>
 <button disabled={!ready} onClick={()=>setNonce(n=>n+1)}>重开造物间</button><pre id="result">{result}</pre></section><div style={{height:720,width:390,maxWidth:'100%',border:'1px solid #ddd'}}>{ready&&<OSPreviewProvider value={{characters,showError:(title:string,details:string)=>setFailure({title,details}),apiConfig:{baseUrl:'https://qa-runtime.invalid/v1',apiKey:'SYNTHETIC-TEST-KEY',model:'test-model'},userProfile:{name:'User'},groups:[],realtimeConfig:{},closeApp:()=>{},updateCharacter:async(id:string,patch:any)=>{const c={...await DB.getCharacter(id),...patch};await DB.saveCharacter(c as any);setCharacters(old=>old.map(row=>row.id===id?c:row) as any);}} as any}><WorkroomApp key={nonce}/></OSPreviewProvider>}</div><ErrorDialog isOpen={!!failure} title={failure?.title||''} details={failure?.details||''} onClose={()=>setFailure(null)}/></>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
