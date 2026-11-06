import { encodeMonoWav } from '../features/personal/chatMedia/recording';
import { ChatPrompts } from './chatPrompts';
import type { Message } from '../types';
import { describe, it, expect } from 'vitest';
import { virtualMedia, parseVirtualMedia } from '../features/personal/chatMedia/format';
import { ChatParser } from './chatParser';
describe('personal chat media', () => {
  it('preserves descriptions through the assistant sanitizer', () => {
    const content = virtualMedia('图片', '窗边的一只白色小狗');
    expect(parseVirtualMedia(ChatParser.sanitize(content))).toEqual({ kind: '图片', description: '窗边的一只白色小狗' });
  });
  it('treats standalone assistant media as visible content', () => {
    expect(ChatParser.hasDisplayContent('[[虚拟图片:窗边的白色小狗]]')).toBe(true);
    expect(ChatParser.hasDisplayContent('[[虚拟视频:小狗跑过草地]]')).toBe(true);
    expect(ChatParser.hasDisplayContent('[[MUSIC_ACTION:add]]')).toBe(false);
  });
  it('does not turn ordinary text into media', () => {
    expect(parseVirtualMedia('我想发张图片')).toBeNull();
    expect(parseVirtualMedia('[[虚拟图片: ]]')).toBeNull();
  });
  it('keeps multiline virtual media in a single bubble', () => {
    const content = virtualMedia('视频', '走到窗边\n抬头看月亮');
    expect(ChatParser.chunkText(`给你看看\n${content}\n好看吗`)).toEqual(['给你看看', content, '好看吗']);
  });
});

it('encodes valid mono PCM WAV with bounded samples', async () => {
  const blob = encodeMonoWav(new Float32Array([-2, 0, 2]), 16000);
  const bytes = new DataView(await blob.arrayBuffer());
  expect(blob.type).toBe('audio/wav');
  expect(blob.size).toBe(50);
  expect(bytes.getUint32(24, true)).toBe(16000);
  expect(bytes.getInt16(44, true)).toBe(-32768);
  expect(bytes.getInt16(48, true)).toBe(32767);
});
it('never sends a recording storage reference as text to the dialogue model', () => {
  const message: Message = { id: 1, charId: 'a', role: 'user', type: 'audio', content: 'blobref:b_private', timestamp: Date.now(), metadata: { audioDescription: '你好，语气轻快' } };
  const { apiMessages } = ChatPrompts.buildMessageHistory([message], 100, { id: 'a' } as any, {} as any, []);
  expect(JSON.stringify(apiMessages)).toContain('你好，语气轻快');
  expect(JSON.stringify(apiMessages)).not.toContain('blobref:');
});
