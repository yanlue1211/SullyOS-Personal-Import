import React from 'react';
import {createRoot} from 'react-dom/client';
import {OSPreviewProvider} from '../../context/OSContext';
import YueqiApp from '../../apps/YueqiApp';
import {DB} from '../../utils/db';
import {storage,blobData} from '../../features/yueqi/storage';
import {encodeWavFromFloat32} from '../../utils/speechToText';
import {newSession} from '../../features/yueqi/model';
import {addReply} from '../../features/yueqi/generate';
import {moon} from '../../features/yueqi/runtime';
const avatar='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#b8cdb1"/><circle cx="80" cy="66" r="31" fill="#eee5cf"/><path d="M28 160c0-78 104-78 104 0" fill="#657e72"/><path d="M48 62q-4-45 33-37 33-4 31 37L94 44 72 50 60 42Z" fill="#34443c"/></svg>');
const chars=[{id:'yueqi-qa-a',name:'阿源',avatar,memories:[],activeMemoryMonths:[],refinedMemories:{},contextLimit:100,systemPrompt:'你是温柔的阿源。',voiceProfile:{voiceId:'qa-only'}}];
for(const char of chars)await DB.saveCharacter(char as any);
if(!(await storage.list()).length){let s=addReply(newSession(chars[0].id,'story',{title:'海边的小羊与灯塔',status:'ended',elapsedMs:20*60000}),'那晚，一只小羊在海边找到了一座灯塔。它终于明白，总有一盏灯，会为晚归的人亮着。','story');s.summary='虚构故事：小羊寻找灯塔。用户没有发言，不推断用户是否睡着。';await storage.save(s);}
moon.session=null;
createRoot(document.getElementById('root')!).render(<OSPreviewProvider value={{characters:chars,apiConfig:{baseUrl:'https://qa-yueqi.invalid/v1',apiKey:'TEST-ONLY',model:'qa-only'},userProfile:{name:'你'},groups:[],realtimeConfig:{},closeApp:()=>{}} as any}><YueqiApp/></OSPreviewProvider>);

// Only this isolated QA fixture exposes controls; the production App has no test hook.
(window as any).__yueqiQA={moon,storage,async seedAudio(){
 const samples=new Float32Array(16000*2);for(let i=0;i<samples.length;i++)samples[i]=Math.sin(i*2*Math.PI*220/16000)*.025;
 const audio=await blobData(encodeWavFromFloat32(samples,16000,16000));
 let session=addReply(newSession(chars[0].id,'story',{title:'真实播放器验收',status:'ready',targetMinutes:1}),'第一段。','story');
 session=addReply(session,'第二段。','story');session.clips=session.clips.map(c=>({...c,audio,seconds:2}));
 await storage.save(session);await moon.select(session);moon.playlist=[{id:'qa-music',name:'测试背景音',audio}];moon.musicMode='loop';moon.musicAfter='stop';await DB.saveAssetRaw('yueqi:playlist',moon.playlist);return session.id;
 }};
