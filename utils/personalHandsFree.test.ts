import {describe,it,expect,vi,afterEach} from 'vitest';
import {SpeechTurnGate,captureSpeechTurn,captureBrowserSpeech} from '../features/personal/calls/handsFree';
vi.mock('./speechToText',()=>({startStt:vi.fn()}));
import {startStt} from './speechToText';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
describe('hands-free voice turns',()=>{
 const calibrate=(gate:SpeechTurnGate,noise=.001)=>{for(let t=0;t<=500;t+=100)gate.update(noise,t);};
 it('does not send silence or a short spike',()=>{
  const gate=new SpeechTurnGate();calibrate(gate);
  gate.update(.1,600);for(let t=700;t<=4000;t+=100)expect(gate.update(.001,t)).toBe('waiting');expect(gate.hasSpeech).toBe(false);
 });
 it('waits through a mid-sentence pause and restarts countdown when quiet speech resumes',()=>{
  const gate=new SpeechTurnGate();calibrate(gate);
  for(let t=600;t<=1300;t+=100)gate.update(.3,t);
  for(let t=1400;t<=3200;t+=100)expect(gate.update(.001,t)).not.toBe('complete');
  for(let t=3300;t<=4000;t+=100)gate.update(.008,t);
  expect(gate.update(.001,5000)).toBe('pausing');expect(gate.remainingMs).toBe(1400);
  expect(gate.update(.001,6300)).toBe('pausing');expect(gate.update(.001,6400)).toBe('complete');
 });
 it('learns steady microphone noise above the old hard threshold and still ends after speech',()=>{
  const gate=new SpeechTurnGate();calibrate(gate,.025);
  for(let t=600;t<=2000;t+=100)expect(gate.update(.025,t)).toBe('waiting');
  for(let t=2100;t<=3000;t+=100)gate.update(.12,t);
  expect(gate.hasSpeech).toBe(true);for(let t=3100;t<5400;t+=100)expect(gate.update(.025,t)).not.toBe('complete');
  expect(gate.update(.025,5400)).toBe('complete');
 });
 it('detects soft speech below the old fixed threshold',()=>{
  const gate=new SpeechTurnGate();calibrate(gate,.0005);
  for(let t=600;t<=1500;t+=100)gate.update(.008,t);
  expect(gate.hasSpeech).toBe(true);expect(gate.update(.0005,3900)).toBe('complete');
 });
 it('keeps a brief acknowledgement while ignoring a single noise spike',()=>{
  const gate=new SpeechTurnGate();calibrate(gate);gate.update(.03,600);gate.update(.03,700);expect(gate.hasSpeech).toBe(true);expect(gate.update(.001,3100)).toBe('complete');
 });
 it('stops late-acquired microphone tracks after cancellation without recording or sending',async()=>{
  vi.stubGlobal('MediaRecorder',class{});
  const stopped=vi.fn(),controller=new AbortController();let deliver:(s:any)=>void=()=>{};
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(()=>new Promise(resolve=>deliver=resolve))}});
  const result=captureSpeechTurn({} as AudioContext,controller.signal);controller.abort();deliver({getTracks:()=>[{stop:stopped}]});
  await expect(result).rejects.toHaveProperty('name','AbortError');expect(stopped).toHaveBeenCalledOnce();vi.unstubAllGlobals();
 });
 it('automatically ends browser speech after a pause and ignores late results after mute',async()=>{
  vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>Date.now());let callbacks:any;const stop=vi.fn(()=>callbacks.onEnd());
  vi.mocked(startStt).mockImplementation(async(_lang,cb)=>{callbacks=cb;return {stop};});
  const controller=new AbortController(),result=captureBrowserSpeech({},'zh-CN',controller.signal);await Promise.resolve();callbacks.onPartial('我下班啦');
  await vi.advanceTimersByTimeAsync(2500);await expect(result).resolves.toBe('我下班啦');expect(stop).toHaveBeenCalledOnce();
  const second=new AbortController(),ignored=captureBrowserSpeech({},'zh-CN',second.signal);await Promise.resolve();second.abort();callbacks.onFinal('不要发出去');await expect(ignored).rejects.toHaveProperty('name','AbortError');
 });
});

it('browser duplicate partials do not postpone forever and a missing end event has a bounded fallback',async()=>{
 vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>Date.now());let callbacks:any;
 const stop=vi.fn();vi.mocked(startStt).mockImplementation(async(_lang,cb)=>{callbacks=cb;return {stop};});
 const result=captureBrowserSpeech({},'zh-CN',new AbortController().signal);await Promise.resolve();callbacks.onPartial('说完了');
 await vi.advanceTimersByTimeAsync(1600);callbacks.onPartial('说完了');await vi.advanceTimersByTimeAsync(900);expect(stop).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(1500);await expect(result).resolves.toBe('说完了');
});

it('a browser-owned early end keeps the turn open and joins speech resumed within the pause window',async()=>{
 vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>Date.now());const sessions:any[]=[];
 vi.mocked(startStt).mockImplementation(async(_lang,cb)=>{sessions.push(cb);return {stop:()=>cb.onEnd?.()};});
 const result=captureBrowserSpeech({},'zh-CN',new AbortController().signal);await Promise.resolve();sessions[0].onPartial('我今天');
 await vi.advanceTimersByTimeAsync(1000);sessions[0].onFinal('我今天');sessions[0].onEnd();await vi.advanceTimersByTimeAsync(150);expect(sessions).toHaveLength(2);
 sessions[1].onPartial('还没有说完');await vi.advanceTimersByTimeAsync(2500);await expect(result).resolves.toBe('我今天 还没有说完');
});
