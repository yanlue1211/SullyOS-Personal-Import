import React, { useState, useEffect } from 'react';
import type { AudioApiConfig } from '../../types';
import { audioBlobToPayload, buildTestToneWav, describeAudioWithAudioApi, isAudioApiReady } from '../../utils/audioApi';

export default function AudioApiTestButton({ config }: { config?: AudioApiConfig }) {
  const [busy, setBusy] = useState(false);
  const [songStatus, setSongStatus] = useState('');
  useEffect(() => {
    const refresh = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('sully_audio_listen_status') || 'null');
        if (saved?.message) setSongStatus(new Date(saved.at).toLocaleTimeString() + ' · ' + saved.message);
      } catch { /* ignore */ }
    };
    refresh();
    window.addEventListener('sully-audio-listen-status', refresh);
    return () => window.removeEventListener('sully-audio-listen-status', refresh);
  }, []);
  const [result, setResult] = useState('');
  const run = async () => {
    if (!isAudioApiReady(config)) {
      setResult('❌ 请先开启真实听歌，并填写完整的接口地址、API Key 和模型名称。');
      return;
    }
    setBusy(true);
    setResult('⏳ 正在发送 0.6 秒测试音频，请稍候…');
    try {
      const payload = await audioBlobToPayload(buildTestToneWav(), 'test.wav');
      const answer = await describeAudioWithAudioApi(payload, config);
      setResult('✅ 音频接口返回成功（说明接口接受了音频格式，但不保证实际歌曲能获取成功）。\n模型回复：' + answer.slice(0, 600));
    } catch (err) {
      setResult('❌ 音频测试失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };
  return <div className="space-y-2">
    <button type="button" disabled={busy} onClick={run} className="w-full rounded-xl px-3 py-2 bg-amber-100 text-amber-900 font-semibold disabled:opacity-50">
      {busy ? '🎧 正在测试音频模型…' : '🧪 测试音频 API（发送测试音）'}
    </button>
    <p className="text-xs text-slate-500">会实际调用填写的音频模型，可能产生少量 API 费用；不上传你的歌曲，也不会修改角色记忆。</p>
    <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900 whitespace-pre-wrap break-words">
      <div className="font-semibold mb-1">🎵 最近一次真实歌曲听歌状态</div>
      {songStatus || '尚无记录。请先在播放器播放歌曲，让角色通过「一起听」卡片加入，再回这里查看。'}
    </div>
    {result && <div className="text-xs whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3">{result}</div>}
  </div>;
}
