import { describe, expect, it } from 'vitest';
import { parseRecordingRecognition, recordingContext, recordingText } from '../features/personal/chatMedia/transcript';
describe('recording transcript separation', () => {
  it('keeps exact original-language words separate from analysis', () => {
    expect(parseRecordingRecognition('{"transcript":"嗯… hello？","analysis":"语气轻快，有键盘声"}')).toEqual({ transcript: '嗯… hello？', analysis: '语气轻快，有键盘声' });
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
