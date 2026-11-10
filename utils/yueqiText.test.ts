import {buildMiniMaxTtsPayload} from './minimaxTts';
import {it,expect} from 'vitest';
import {yueqiDisplayText,yueqiSpeechText,yueqiVoiceSource,yueqiVoiceGuide} from '../features/yueqi/text';
it('repairs screenshot headers and curly voice tags without losing paragraphs',()=>{
 const raw='[2026-11-02 03:44] [月栖 · 隔屏伴月]\n\n<语音 emotion=”calm”>\n第一段。还有一句。\n\n第二段。</语音>';
 expect(yueqiDisplayText(raw)).toBe('第一段。还有一句。\n\n第二段。');
 expect(yueqiSpeechText(raw)).toBe('第一段。还有一句。\n<#0.6#>第二段。');
});
it('hides controls in display but preserves explicit spoken pauses',()=>{
 const raw='[系统提示: 距离上一条消息: 5 分钟。]\n第一句。<#0.3#>第二句。\n下一段。';
 expect(yueqiDisplayText(raw)).toBe('第一句。第二句。\n下一段。');
 expect(yueqiSpeechText(raw)).toBe('第一句。<#0.3#>第二句。\n<#0.6#>下一段。');
 expect(yueqiSpeechText(raw,false)).not.toContain('<#');
});
it('does not delete ordinary story brackets',()=>expect(yueqiDisplayText('他说：[灯还亮着]。')).toBe('他说：[灯还亮着]。'));

it('classic parameters regain automatic sentence pauses while natural mode preserves explicit ones',()=>{
 const text=yueqiSpeechText('第一句。第二句。\n\n另一段。');
 expect(buildMiniMaxTtsPayload(text,{} as any).text).toContain('第一句。<#0.22#>第二句');
 const natural={minimaxParamVersion:'natural-v2'} as any;
 expect(buildMiniMaxTtsPayload(yueqiSpeechText('第一句。<#0.4#>第二句。',true,natural),natural).text).toBe('第一句。<#0.4#>第二句。');
});
it('speech controls survive model cleanup and stay out of visible text',()=>{
 const raw='<语音>第一句。<#0.4#>第二句。(breath)第三句。</语音>';
 expect(yueqiVoiceSource(raw)).toBe('第一句。<#0.4#>第二句。(breath)第三句。');
 expect(yueqiDisplayText(raw)).toBe('第一句。第二句。第三句。');
});
it('short replies have no breath and unsupported providers/models receive none',()=>{
 expect(yueqiSpeechText('你好。(breath)晚安。')).not.toContain('(breath)');
 const long=('月光落在安静的海面上。').repeat(30);
 expect(yueqiSpeechText(long,false)).not.toMatch(/breath|<#/);
 expect(yueqiSpeechText(long,true,{model:'speech-02-hd'} as any)).not.toContain('(breath)');
 expect(yueqiVoiceGuide({model:'speech-02-hd'} as any,true)).not.toContain('(breath)');
});
it('breathing remains sparse even if the model inserts one after every sentence',()=>{
 const long=('月光落在安静的海面上。(breath)').repeat(40),text=yueqiSpeechText(long);
 expect((text.match(/\(breath\)/g)||[]).length).toBeGreaterThan(0);
 expect((text.match(/\(breath\)/g)||[]).length).toBeLessThanOrEqual(2);
 expect(yueqiDisplayText(text)).toBe(yueqiDisplayText(long));
});
it('plain legacy long records get one breath at a full sentence without changing words',()=>{
 const long=('月光落在安静的海面上。').repeat(30),text=yueqiSpeechText(long);
 expect(text).toContain('。(breath)');expect((text.match(/\(breath\)/g)||[])).toHaveLength(1);
 expect(yueqiDisplayText(text)).toBe(long);
});
