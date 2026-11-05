import React, {useEffect, useId, useRef, useState} from 'react';
import {CaretDown, PaperPlaneTilt, ChatsCircle, Stack, ArrowClockwise} from '@phosphor-icons/react';
import type {ApiPreset, DialogueApiConfig} from '../../types';
import {pickDialogueApi} from '../../utils/characterApi';
import {llmApiType} from '../../utils/llmEndpoint';
import {configFromPreset, findActivePresetId} from '../../utils/apiPresetSwitch';
import {extractModelIds} from '../../utils/modelList';
import {fetchLlm} from '../../utils/anthropicApi';
import Modal from '../os/Modal';
import ModelPicker from './ModelPicker';
import ApiPresetGroups from './ApiPresetGroups';
import './BackgroundApiEditor.css';

interface Props {
  value?: DialogueApiConfig;
  inheritedApi?: DialogueApiConfig;
  presets?: ApiPreset[];
  onSave: (value?: DialogueApiConfig) => void | Promise<void>;
  title: string;
  help: string;
  kind?: 'proactive' | 'moments';
}
const validAddress=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}};
const empty:DialogueApiConfig={baseUrl:'',apiKey:'',model:'',apiType:'openai'};
export const BackgroundApiEditor:React.FC<Props>=({value,inheritedApi,presets=[],onSave,title,help,kind='proactive'})=>{
  const id=useId(),version=useRef(0),request=useRef<AbortController>();
  const [open,setOpen]=useState(false),[draft,setDraft]=useState<DialogueApiConfig>(empty);
  const [showPresets,setShowPresets]=useState(false),[picker,setPicker]=useState(false),[pickerModel,setPickerModel]=useState('');
  const [models,setModels]=useState<string[]>([]),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
  const [error,setError]=useState(''),[status,setStatus]=useState('');
  const invalidate=()=>{version.current++;request.current?.abort();request.current=undefined;};
  useEffect(()=>()=>invalidate(),[]);
  const close=()=>{if(saving)return;invalidate();setLoading(false);setOpen(false);setPicker(false);};
  const begin=()=>{invalidate();setDraft(pickDialogueApi(value||inheritedApi||empty));setModels([]);setLoading(false);setShowPresets(false);setPicker(false);setStatus('');setError('');setOpen(true);};
  const change=(patch:Partial<DialogueApiConfig>,replace=false)=>{
    invalidate();setLoading(false);setError('');setStatus('');
    if(patch.baseUrl!==undefined||patch.apiKey!==undefined||patch.apiType!==undefined)setModels([]);
    setDraft(previous=>replace?pickDialogueApi(patch as DialogueApiConfig):({...previous,...patch}));
  };
  const fetchModels=async()=>{
    const api=pickDialogueApi(draft);
    if(!validAddress(api.baseUrl)){setError('请先填写有效的 HTTP / HTTPS API 地址，或选择已有预设');return;}
    invalidate();const current=version.current,controller=new AbortController();request.current=controller;setLoading(true);setError('');setStatus('');
    try{
      const response=await fetchLlm(`${api.baseUrl}/models`,{signal:controller.signal,headers:{Authorization:`Bearer ${api.apiKey||'sk-none'}`}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const next=extractModelIds(await response.json());if(current!==version.current)return;
      setModels(next);setPickerModel(api.model||next[0]||'');setPicker(true);
      setStatus(next.length?`已获取 ${next.length} 个模型`:'接口没有返回模型，可手动填写名称');
    }catch(e){if(current===version.current&&!controller.signal.aborted)setError(`拉取失败：${e instanceof Error?e.message:'请检查接口'}，也可以手动填写模型。`);}
    finally{if(current===version.current){setLoading(false);request.current=undefined;}}
  };
  const save=async(reset=false)=>{
    if(saving)return;
    const api=pickDialogueApi(draft);
    if(!reset&&(!validAddress(api.baseUrl)||!api.model)){setError('请填写有效的 HTTP / HTTPS API 地址和模型名称');return;}
    invalidate();setLoading(false);setSaving(true);setError('');
    try{await onSave(reset?undefined:api);setOpen(false);setPicker(false);}catch(e){setError(e instanceof Error?e.message:'保存失败，请重试');}finally{setSaving(false);}
  };
  const active=findActivePresetId(presets,draft),Icon=kind==='moments'?ChatsCircle:PaperPlaneTilt;
  return <section className={`sully-background-api sully-background-api--${kind}`} aria-label={title}>
    <button type="button" className="sully-background-api__summary" aria-expanded={open} aria-controls={id} disabled={saving} onClick={()=>open?close():begin()}>
      <span className="sully-background-api__icon"><Icon size={20} weight="duotone"/></span>
      <span className="sully-background-api__heading"><span className="sully-background-api__title-row"><span className="sully-background-api__title">{title}</span><span className={`sully-background-api__badge ${value?.baseUrl?'is-configured':''}`}>{value?.baseUrl?'已配置':'跟随角色'}</span></span>{value?.baseUrl&&<span className="sully-background-api__model" title={value.model}>{value.model}</span>}</span>
      <CaretDown size={14} className={`sully-background-api__chevron ${open?'is-open':''}`}/>
    </button>
    {open&&<div id={id} className="sully-background-api__body">
      <p className="sully-background-api__help">{help}</p>
      <fieldset disabled={saving} className="sully-background-api__fields">
        <button type="button" className="sully-background-api__preset-trigger" aria-expanded={showPresets} onClick={()=>setShowPresets(v=>!v)}><Stack size={17}/><span>选择已有预设</span><small>{presets.length?`${presets.length} 份`:'暂无预设'}</small><CaretDown size={12}/></button>
        {showPresets&&<div className="sully-background-api__presets">{presets.length?<><ApiPresetGroups presets={presets}>{preset=><button key={preset.id} type="button" aria-pressed={active===preset.id} className={`sully-background-api__preset ${active===preset.id?'is-selected':''}`} onClick={()=>{change(pickDialogueApi(configFromPreset(preset)),true);setShowPresets(false);setStatus(`已载入「${preset.name}」，保存后生效`);}}>{preset.name}</button>}</ApiPresetGroups><p>载入一份配置副本，不会修改原预设。</p></>:<p>可以先在系统设置的「API 配置」中新建预设，也可以在下方直接填写。</p>}</div>}
        <label>接口类型<select aria-label="接口类型" value={llmApiType(draft)} onChange={e=>change({apiType:e.target.value as 'openai'|'anthropic'|'gemini'})}><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic 原生</option><option value="gemini">Gemini 原生（自动缓存）</option></select></label>
        <label>API 地址<input type="url" value={draft.baseUrl} onChange={e=>change({baseUrl:e.target.value})} placeholder="https://example.com/v1" autoCapitalize="none" spellCheck={false}/></label>
        <label>API Key<input type="password" value={draft.apiKey} onChange={e=>change({apiKey:e.target.value})} placeholder="填写该接口的 Key" autoCapitalize="none" spellCheck={false}/></label>
        <div className="sully-background-api__model-heading"><span>模型</span><button type="button" disabled={loading} onClick={()=>void fetchModels()}><ArrowClockwise size={13} className={loading?'animate-spin':''}/>{loading?'正在拉取…':'拉取模型'}</button></div>
        <button type="button" className="sully-background-api__model-picker" onClick={()=>{invalidate();setLoading(false);setPickerModel(draft.model);setPicker(true);}} title={draft.model||'选择或手动填写模型'}><span>{draft.model||'选择或手动填写模型'}</span><CaretDown size={14}/></button>
      </fieldset>
      {status&&<p role="status" className="sully-background-api__status">{status}</p>}
      {error&&<p role="alert" className="sully-background-api__error">{error}</p>}
      <div className="sully-background-api__actions"><button type="button" disabled={saving} onClick={close}>取消</button><button type="button" className="is-primary" disabled={saving||loading} onClick={()=>void save()}>{saving?'保存中…':'保存配置'}</button></div>
      {value?.baseUrl&&<button type="button" className="sully-background-api__reset" disabled={saving} onClick={()=>void save(true)}>恢复跟随角色 API</button>}
    </div>}
    <Modal portal isOpen={open&&picker} title={`${title} · 选择模型`} onClose={()=>setPicker(false)}>
      <ModelPicker availableModels={models} localModel={pickerModel} setLocalModel={setPickerModel} confirmModelPicker={model=>{change({model});setPicker(false);}}/>
    </Modal>
  </section>;
};
