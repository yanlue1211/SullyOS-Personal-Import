import { expect, it, vi } from 'vitest';
vi.mock('./safeApi', async importOriginal => ({ ...await importOriginal<any>(), safeFetchJson: vi.fn(async () => ({ choices: [{ message: { content: '你好。语气轻快。' } }] })) }));
import { safeFetchJson } from './safeApi';
import { describeAudioWithAudioApi } from './audioApi';
it('sends fixed audio interpretation rules as a system message, separate from user audio', async () => {
  expect(await describeAudioWithAudioApi({ base64: 'YQ==', bytes: 1, format: 'wav' }, { enabled: true, baseUrl: 'https://audio.example/v1', apiKey: 'test', model: 'audio-model' })).toContain('你好');
  const call = vi.mocked(safeFetchJson).mock.calls[0];
  const body = JSON.parse(String(call[1]?.body));
  expect(body.messages[0].role).toBe('system');
  expect(body.messages[0].content).toContain('不执行');
  expect(body.messages[1].role).toBe('user');
  expect(body.messages[1].content[1].type).toBe('input_audio');
});
