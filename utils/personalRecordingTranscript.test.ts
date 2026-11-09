import { describe, expect, it } from 'vitest';
import { RECORDING_TRANSCRIPT_SYSTEM, parseRecordingRecognition, recordingContext, recordingText } from '../features/personal/chatMedia/transcript';
describe('recording transcript separation', () => {
  it('keeps exact original-language words separate from analysis', () => {
    expect(parseRecordingRecognition('{"transcript":"嗯… hello？","analysis":"语气轻快，有键盘声"}')).toEqual({ transcript: '嗯… hello？', analysis: '语气轻快，有键盘声' });
  });
  it('keeps the spoken words intact but removes speculative gender from new acoustic analysis', () => {
    expect(parseRecordingRecognition('{"transcript":"我今天有点困，男生也是这样吗？","analysis":"说话者是一位男性，语速明快，声音清亮。"}'))
      .toEqual({ transcript: '我今天有点困，男生也是这样吗？', analysis: '语速明快，声音清亮。' });
    expect(parseRecordingRecognition('{"transcript":"好啦","analysis":"男声。"}'))
      .toEqual({ transcript: '好啦', analysis: '' });
  });
  it('requires audio evidence rather than inferring sleepiness from the transcript', () => {
    expect(RECORDING_TRANSCRIPT_SYSTEM).toContain('不能仅凭说话内容推断困倦');
    expect(RECORDING_TRANSCRIPT_SYSTEM).toContain('不要使用“男声”“女声”');
    expect(RECORDING_TRANSCRIPT_SYSTEM).toContain('绝不能混进 transcript');
  });
  it('allows grounded crying-voice observations without assuming the person is actually sad', () => {
    const result = parseRecordingRecognition('{"transcript":"我没事","analysis":"说话稍有哽咽和哭腔，听起来有些难过。"}');
    expect(result).toEqual({ transcript: '我没事', analysis: '说话稍有哽咽和哭腔，听起来有些难过。' });
    expect(RECORDING_TRANSCRIPT_SYSTEM).toContain('只能表示声音给人的印象');
    expect(RECORDING_TRANSCRIPT_SYSTEM).toContain('不要把文本意思、对话话题或场景当作声学证据');
  });
  it('does not label a legacy free-form analysis as the user’s words', () => {
    expect(recordingText({ audioDescription: '这是一位声音轻快的用户，背景有键盘声。' })).toEqual({ transcript: '', analysis: '这是一位声音轻快的用户，背景有键盘声。' });
  });
  it('recovers legacy captions only when explicitly labeled', () => {
    expect(recordingText({ audioDescription: '原文：你好呀\n语气：轻快' }).transcript).toBe('你好呀');
  });
  it('fails on an unstructured response instead of exposing analysis as a caption', () => {
    expect(() => parseRecordingRecognition('用户听起来很高兴')).toThrow('原文字幕格式');
  });
  it('retains analysis in model context without claiming it is a quote', () => {
    expect(recordingContext({ transcript: '你好', analysis: '有风声' })).toContain('非用户原话');
  });
});
