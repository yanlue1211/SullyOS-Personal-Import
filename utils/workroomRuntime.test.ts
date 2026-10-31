import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {DB,openDB} from './db';
import {WORKROOM_STORES,transactionDone} from '../features/workroom/schema';
import {WorkroomStorage as W} from '../features/workroom/storage';
import {generateRuntimeTurn,readRuntimeRequest} from '../features/workroom/runtime';
import {parseWorkroomReply} from '../features/workroom/reply';
import {validateWorkroomBackup} from '../features/workroom/backup';
import {formatMessageForPrompt} from './messageFormat';
let workId:string,versionId:string;
const globalApi={baseUrl:'https://global.invalid/v1',apiKey:'global-key',model:'global'} as any;
beforeEach(async()=>{localStorage.clear();const db=await openDB(),tx=db.transaction(['characters','messages',...WORKROOM_STORES],'readwrite'),done=transactionDone(tx);for(const n of ['characters','messages',...WORKROOM_STORES])tx.objectStore(n).clear();await done;
 await DB.saveCharacter({id:'a',name:'阿源',systemPrompt:'人设标记',worldview:'世界观标记',contextRangePolicyVersion:1,contextRangeMode:'manual',contextLimit:100,workroomLinkEnabled:true,dialogueApi:{baseUrl:'https://char.invalid/v1',apiKey:'private-key',model:'char-model'},mountedWorldbooks:[{id:'book',title:'世界书',content:'世界书标记',constant:true,position:1}]} as any);
 await DB.saveMessage({charId:'a',role:'user',type:'text',content:'共同经历标记'});await DB.saveCharacter({id:'b',name:'其他角色'} as any);await DB.saveMessage({charId:'b',role:'user',type:'text',content:'另一角色隐私'});
 workId=(await W.create('a','故事推理游戏','每次生成新题目')).id;await W.saveDraft('a',workId,{html:'',css:'',js:'// SOURCE_NOT_FOR_RUNTIME'},0,null);versionId=(await W.publish('a',workId,1)).id;await W.setRuntimeAi('a',workId,true);await W.saveState('a',workId,versionId,1,{chapter:3,hiddenSolution:'秘密汤底'});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const args=(request:unknown)=>({charId:'a',workId,versionId,request,requestId:crypto.randomUUID(),api:globalApi,user:{name:'User'} as any,signal:new AbortController().signal});
function model(text:string){const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body),headers:init.headers});return new Response(JSON.stringify({choices:[{message:{content:text}}]}),{status:200});}));return calls;}
it('作品可按任意任务动态生成新题目，使用正常角色上下文且不泄露源码或隐藏材料到聊天',async()=>{
 const calls=model('{"question":"一张全新的题面","solution":"新的隐藏答案"}');const data=await generateRuntimeTurn(args({instruction:'随机生成一道新海龟汤，返回question和solution',context:{theme:'旅行'},format:'json'}));
 expect(data).toEqual({question:'一张全新的题面',solution:'新的隐藏答案'});expect(calls).toHaveLength(1);expect(calls[0].url).toBe('https://char.invalid/v1/chat/completions');
 const prompt=JSON.stringify(calls[0].body.messages);for(const s of ['人设标记','世界观标记','世界书标记','共同经历标记','chapter','秘密汤底','旅行'])expect(prompt).toContain(s);
 expect(prompt).not.toContain('SOURCE_NOT_FOR_RUNTIME');expect(prompt).not.toContain('另一角色隐私');expect(JSON.stringify(data)).not.toContain('private-key');expect(await W.playTurns('a',workId)).toEqual([]);expect(JSON.stringify(await DB.getMessagesByCharId('a',true))).not.toContain('新的隐藏答案');
});
it('公开逐轮对话保存为独立游戏交流，进入聊天与记忆可读文本并随备份恢复',async()=>{
 model('是的，但这不是全部原因。');await generateRuntimeTurn(args({instruction:'作为海龟汤主持人回答本轮问题',context:{question:'他认识这个人吗？'},format:'text',publicEvent:'我问：他认识这个人吗？',shareReply:true}));
 const turns=await W.playTurns('a',workId);expect(turns.map(t=>t.role)).toEqual(['user','assistant']);expect(await W.turns('a',workId)).toEqual([]);
 const messages=await DB.getMessagesByCharId('a',true);const text=messages.map(m=>formatMessageForPrompt(m,'阿源','User')).join('\n');expect(text).toContain('游戏互动');expect(text).toContain('是的，但这不是全部原因。');
 const backup=await DB.exportFullData();expect(validateWorkroomBackup(backup as any)?.workroomTurns.every(t=>t.kind==='play')).toBe(true);await DB.importFullData(backup as any);expect((await W.playTurns('a',workId)).map(t=>t.text)).toEqual(turns.map(t=>t.text));
});
it('未授权、跨角色和无效任务不调用API；格式失败不覆盖进度',async()=>{
 const calls=model('["坏格式" invalid]');await W.setRuntimeAi('a',workId,false);await expect(generateRuntimeTurn(args({instruction:'生成',format:'json'}))).rejects.toThrow('开启');expect(calls).toHaveLength(0);
 await W.setRuntimeAi('a',workId,true);await expect(generateRuntimeTurn({...args({instruction:'生成',format:'json'}),charId:'b'})).rejects.toThrow();expect(calls).toHaveLength(0);
 await expect(generateRuntimeTurn(args({instruction:'生成',format:'json'}))).rejects.toThrow('格式不完整');expect((await W.loadState('a',workId,versionId)).data).toEqual({chapter:3,hiddenSolution:'秘密汤底'});
 expect(()=>readRuntimeRequest({instruction:'x',context:{x:()=>1}})).toThrow();
});
it('分段创作协议保留引号、换行和代码，不再要求JSON转义；截断回复不覆盖草稿',()=>{
 const js='const choices = ["是", "不是"];\ndocument.body.textContent = "新题目";';
 expect(parseWorkroomReply(`<workroom-text>做好了</workroom-text><workroom-html><button title="开始">玩</button></workroom-html><workroom-css></workroom-css><workroom-js>${js}</workroom-js>`).code?.js).toBe(js);
 expect(parseWorkroomReply('我们先聊聊想做什么吧。')).toEqual({text:'我们先聊聊想做什么吧。'});
 expect(parseWorkroomReply('好的。<workroom-text>继续讨论</workroom-text>')).toEqual({text:'继续讨论'});
 expect(()=>parseWorkroomReply('["bad" x]')).toThrow('JSON转义错误');expect(()=>parseWorkroomReply('<workroom-text>好</workroom-text><workroom-js>const')).toThrow('不完整');
});
it('联动关闭时公开运行互动只保存在作品内，恢复后仍可读且不重新投递',async()=>{
 model('我注意到新的线索了。');await DB.saveCharacter({...await DB.getCharacter('a'),workroomLinkEnabled:false} as any);
 await generateRuntimeTurn(args({instruction:'参与推理',format:'text',publicEvent:'发现了新的线索',shareReply:true}));
 expect((await W.playTurns('a',workId)).every(t=>t.delivery==='local')).toBe(true);
 expect(JSON.stringify(await DB.getMessagesByCharId('a',true))).not.toContain('发现了新的线索');
 const backup=await DB.exportFullData();await DB.importFullData(backup as any);expect((await W.playTurns('a',workId))).toHaveLength(2);
});
