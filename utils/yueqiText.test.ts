import {buildMiniMaxTtsPayload} from './minimaxTts';
import {it,expect} from 'vitest';
import {yueqiDisplayText,yueqiSpeechText} from '../features/yueqi/text';
it('repairs screenshot headers and curly voice tags without losing paragraphs',()=>{
 const raw='[2026-11-02 03:44] [月栖 · 隔屏伴月]\n\n<语音 emotion=”calm”>\n第一段。还有一句。\n\n第二段。</语音>';
 expect(yueqiDisplayText(raw)).toBe('第一段。还有一句。\n\n第二段。');
 expect(yueqiSpeechText(raw)).toBe('第一段。还有一句。\n<#0.6#>第二段。');
});
it('hides markers and system notices and never adds pauses within prose',()=>{
 const raw='[系统提示: 距离上一条消息: 5 分钟。]\n第一句。<#0.3#>第二句。\n下一段。';
 expect(yueqiDisplayText(raw)).toBe('第一句。第二句。\n下一段。');
 expect(yueqiSpeechText(raw)).toBe('第一句。第二句。\n<#0.6#>下一段。');
 expect(yueqiSpeechText(raw,false)).not.toContain('<#');
});
it('does not delete ordinary story brackets',()=>expect(yueqiDisplayText('他说：[灯还亮着]。')).toBe('他说：[灯还亮着]。'));

it('prepared 月栖 text bypasses classic sentence-level pause insertion',()=>{const text=yueqiSpeechText('第一句。第二句。\n\n另一段。');expect(buildMiniMaxTtsPayload(text,{} as any,{textAlreadyPrepared:true}).text).toBe(text);expect((text.match(/<#/g)||[])).toHaveLength(1);});
