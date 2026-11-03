import {describe,it,expect,vi,afterEach} from 'vitest';
import {SpeechTurnGate,captureSpeechTurn,captureBrowserSpeech} from '../features/personal/calls/handsFree';
vi.mock('./speechToText',()=>({startStt:vi.fn()}));
import {startStt} from './speechToText';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('hands-free voice turns',()=>{
 it('does not send silence or a short spike; waits through pauses and ends one real utterance',()=>{
  const gate=new SpeechTurnGate();for(let t=100;t<5100;t+=50)expect(gate.update(.002,t)).toBe('waiting');
  expect(gate.update(.1,5150)).toBe('speaking');expect(gate.update(.001,6900)).toBe('waiting');
  for(let t=7000;t<7600;t+=50)expect(gate.update(.06,t)).toBe('speaking');
  expect(gate.update(.001,8200)).toBe('speaking');expect(gate.update(.001,9000)).toBe('complete');
 });
 it('stops late-acquired microphone tracks after cancellation without recording or sending',async()=>{
  const stopped=vi.fn(),controller=new AbortController();let deliver:(s:any)=>void=()=>{};
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(()=>new Promise(resolve=>deliver=resolve))}});
  const result=captureSpeechTurn({} as AudioContext,controller.signal);controller.abort();deliver({getTracks:()=>[{stop:stopped}]});
  await expect(result).rejects.toHaveProperty('name','AbortError');expect(stopped).toHaveBeenCalledOnce();vi.unstubAllGlobals();
 });
 it('automatically ends browser speech after a pause and ignores late results after mute',async()=>{
  vi.useFakeTimers();let callbacks:any;const stop=vi.fn(()=>callbacks.onEnd());
  vi.mocked(startStt).mockImplementation(async(_lang,cb)=>{callbacks=cb;return {stop};});
  const controller=new AbortController(),result=captureBrowserSpeech({},'zh-CN',controller.signal);await Promise.resolve();callbacks.onPartial('我下班啦');
  await vi.advanceTimersByTimeAsync(1500);await expect(result).resolves.toBe('我下班啦');expect(stop).toHaveBeenCalledOnce();
  const second=new AbortController(),ignored=captureBrowserSpeech({},'zh-CN',second.signal);await Promise.resolve();second.abort();callbacks.onFinal('不要发出去');await expect(ignored).rejects.toHaveProperty('name','AbortError');
 });
});
