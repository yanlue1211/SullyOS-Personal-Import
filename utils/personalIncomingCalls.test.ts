import {classifyLLMOutput} from '../worker/amsg/src/classifier';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {DB} from './db';
import {allowsIncomingCall,incomingCallGuide,requestIncomingCall,readIncomingCall,settleIncomingCall,consumeIncomingCallInvites,queueIncomingCallLaunch,takeIncomingCallLaunch} from '../features/personal/calls/incoming';
import {ChatPrompts} from './chatPrompts';
beforeEach(()=>localStorage.clear());afterEach(()=>vi.restoreAllMocks());
const save=async(id:string,voice=false,video=false)=>{const char={id,name:id,allowIncomingVoiceCalls:voice,allowIncomingVideoCalls:video,memories:[]} as any;await DB.saveCharacter(char);return char;};
describe('per-character incoming call permissions and delivery',()=>{
 it('defaults both permissions off and advertises only the granted mode',async()=>{
  expect(allowsIncomingCall({},'voice')).toBe(false);expect(allowsIncomingCall({},'video')).toBe(false);
  const a=await save('permission-a',true),b=await save('permission-b',false,true);
  expect(incomingCallGuide(a)).toContain('[[CALL_INVITE:voice]]');expect(incomingCallGuide(a)).not.toContain('[[CALL_INVITE:video]]');expect(incomingCallGuide(b)).not.toContain('[[CALL_INVITE:voice]]');
  expect(await requestIncomingCall(a.id,'video')).toBe('permission-denied');expect(readIncomingCall()).toBeNull();
 });
 it('rings once, refuses concurrent invites, records decline once and permits a fresh repeated call',async()=>{
  const a=await save('ring-a',true),b=await save('ring-b',true);
  expect(await requestIncomingCall(a.id,'voice')).toBe('ringing');const first=readIncomingCall()!;
  expect(await requestIncomingCall(b.id,'voice')).toBe('busy');expect(readIncomingCall()?.id).toBe(first.id);
  expect(await settleIncomingCall(first,'declined')).toBe(true);expect(await settleIncomingCall(first,'missed')).toBe(false);
  expect(await requestIncomingCall(a.id,'voice')).toBe('ringing');
  const logs=(await DB.getMessagesByCharId(a.id,true)).filter(m=>m.metadata?.incomingCallId===first.id);expect(logs).toHaveLength(1);expect(logs[0].content).toContain('已拒接');
 });
 it('rechecks current permission, suppresses stale offline invites, and allows a later attempt',async()=>{
  const a=await save('live-a',true);await DB.saveCharacter({...a,allowIncomingVoiceCalls:false});expect(await requestIncomingCall(a.id,'voice')).toBe('permission-denied');
  await DB.saveCharacter(a);expect(await requestIncomingCall(a.id,'voice',Date.now()-120_000)).toBe('expired');expect(readIncomingCall()).toBeNull();
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);expect(await requestIncomingCall(a.id,'voice')).toBe('ringing');const call=readIncomingCall()!;await settleIncomingCall(call,'missed');
  vi.spyOn(Date,'now').mockReturnValue(now+1);expect(await requestIncomingCall(a.id,'voice')).toBe('ringing');
 });
 it.each(['<think mode="test">[[CALL_INVITE:voice]]</think>','<心声>{"thoughts":"[[CALL_INVITE:voice]]"}</心声>','`[[CALL_INVITE:voice]]`','```\n[[CALL_INVITE:voice]]\n```','> [[CALL_INVITE:voice]]'])('never executes a private or quoted tag (%s)',async raw=>{
  const a=await save('hidden-a',true);await consumeIncomingCallInvites(raw,a.id);expect(readIncomingCall()).toBeNull();
 });
 it('consumes final tags without exposing them and launches the accepted mode once',async()=>{
  const a=await save('consume-a',false,true);expect(await consumeIncomingCallInvites('想看看你\n[[CALL_INVITE:video]]',a.id)).toBe('想看看你');const call=readIncomingCall()!;
  expect(call.mode).toBe('video');await settleIncomingCall(call,'accepted');queueIncomingCallLaunch(call);expect(takeIncomingCallLaunch()?.charId).toBe(a.id);expect(takeIncomingCallLaunch()).toBeNull();
 });
 it('keeps granted call protocol in the stable prompt for local and cloud generation',async()=>{
  const a=await save('prompt-calls',true,true);
  for(const forFirePack of [false,true]){const parts=await ChatPrompts.buildSystemPromptParts(a,{name:'用户'} as any,[],[],[],[],undefined,undefined,undefined,undefined,undefined,undefined,{forFirePack});expect(parts.stable).toContain('[[CALL_INVITE:voice]]');expect(parts.stable).toContain('[[CALL_INVITE:video]]');expect(parts.volatileState).not.toContain('[[CALL_INVITE:voice]]');}
 });
});

it('cloud classification preserves invitation execution data while notification text stays readable',()=>{
 const result=classifyLLMOutput('想给你打个电话\n[[CALL_INVITE:voice]]');expect(result.kind).toBe('finish');
 if(result.kind==='finish'){expect(result.cleanedText).toContain('[[CALL_INVITE:voice]]');expect(result.sanitizedBody).not.toContain('CALL_INVITE');expect(result.sanitizedBody).toContain('想给你打个电话');}
});
