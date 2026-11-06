import { describe, expect, it } from 'vitest';
import { CALL_RECORDING_GUIDE, VIDEO_NARRATION_GUIDE, VOICE_CALL_NARRATION_GUIDE, splitCallNarration, stripCallNarration } from '../features/personal/chatMedia/callFormat';
import { VIRTUAL_MEDIA_GUIDE, RECORDING_HISTORY_GUIDE } from '../features/personal/chatMedia/format';
import { IncrementalCallSpeech } from './incrementalCallSpeech';
import { parseCallAssistantMessage, stripCallTextFormatting } from './callReplyFormat';

describe('call narration safety', () => {
  it('separates screen narration without changing audible acting cues', () => {
    const raw = '<旁白>抬眼看向镜头。</旁白>(chuckle) 嗯。<旁白>摇摇头。</旁白>[laughs] 哈。';
    expect(stripCallNarration(raw)).toBe('(chuckle) 嗯。[laughs] 哈。');
    expect(splitCallNarration(raw).map(part => part.kind)).toEqual(['narration', 'speech', 'narration', 'speech']);
    expect(stripCallNarration(stripCallTextFormatting(parseCallAssistantMessage({ content: raw }).text))).not.toContain('镜头');
  });
  it('never leaks narration across any SSE split, including unclosed blocks', () => {
    const raw = '嗯。<旁白>缓缓抬眼，看向镜头。</旁白>[laughs] 你好呀！<旁白>低头';
    const result: string[] = [];
    const speech = new IncrementalCallSpeech(text => result.push(text));
    for (let i = 1; i <= raw.length; i++) speech.update(raw.slice(0, i));
    speech.finish(raw);
    expect(result.join('')).toBe('嗯。[laughs] 你好呀！');
  });
  it('keeps translated speech, laughter and pauses while excluding both subtitles and narration', () => {
    const raw = '<旁白>挥手。</旁白>你好。<语音 emotion="happy">[laughs] Hello! <旁白>抬头。</旁白>Welcome.</语音>';
    const result: string[] = []; const speech = new IncrementalCallSpeech(text => result.push(text), true);
    for (let i = 1; i <= raw.length; i++) speech.update(raw.slice(0, i));
    speech.finish(raw);
    expect(result.join('')).toBe('[laughs] Hello! Welcome.');
  });
  it('hides alternate or unfinished narration without deleting onomatopoeia', () => {
    expect(stripCallNarration('嗯、啊、嘶……(sighs)<动描>抬头')).toBe('嗯、啊、嘶……(sighs)');
    expect(stripCallNarration('<narration>smiles</narration>Hi.')).toBe('Hi.');
  });
  it('ships fixed protocols for every new message modality', () => {
    expect(CALL_RECORDING_GUIDE).toContain('打字');
    expect(CALL_RECORDING_GUIDE).toContain('未识别');
    expect(VIDEO_NARRATION_GUIDE).toContain('禁止朗读');
    expect(VOICE_CALL_NARRATION_GUIDE).toContain('不输出');
    expect(VIRTUAL_MEDIA_GUIDE).toContain('[[虚拟图片:画面描述]]');
    expect(VIRTUAL_MEDIA_GUIDE).toContain('[[虚拟视频:视频内容描述]]');
    expect(VIRTUAL_MEDIA_GUIDE).toContain('双方发送的图片和视频都是真实的聊天媒体内容');
    expect(RECORDING_HISTORY_GUIDE).toContain('清理');
  });
});
