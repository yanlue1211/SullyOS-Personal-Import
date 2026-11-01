import {addReply,compact,generate,synthesize,summarize,deliver,type Environment} from './generate';
import {elapsed,nextInterval,type Session} from './model';
import {storage} from './storage';
import {handsFree} from './listen';
import {startStt,type SttSession} from '../../utils/speechToText';
/** App navigation does not destroy the player; there is only one voice and one scheduler. */
class MoonPlayer {
 session:Session|null=null; env:Environment|null=null; voice:HTMLAudioElement|null=null; music:HTMLAudioElement|null=null;
 notice=''; busy=false; listening=false; handsFree=false; editing=false; voiceVolume=.85; musicVolume=.35; duckVolume=.12;
 musicAfter:'stop'|'continue'='stop'; musicMode:'loop'|'sequence'='loop'; playlist:{id:string;name:string;audio:string}[]=[]; musicIndex=0;musicStopAt=0;private musicStopTimer:ReturnType<typeof setTimeout>|null=null;
 private listeners=new Set<()=>void>();private abort:AbortController|null=null;private stt:SttSession|null=null;private sttEpoch=0;private cancelAuto:(()=>void)|null=null;private speechActive=false;private listenTimer:ReturnType<typeof setTimeout>|null=null;
 private timer:ReturnType<typeof setInterval>|null=null;private nextAt=0;private frame=0;private saveAt=0;private revision=0;private voiceEpoch=0;private inputEpoch=0;private sending=false;private playbackPaused=true;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 snapshot=()=>this.revision;
 emit=()=>{this.revision++;this.listeners.forEach(fn=>fn());};
 async persist(){if(this.session)await storage.save(this.session);this.emit();}
 configure(env:Environment){this.env=env;}
 fail(error:unknown){this.notice=error instanceof Error?error.message:String(error);this.emit();}
 async select(s:Session){if(this.busy||this.sending||this.session?.runningSince)throw Error('请先暂停或结束当前月栖');this.stopListening();this.stopVoice();const loaded=await storage.get(s.id)||s;this.session={...loaded,runningSince:undefined,status:loaded.status==='active'?'paused':loaded.status};await this.persist();}
 async task(fn:(signal:AbortSignal)=>Promise<void>){if(this.busy)throw Error('正在处理上一轮');this.busy=true;this.notice='';this.stopListening();const controller=new AbortController();this.abort=controller;this.emit();try{await fn(controller.signal);}catch(e){if(!controller.signal.aborted)this.fail(e);}finally{if(this.abort===controller){this.abort=null;this.busy=false;this.nextAt=Date.now()+(this.session?nextInterval(this.session):300000);this.emit();}}}
 async prepare(){if(!this.session||!this.env)return;await this.task(async signal=>{
  let s=this.session!;const wasEnded=s.status==='ended';s={...s,status:'preparing'};this.session=s;await this.persist();
  if(s.mode==='story'){
   const parts=s.plannedParts||Math.max(1,Math.ceil(s.targetMinutes/5));
   if(!s.plan){s={...s,plannedParts:parts,plan:await generate(s,this.env!,`为一篇${s.kind}规划${parts}个连续段落的简短提纲，主题：${s.theme||'由你决定'}。整篇朗读目标${s.targetMinutes}分钟。仅输出提纲，不开始正文。故事最后一段必须收束；碎碎念区分真实经历与想象。`,signal)};this.session=s;await this.persist();}
   for(let part=s.turns.filter(t=>t.source==='story').length;part<parts;part++){
    const prompt=`根据这个完整提纲继续创作第${part+1}/${parts}部分：${s.plan}。类型${s.kind}；本段约${Math.round(s.targetMinutes/parts*210*s.speed)}汉字。仅输出可以朗读的正文，不输出标题、章节编号和解释。承接前文，不重复，${part===parts-1?'本段结束整篇内容，温柔收束。':'不要提前结束整篇内容。'}`;
    const text=await generate(s,this.env!,prompt,signal);signal.throwIfAborted();s=addReply(s,text,'story');this.session=s;await this.persist();
   }
  }else if(!s.turns.some(t=>t.role==='assistant')){s=addReply(s,await generate(s,this.env!,`开始睡前陪伴。${s.theme}。自然说一小段，不超过180字，不反复问睡了没有。`,signal),'automatic');this.session=s;await this.persist();}

  s=await synthesize(s,this.env!,signal,updated=>{this.session=updated;this.emit();});signal.throwIfAborted();this.session={...s,status:wasEnded?'ended':'ready'};await this.persist();
 });}
 async play(){const s=this.session;if(!s||!s.clips.length||this.busy)return;if(s.clips.some(c=>!c.audio))throw Error('请先合成全部语音');this.playbackPaused=false;
  if(s.status==='ended'){if(this.voice?.paused&&!this.voice.ended){await this.voice.play();this.duck(true);}else{this.session={...s,cursor:0,offset:0};this.playClip();}return;}
  this.session={...s,status:'active',runningSince:s.runningSince||Date.now()};this.nextAt=Date.now()+nextInterval(s);await this.persist();this.startClock();
  if(this.voice?.src&&this.voice.paused&&!this.voice.ended){await this.voice.play();this.duck(true);}else if(s.cursor<s.clips.length)this.playClip();else this.maybeListen();
  if(this.music?.paused)void this.music.play().catch(e=>this.fail(e));
 }
 private playClip(){const s=this.session;if(!s||s.cursor>=s.clips.length){this.voiceFinished();return;}this.stopListening();this.stopVoice();const epoch=this.voiceEpoch;const clip=s.clips[s.cursor];if(!clip.audio)return;
  const a=new Audio(clip.audio);this.voice=a;a.volume=this.voiceVolume;a.playbackRate=s.speed;a.currentTime=s.offset||0;this.duck(true);
  a.ontimeupdate=()=>{if(this.session&&this.voice===a){this.session.offset=a.currentTime;if(Date.now()-this.saveAt>3000){this.saveAt=Date.now();void this.persist().catch(e=>this.fail(e));}this.emit();}};
  a.onended=()=>{if(this.voice!==a||!this.session)return;const current=this.session;const cursor=current.cursor+1;this.session={...current,cursor,offset:0,turns:current.turns.map(t=>t.id===clip.turnId&&!current.clips.slice(cursor).some(c=>c.turnId===t.id)?{...t,played:true}:t)};void this.persist().then(()=>{if(epoch===this.voiceEpoch&&!this.playbackPaused)this.playClip();}).catch(e=>this.fail(e));};
  a.onerror=()=>{this.duck(false);this.pause();this.fail(Error('播放失败，文字和已合成音频已保留，可继续或重新合成'));};
  void a.play().catch(e=>{this.pause();this.fail(e);});this.emit();
 }
 private voiceFinished(){this.stopVoice();this.duck(false);const s=this.session;if(!s)return;if(s.status==='ended'){this.emit();return;}if(s.mode==='story'){void this.end();}else{this.nextAt=Date.now()+nextInterval(s);this.maybeListen();}this.emit();}
 private stopVoice(){this.voiceEpoch++;if(this.voice){this.voice.pause();this.voice.onended=null;this.voice.ontimeupdate=null;this.voice.onerror=null;this.voice.removeAttribute('src');this.voice.load();this.voice=null;}}
 pause(){if(!this.session)return;this.inputEpoch++;this.playbackPaused=true;const s=this.session;this.session={...s,elapsedMs:elapsed(s),runningSince:undefined,status:s.status==='ended'?'ended':'paused'};this.voice?.pause();this.music?.pause();this.stopListening();void this.persist().catch(e=>this.fail(e));}
 async end(){if(!this.session||!this.env)return;this.inputEpoch++;this.playbackPaused=true;this.abort?.abort();this.busy=false;this.abort=null;this.stopListening();this.stopVoice();if(this.timer){clearInterval(this.timer);this.timer=null;}
  const s=this.session;this.session={...s,status:'ended',endedAt:Date.now(),elapsedMs:elapsed(s),runningSince:undefined};if(this.musicAfter==='stop')this.fadeOutMusic();await this.persist();await this.summarize();}
 async summarize(){if(!this.session||!this.env)return;await this.task(async signal=>{let s:Session=await summarize(this.session!,this.env!,signal);signal.throwIfAborted();this.session=s;await this.persist();s=await deliver(s);this.session=s;await this.persist();});}
 async editSummary(text:string){if(!this.session)return;if(this.busy)throw Error('正在整理摘要，请稍等');if(!text.trim())throw Error('摘要不能为空');this.session={...this.session,summary:text};await this.persist();this.session=await deliver(this.session);this.emit();}
 async clearAudio(all=false){if(this.busy||this.session?.runningSince)throw Error('请先暂停当前月栖');this.stopVoice();const sessions=all?await storage.list():this.session?[this.session]:[];for(const s of sessions){const cleared=await storage.clearAudio(s);if(this.session?.id===s.id)this.session={...cleared,cursor:0,offset:0};}this.emit();}
 async retryReply(){if(this.session?.turns.at(-1)?.role==='user')await this.reply(false);}
 async send(text:string){
  if(!text.trim()||!this.session||!this.env)return;
  if(this.busy||this.sending)throw Error('正在准备回复，请稍等');
  if(this.voice&&!this.voice.paused)throw Error('等当前语音播放结束后再发送');
  if(this.session.status!=='active')throw Error('请先继续本场夜话');
  this.sending=true;const epoch=this.inputEpoch;this.stopListening();this.editing=false;
  try{this.session={...this.session,turns:[...this.session.turns,{id:crypto.randomUUID(),role:'user',text:text.trim(),source:'user',at:Date.now(),played:true}]};await this.persist();
   if(epoch!==this.inputEpoch||this.session.status!=='active')return;
   await this.reply(false);
  }finally{this.sending=false;this.emit();}
 }

 private async reply(automatic:boolean){const s=this.session;if(!s||!this.env||this.busy)return;if(automatic&&s.turns.at(-1)?.role==='user')return;const sessionId=s.id;
  let cancelled=false;await this.task(async signal=>{const compressed=await compact(this.session!,this.env!,signal);signal.throwIfAborted();this.session=compressed;await this.persist();signal.throwIfAborted();signal.addEventListener('abort',()=>{cancelled=true;},{once:true});const prompt=automatic?`定时陪伴。避免重复最近话题，不询问是否睡着。${s.gradual&&elapsed(s)>s.targetMinutes*30000?'只说很短的一两句。':''}${s.allowQuiet?'若没有必要开口，仅输出<quiet/>。':'本轮请自然说一小段。'}`:'回应用户刚刚的发言，口语简短自然。';
   const text=await generate(this.session!,this.env!,prompt,signal);signal.throwIfAborted();if(automatic&&text==='<quiet/>')return;
   let next=addReply(this.session!,text,'automatic');this.session=next;await this.persist();next=await synthesize(next,this.env!,signal,updated=>{this.session=updated;this.emit();});signal.throwIfAborted();this.session=next;await this.persist();
  });if(cancelled||this.session?.id!==sessionId||this.busy)return;if(this.session?.status==='active'&&this.session.cursor<this.session.clips.length&&this.session.clips[this.session.cursor].audio)this.playClip();else this.maybeListen();
 }
 private startClock(){if(this.timer)return;this.timer=setInterval(()=>{const s=this.session;if(!s||s.status!=='active')return;const progress=elapsed(s)/(s.targetMinutes*60000);if(progress>=1&&s.mode==='night'){void this.end().catch(e=>this.fail(e));return;}
  if(Date.now()>=this.nextAt&&!this.busy&&!this.sending&&!this.editing&&!this.speechActive&&!this.voice&&s.mode==='night'){
   this.nextAt=Date.now()+nextInterval(s);if(!(s.gradual&&progress>=.75))void this.reply(true).catch(e=>this.fail(e));
  }
  this.emit();},1000);}
 setEditing(value:boolean){this.editing=value;if(!value)this.maybeListen();this.nextAt=Date.now()+(this.session?nextInterval(this.session):300000);if(value)this.stopListening();this.emit();}
 async record(){if(this.listening){if(this.cancelAuto)this.setHandsFree(false);else this.stt?.stop();return;}if(this.voice||this.busy||this.session?.status!=='active')return;await this.listen(false);}
 private async listen(auto:boolean){if(this.listening||!this.env)return;const epoch=++this.sttEpoch;this.listening=true;this.speechActive=true;this.emit();try{const stt=await startStt('zh-CN',{
  onFinal:text=>{if(epoch!==this.sttEpoch)return;this.listening=false;this.stt=null;if(text.trim())void this.send(text).catch(e=>this.fail(e));else{this.nextAt=Date.now()+(this.session?nextInterval(this.session):300000);this.emit();}},
  onError:message=>{if(epoch!==this.sttEpoch)return;this.handsFree=false;this.fail(message);},
  onEnd:()=>{if(epoch!==this.sttEpoch)return;this.listening=false;this.speechActive=false;this.stt=null;this.emit();},
 },this.env.api);if(epoch!==this.sttEpoch)stt.stop();else this.stt=stt;}catch(e){this.listening=false;this.handsFree=false;this.fail(e);}}
 stopListening(){this.sttEpoch++;if(this.listenTimer)clearTimeout(this.listenTimer);this.listenTimer=null;this.cancelAuto?.();this.cancelAuto=null;this.stt?.stop();this.stt=null;this.listening=false;this.speechActive=false;}
 setHandsFree(enabled:boolean){this.handsFree=enabled;this.stopListening();this.maybeListen();this.emit();}
 private maybeListen(){
  if(!this.handsFree||this.busy||this.voice||this.editing||this.listening||this.session?.status!=='active'||!this.env)return;
  if(this.listenTimer)clearTimeout(this.listenTimer);
  this.listenTimer=setTimeout(()=>{this.listenTimer=null;void this.autoListen();},800);this.emit();
 }
 private async autoListen(){
  if(!this.handsFree||this.busy||this.voice||this.editing||this.listening||this.session?.status!=='active'||!this.env)return;
  const epoch=++this.sttEpoch;this.listening=true;this.emit();
  try{const cancel=await handsFree(this.env.api,{
   speech:active=>{if(epoch===this.sttEpoch)this.speechActive=active;},
   text:text=>{if(epoch!==this.sttEpoch)return;this.listening=false;this.speechActive=false;this.stopListening();void this.send(text).catch(e=>this.fail(e));},
   error:error=>{if(epoch!==this.sttEpoch)return;this.handsFree=false;this.stopListening();this.fail(error);},
   end:()=>{if(epoch!==this.sttEpoch)return;this.listening=false;this.speechActive=false;this.cancelAuto=null;this.maybeListen();this.emit();},
  });if(epoch!==this.sttEpoch)cancel();else this.cancelAuto=cancel;}catch(e){if(epoch===this.sttEpoch){this.handsFree=false;this.stopListening();this.fail(e);}}
 }

 private duck(speaking:boolean){if(!this.music)return;cancelAnimationFrame(this.frame);const a=this.music,from=a.volume,to=speaking?this.duckVolume:this.musicVolume,start=performance.now();const tick=(now:number)=>{const p=Math.min(1,(now-start)/650);a.volume=Math.max(0,Math.min(1,from+(to-from)*p));if(p<1)this.frame=requestAnimationFrame(tick);};this.frame=requestAnimationFrame(tick);}
 private fadeOutMusic(){if(!this.music)return;cancelAnimationFrame(this.frame);const a=this.music,from=a.volume,start=performance.now();const tick=(now:number)=>{const p=Math.min(1,(now-start)/1800);a.volume=from*(1-p);if(p<1)this.frame=requestAnimationFrame(tick);else a.pause();};this.frame=requestAnimationFrame(tick);}
 async loadMusic(){const prefs=await (await import('../../utils/db')).DB.getAssetRaw('yueqi:preferences');if(prefs){this.voiceVolume=prefs.voiceVolume??.85;this.musicVolume=prefs.musicVolume??.35;this.duckVolume=prefs.duckVolume??.12;this.musicMode=prefs.musicMode==='sequence'?'sequence':'loop';this.musicAfter=prefs.musicAfter==='continue'?'continue':'stop';}this.playlist=await (await import('../../utils/db')).DB.getAssetRaw('yueqi:playlist')||[];this.musicIndex=Math.max(0,this.playlist.findIndex(track=>track.id===prefs?.musicId));this.emit();}
 async musicPlay(index=this.musicIndex){if(!this.playlist.length)return;this.music?.pause();this.musicIndex=index%this.playlist.length;const a=new Audio(this.playlist[this.musicIndex].audio);this.music=a;a.volume=this.musicVolume;a.loop=this.musicMode==='loop';a.onended=()=>{void this.musicPlay(this.musicIndex+1).catch(e=>this.fail(e));};a.onerror=()=>this.fail('背景音乐播放失败，后台陪伴可能暂停');await a.play();this.setVolumes();}
 setMusicStop(minutes:number){if(this.musicStopTimer)clearTimeout(this.musicStopTimer);this.musicStopAt=minutes>0?Date.now()+minutes*60000:0;if(minutes>0)this.musicStopTimer=setTimeout(()=>{this.musicStopAt=0;this.fadeOutMusic();this.emit();},minutes*60000);this.emit();}
 setVolumes(){void import('../../utils/db').then(({DB})=>DB.saveAssetRaw('yueqi:preferences',{voiceVolume:this.voiceVolume,musicVolume:this.musicVolume,duckVolume:this.duckVolume,musicId:this.playlist[this.musicIndex]?.id,musicMode:this.musicMode,musicAfter:this.musicAfter})).catch(e=>this.fail(e));if(this.voice)this.voice.volume=this.voiceVolume;this.duck(!!this.voice&&!this.voice.paused);this.emit();}
}
export const moon=new MoonPlayer();
