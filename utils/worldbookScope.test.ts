import {describe,it,expect} from 'vitest';
import JSZip from 'jszip';
import {DB} from './db';
import {newGlobalWorldbook,reconcileWorldbookMounts,worldbookScope} from './worldbookScope';
import {toMountedWorldbook} from './worldbook';
import {ContextBuilder} from './context';
import {buildChatRequestPayload} from './chatRequestPayload';
import {toAnthropicRequest} from './anthropicApi';
import {writeV2Backup,assembleV2Backup} from './backupFormat';
import type {Worldbook,CharacterProfile} from '../types';
const book=(id:string,extra:Partial<Worldbook>={}):Worldbook=>({id,title:id,content:`shared ${id}`,category:'背景',createdAt:1,updatedAt:1,constant:true,position:1,...extra});
const char=(id:string,books:Worldbook[]=[]):CharacterProfile=>({id,name:id,avatar:'',description:'',systemPrompt:`identity ${id}`,memories:[],timeAwarenessEnabled:false,mountedWorldbooks:books.map(toMountedWorldbook)});
describe('global / personal worldbooks',()=>{
 it('leaves legacy books and bindings byte-for-byte unchanged; new imports are global but off',()=>{
  const a=book('legacy'),c=char('old',[a]);expect(worldbookScope(a)).toBe('personal');expect(reconcileWorldbookMounts(c,[a])).toBe(c);
  expect(newGlobalWorldbook(a)).toMatchObject({scope:'global',globalEnabled:false,content:a.content});
 });
 it('inherits on enable, respects per-character opt-out, restores manual mounts on off and preserves recipients on moving',async()=>{
  const a=newGlobalWorldbook(book('scope-tx'));await DB.saveWorldbook(a);await DB.saveCharacter(char('scope-manual',[a]));await DB.saveCharacter(char('scope-auto'));
  await DB.mutateWorldbooks([a.id],{globalEnabled:true});
  expect((await DB.getCharacter('scope-auto'))?.mountedWorldbooks).toEqual([expect.objectContaining({id:a.id,globalMount:true,personalMount:false})]);
  let c=(await DB.getCharacter('scope-manual'))!;await DB.saveCharacter({...c,disabledGlobalWorldbookIds:[a.id]});
  expect((await DB.getCharacter(c.id))?.mountedWorldbooks?.[0].disable).toBe(true);
  c=(await DB.getCharacter(c.id))!;await DB.saveCharacter({...c,disabledGlobalWorldbookIds:[]});expect((await DB.getCharacter(c.id))?.mountedWorldbooks?.[0].disable).toBeFalsy();
  await DB.mutateWorldbooks([a.id],{globalEnabled:false});expect((await DB.getCharacter('scope-auto'))?.mountedWorldbooks).toEqual([]);expect((await DB.getCharacter('scope-manual'))?.mountedWorldbooks?.map(w=>w.id)).toEqual([a.id]);
  await DB.mutateWorldbooks([a.id],{globalEnabled:true});await DB.mutateWorldbooks([a.id],{scope:'personal',globalEnabled:false});
  expect((await DB.getCharacter('scope-auto'))?.mountedWorldbooks?.[0]).toEqual(toMountedWorldbook({...a,scope:'personal'}));
 });
 it('keeps global snapshots from standalone character cards when the receiving library is missing them',()=>{
  const c=char('card');c.mountedWorldbooks=[{...toMountedWorldbook(book('card-only')),globalMount:true,personalMount:false}];
  expect(reconcileWorldbookMounts(c,[]).mountedWorldbooks).toEqual([toMountedWorldbook(book('card-only'))]);
 });
 it('new characters inherit; global and manual copies deduplicate; disabled entries do not become active',async()=>{
  const a=book('scope-new',{scope:'global',globalEnabled:true,disable:true});await DB.saveWorldbook(a);await DB.saveCharacter(char('scope-new-char',[a]));
  const c=(await DB.getCharacter('scope-new-char'))!;expect(c.mountedWorldbooks?.filter(w=>w.id===a.id)).toHaveLength(1);expect(c.mountedWorldbooks?.find(w=>w.id===a.id)?.disable).toBe(true);
  await DB.mutateWorldbooks([a.id],null);expect((await DB.getCharacter(c.id))?.mountedWorldbooks?.some(w=>w.id===a.id)).toBe(false);
 });
 it('keeps globals in authored slots and preserves armor, conditional and depth semantics',async()=>{
  const armor=book('armor',{category:'破甲',order:100,position:0}),global=book('common',{order:1}),personal=book('private',{position:0,order:0}),trigger=book('trigger',{constant:false,key:['月亮'],position:1}),depth=book('depth',{position:4,depth:0});
  const lib=[armor,global,trigger,depth].map(b=>({...b,scope:'global' as const,globalEnabled:true}));const c=reconcileWorldbookMounts(char('context',[personal]),[personal,...lib]);
  const result=await ContextBuilder.buildCharacterContext({char:c,user:{name:'User'} as any,history:[{role:'user',content:'月亮'}],layout:{deferVolatile:true}});
  expect(result.sharedWorldbookPrefix).toBe('');
  expect(result.coreContext.indexOf('shared armor')).toBeLessThan(result.coreContext.indexOf('identity context'));
  expect(result.coreContext.indexOf('identity context')).toBeLessThan(result.coreContext.indexOf('shared common'));expect(result.coreContext.indexOf('shared private')).toBeLessThan(result.coreContext.indexOf('identity context'));
  expect(result.sharedWorldbookPrefix).not.toContain('shared trigger');expect(result.coreContext).toContain('shared trigger');expect(result.history.at(-1)?.content).toContain('shared depth');
 });
 it('retains complete per-character chat context and cache boundaries with global mounts',async()=>{
  const library=[book('chat-common',{scope:'global',globalEnabled:true})];
  const payload=async(id:string,humanStyleEnabled=true)=>buildChatRequestPayload({char:{...reconcileWorldbookMounts(char(id),library),humanStyleEnabled,impression:{personality_core:{summary:`private impression ${id}`}} as any},userProfile:{name:'User',bio:'shared user bio'} as any,groups:[],emojis:[],categories:[],historyMsgs:[{id:1,charId:id,role:'user',content:'hello',type:'text',timestamp:1}] as any,contextLimit:20,realtimeConfig:{weatherEnabled:false,newsEnabled:false} as any});
  const a=await payload('A'),b=await payload('B');
  for(const [id,result] of [['A',a],['B',b]] as const){
   const stable=String(result.fullMessages[0].content);
   for(const marker of ['shared chat-common','shared user bio',`identity ${id}`,`private impression ${id}`])expect(stable.split(marker)).toHaveLength(2);
   expect(stable.indexOf(`identity ${id}`)).toBeLessThan(stable.indexOf('shared chat-common'));
   expect(stable.indexOf('shared user bio')).toBeLessThan(stable.indexOf('聊天 App 行为规范'));
   expect(stable.match(/### 互动对象 \(User\)/g)).toHaveLength(1);
   expect(result.fullMessages[result.volatileTailIndex].role).toBe('system');
   expect(result.fullMessages.some(m=>m.name?.startsWith('sully_shared'))).toBe(false);
  }
  const native=toAnthropicRequest({model:'c',messages:a.fullMessages});expect(native.system.at(-1).cache_control).toEqual({type:'ephemeral'});
  const natural=await payload('natural',false);expect(natural.fullMessages[0].content).toContain('shared chat-common');expect(natural.systemPrompt).not.toContain('identity natural');
 });
 it('keeps global content while applying per-character voice and heart switches',async()=>{
  const library=[book('feature-global',{scope:'global',globalEnabled:true})];
  const make=(id:string,enabled:boolean)=>buildChatRequestPayload({char:{...reconcileWorldbookMounts(char(id),library),humanStyleEnabled:true,chatVoiceEnabled:enabled,innerVoiceEnabled:enabled},userProfile:{name:'User'} as any,groups:[],emojis:[],categories:[],historyMsgs:[{id:1,charId:id,role:'user',type:'text',content:'hello',timestamp:1}] as any,contextLimit:20,realtimeConfig:{weatherEnabled:false,newsEnabled:false} as any});
  const enabled=await make('enabled',true),disabled=await make('disabled',false);
  for(const result of [enabled,disabled])expect(result.systemPrompt.split('shared feature-global')).toHaveLength(2);
  const rules=(p:any)=>p.systemPrompt;
  expect(rules(enabled)).toContain('用户开启了语音消息功能');
  expect(rules(disabled)).toContain('语音消息功能当前未开启');
  expect(rules(disabled)).not.toContain('用户开启了语音消息功能');
  expect(enabled.systemPrompt).toContain('本轮心声格式');
  expect(disabled.systemPrompt).not.toContain('本轮心声格式');
 });
 it('prioritizes complete character and growing history checkpoints over global sharing',()=>{
  const messages=[{role:'system',name:'sully_shared_worldbooks',content:'globals'},{role:'system',content:'identity'},...Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',content:`history-${i}`})),{role:'system',content:'live'}];
  const out=toAnthropicRequest({model:'c',messages,tools:[{type:'function',function:{name:'lookup'}}]});
  expect(out.system[0]).not.toHaveProperty('cache_control');expect(out.tools[0]).toHaveProperty('cache_control');
  expect(out.system.at(-1)).toHaveProperty('cache_control');
  expect(out.messages.flatMap((m:any)=>m.content).filter((b:any)=>b.cache_control).map((b:any)=>b.text)).toEqual(['history-7','history-11']);
 });
 it('retains scope, exceptions, effective mounts and old-format compatibility in actual backup assembly',async()=>{
  const global=book('roundtrip',{scope:'global',globalEnabled:true});const c=reconcileWorldbookMounts({...char('backup'),disabledGlobalWorldbookIds:[global.id]},[global]);const zip=new JSZip();
  const manifest=await writeV2Backup(zip,{characters:[c],worldbooks:[global]} as any);const restored=await assembleV2Backup(zip,manifest);
  expect(restored.characters).toEqual([c]);expect(restored.worldbooks).toEqual([global]);expect(restored.characters[0].mountedWorldbooks[0]).toMatchObject({disable:true,globalMount:true});
  await DB.importFullData(restored as any);
  expect((await DB.getCharacter(c.id))?.disabledGlobalWorldbookIds).toEqual([global.id]);
  expect((await DB.getCharacter(c.id))?.mountedWorldbooks?.[0]).toMatchObject({id:global.id,disable:true,globalMount:true});
 });
});

