import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('./ttsRouter',()=>({synthesizeSpeechDetailed:vi.fn(async()=>({url:'https://qa.invalid/audio',blob:new Blob(['audio'])})),canSynthesizeSpeech:()=>true}));
vi.mock('../features/yueqi/storage',()=>({storage:{save:vi.fn(async()=>{})},blobData:vi.fn(async()=> 'data:audio/wav;base64,AAAA')}));
import {synthesizeSpeechDetailed} from './ttsRouter';
import {synthesize,addReply} from '../features/yueqi/generate';
import {newSession,splitSpeech} from '../features/yueqi/model';
import {buildMiniMaxTtsPayload} from './minimaxTts';
import {DB} from './db';
class MetadataAudio{duration=1;onloadedmetadata?:()=>void;onerror?:()=>void;set src(_v:string){queueMicrotask(()=>this.onloadedmetadata?.());}removeAttribute(){}load(){}}
beforeEach(()=>{vi.stubGlobal('Audio',MetadataAudio);vi.clearAllMocks();});
afterEach(()=>{vi.unstubAllGlobals();});
it.each(['legacy','natural-v2'] as const)('actual synthesis honors %s and does not bypass parameter-specific preparation',async version=>{
 const char={id:'tts-'+version,name:'测试',voiceProfile:{voiceId:'qa',minimaxParamVersion:version,model:'speech-2.8-hd'}} as any;
 await DB.saveCharacter(char);
 const session=addReply(newSession(char.id,'story'),'第一句。<#0.4#>第二句。','story');
 await synthesize(session,{api:{ttsProvider:'minimax'}} as any,new AbortController().signal,()=>{});
 const [text,usedChar,,options]=vi.mocked(synthesizeSpeechDetailed).mock.calls[0];
 expect(options?.textAlreadyPrepared).not.toBe(true);
 const payload=buildMiniMaxTtsPayload(text,usedChar.voiceProfile,options);
 expect(payload.text).toMatch(/<#0\.40?#>/);
 expect(session.turns[0].text).toBe('第一句。第二句。');
 expect(session.clips[0].text).toContain('<#0.4#>');
});
it('splits long speech without breaking pause or breath control tokens',()=>{
 const raw='字'.repeat(596)+'<#0.4#>(breath)'+'字'.repeat(700);
 const clips=splitSpeech(raw);expect(clips.join('')).toBe(raw);
 for(const clip of clips){expect(clip.length).toBeLessThanOrEqual(600);expect(clip.replace(/<#0.4#>|\(breath\)/g,'')).not.toMatch(/[<#>()]/);}
});
it('already synthesized clips are kept and cause no extra TTS request',async()=>{
 const char={id:'existing-tts',name:'测试',voiceProfile:{voiceId:'qa'}} as any;await DB.saveCharacter(char);
 const s=addReply(newSession(char.id,'story'),'已有语音。','story');s.clips[0].audio='data:old';
 const result=await synthesize(s,{api:{ttsProvider:'minimax'}} as any,new AbortController().signal,()=>{});
 expect(result.clips[0].audio).toBe('data:old');expect(synthesizeSpeechDetailed).not.toHaveBeenCalled();
});
