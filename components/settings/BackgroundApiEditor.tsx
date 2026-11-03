import React, { useState } from 'react';
import type { DialogueApiConfig } from '../../types';
import { normalizeLlmBaseUrl } from '../../utils/llmEndpoint';

interface Props {
  value?: DialogueApiConfig;
  onSave: (value?: DialogueApiConfig) => void;
  title: string;
  help: string;
}
export const BackgroundApiEditor: React.FC<Props> = ({value,onSave,title,help}) => {
  const [open,setOpen] = useState(false);
  const [url,setUrl] = useState(value?.baseUrl || '');
  const [key,setKey] = useState(value?.apiKey || '');
  const [model,setModel] = useState(value?.model || '');
  const [apiType,setApiType] = useState<'openai'|'anthropic'>(value?.apiType || 'openai');
  const [error,setError] = useState('');
  const begin = () => {setUrl(value?.baseUrl || '');setKey(value?.apiKey || '');setModel(value?.model || '');setApiType(value?.apiType || 'openai');setError('');setOpen(true);};
  const save = () => {
    if (!url.trim() || !key.trim() || !model.trim()) {setError('请填写完整的 URL、Key 和模型名称');return;}
    onSave({baseUrl:normalizeLlmBaseUrl(url.trim(),apiType),apiKey:key.trim(),model:model.trim(),apiType});
    setOpen(false);
  };
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
    <div className="flex justify-between gap-2 items-center"><div><b>{title}</b><p className="text-xs text-slate-500">{help}</p></div><button type="button" className="px-3 py-2 rounded-xl bg-slate-100 text-xs shrink-0" onClick={begin}>{value?.baseUrl?'修改':'配置'}</button></div>
    <p className="text-xs text-slate-500">{value?.baseUrl? `已设置 · ${value.model}`:'未设置 · 跟随主聊天 API'}</p>
    {value?.baseUrl && <button type="button" className="text-xs text-rose-500" onClick={()=>onSave(undefined)}>清除独立 API，恢复跟随</button>}
    {open && <div className="space-y-2 border-t border-slate-100 pt-3">
      <label className="block text-xs">接口类型<select className="w-full border rounded-lg p-2 mt-1" value={apiType} onChange={e=>setApiType(e.target.value as 'openai'|'anthropic')}><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic 原生</option></select></label>
      <label className="block text-xs">API URL<input className="w-full border rounded-lg p-2 mt-1" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com/v1" /></label>
      <label className="block text-xs">API Key<input type="password" className="w-full border rounded-lg p-2 mt-1" value={key} onChange={e=>setKey(e.target.value)} placeholder="sk-..." /></label>
      <label className="block text-xs">模型<input className="w-full border rounded-lg p-2 mt-1" value={model} onChange={e=>setModel(e.target.value)} placeholder="模型名称" /></label>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="px-3 py-2 text-xs" onClick={()=>setOpen(false)}>取消</button><button type="button" className="px-3 py-2 rounded-lg bg-emerald-100 text-xs" onClick={save}>保存</button></div>
    </div>}
  </section>;
};
