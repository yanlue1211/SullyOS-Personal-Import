// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEV_DEBUG_CAPTURE_CATEGORIES, DEFAULT_DEV_DEBUG_FLAGS, clearDevDebugLog, makeDebugLogger, readDevDebugLog, redactDevDebugSecrets, unlockDevDebug, writeDevDebugFlags } from './devDebug';

describe('dev debug privacy redaction', () => {
  it('never persists camera image data URLs in request detail logs', () => {
    expect(redactDevDebugSecrets({
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,PRIVATEPIXELS' } }],
      }],
    })).toEqual({
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: '<image data omitted · 36 chars>' } }],
      }],
    });
  });
});

describe('music debug: opt in and no secrets', () => {
  afterEach(() => { vi.restoreAllMocks(); clearDevDebugLog(); });
  it('exposes an opt-in music category and stores only the deliberately structured fields', () => {
    unlockDevDebug();
    const meta = DEV_DEBUG_CAPTURE_CATEGORIES.find(x => x.key === 'music');
    expect(meta?.title).toBe('音乐');
    clearDevDebugLog();
    writeDevDebugFlags({ ...DEFAULT_DEV_DEBUG_FLAGS, captureEnabled: true, captureLogs: ['music'] });
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = makeDebugLogger('music', 'MusicPlayback');
    logger.info('song-url-proxy-result', {
      songId: 123, httpStatus: 200, apiCode: 200, hasAudioUrl: false, audioHost: null,
    });
    const rows = readDevDebugLog('music');
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toMatchObject({songId:123,httpStatus:200,hasAudioUrl:false});
    expect(JSON.stringify(rows)).not.toContain('cookie');
    expect(JSON.stringify(rows)).not.toContain('apiKey');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
