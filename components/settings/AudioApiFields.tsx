import React, { useEffect, useRef, useState } from 'react';
import type { AudioApiConfig, ApiPreset } from '../../types';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from '../../utils/apiConfigNormalize';
import { extractModelIds } from '../../utils/modelList';
import { safeResponseJson } from '../../utils/safeApi';
import ApiPresetGroups from './ApiPresetGroups';
import ModelPicker from './ModelPicker';
import Modal from '../os/Modal';

export function audioConfigFromPreset(preset: ApiPreset, current?: AudioApiConfig): AudioApiConfig {
  return { enabled: false, ...current,
    baseUrl: normalizeApiBaseUrl(preset.config.baseUrl),
    apiKey: normalizeApiCredential(preset.config.apiKey),
    model: normalizeApiModel(preset.config.model) };
}
export default function AudioApiFields({ config, presets, onChange }: {
  config?: AudioApiConfig; presets: ApiPreset[]; onChange: (config: AudioApiConfig) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [showModels, setShowModels] = useState(false);
  const [draft, setDraft] = useState('');
  const request = useRef(0);
  useEffect(() => {
    request.current++; setModels([]); setShowModels(false); setLoading(false);
    return () => { request.current++; };
  }, [config?.baseUrl, config?.apiKey]);
  const update = (patch: Partial<AudioApiConfig>) => onChange({ enabled: false, baseUrl: '', apiKey: '', model: '', ...config, ...patch });
  const fetchModels = async () => {
    const baseUrl = normalizeApiBaseUrl(config?.baseUrl || '');
    if (!baseUrl) { setStatus('请先填写音频接口地址'); return; }
    const generation = ++request.current;
    setLoading(true); setStatus('正在拉取模型…');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${baseUrl}/models`, { signal: controller.signal,
        headers: { Authorization: `Bearer ${normalizeApiCredential(config?.apiKey || '')}`, 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const list = extractModelIds(await safeResponseJson(response));
      if (generation !== request.current) return;
      if (!list.length) throw new Error('模型列表为空或格式不兼容');
      setModels(list); setDraft(config?.model || ''); setShowModels(true);
      setStatus(`已获取 ${list.length} 个模型，请选择支持音频输入的模型`);
    } catch (e: any) {
      if (generation === request.current) setStatus(e.name === 'AbortError' ? '拉取超时，请重试' : `拉取失败：${e.message}`);
    } finally { clearTimeout(timer); if (generation === request.current) setLoading(false); }
  };
  return <div className="space-y-3">
    <details className="rounded-xl bg-slate-50 border border-slate-100 p-3">
      <summary className="text-xs font-bold cursor-pointer">从已保存的 API 预设选择</summary>
      <div className="mt-3">{presets.length ? <ApiPresetGroups presets={presets}>{preset => <button key={preset.id} className="px-3 py-2 rounded-lg border bg-white text-xs" onClick={() => { onChange(audioConfigFromPreset(preset, config)); setStatus(`已载入音频配置：${preset.name}`); }}>{preset.name}</button>}</ApiPresetGroups> : <p className="text-xs text-slate-400">尚无 API 预设，可先在对话 API 区保存。</p>}</div>
    </details>
    {(['baseUrl', 'apiKey', 'model'] as const).map(field => <label key={field} className="block text-xs text-slate-600">{field === 'baseUrl' ? '接口地址' : field === 'apiKey' ? 'API Key' : '音频模型名称'}
      <input className="w-full mt-1 p-2 border border-slate-200 rounded-lg bg-white" aria-label={field === 'baseUrl' ? '音频接口地址' : field === 'apiKey' ? '音频 API Key' : '音频模型名称'} type={field === 'apiKey' ? 'password' : 'text'} value={config?.[field] || ''} placeholder={field === 'baseUrl' ? 'https://example.com/v1' : field === 'model' ? '支持音频输入的模型 ID' : ''} onChange={e => update({ [field]: e.target.value })} />
    </label>)}
    <div className="flex gap-2"><button disabled={loading} className="text-xs px-3 py-2 rounded-lg bg-slate-100" onClick={() => void fetchModels()}>{loading ? '正在拉取…' : '拉取模型'}</button>{models.length > 0 && <button className="text-xs px-3 py-2 rounded-lg border" onClick={() => { setDraft(config?.model || ''); setShowModels(true); }}>选择模型</button>}</div>
    {status && <p role="status" className="text-xs text-slate-500">{status}</p>}
    <Modal isOpen={showModels} title="选择音频模型" onClose={() => setShowModels(false)}><ModelPicker availableModels={models} localModel={draft} setLocalModel={setDraft} confirmModelPicker={model => { update({ model }); setShowModels(false); }} /></Modal>
  </div>;
}
