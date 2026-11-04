import React, { useState } from 'react';
import Modal from '../../../components/os/Modal';
import type { CharacterProfile } from '../../../types';

type Preferences = Pick<CharacterProfile, 'innerVoiceEnabled' | 'innerVoiceContextEnabled' | 'innerVoiceMemoryEnabled' | 'innerVoiceCustomPrompt'>;
export default function InnerVoiceSettings({ character, onSave, onClose }: {
  character: CharacterProfile; onSave: (patch: Preferences) => void; onClose: () => void;
}) {
  const [value, setValue] = useState<Preferences>({
    innerVoiceEnabled: character.innerVoiceEnabled !== false,
    innerVoiceContextEnabled: character.innerVoiceContextEnabled !== false,
    innerVoiceMemoryEnabled: character.innerVoiceMemoryEnabled !== false,
    innerVoiceCustomPrompt: character.innerVoiceCustomPrompt || '',
  });
  const switches = [
    ['innerVoiceEnabled', '生成心声', '控制之后的回复是否生成心声，已有记录保留。'],
    ['innerVoiceContextEnabled', '历史心声进入上下文', '控制模型是否读取以前的心声，不影响保存和展示。'],
    ['innerVoiceMemoryEnabled', '心声参与记忆提取', '控制之后的记忆总结是否读取心声，已有记忆不自动改写。'],
  ] as const;
  return <Modal isOpen title="心声设置" onClose={onClose} footer={<button type="button" className="w-full rounded-2xl bg-primary py-3 font-bold text-white" onClick={() => { onSave(value); onClose(); }}>保存</button>}>
    <div className="space-y-5">
      {switches.map(([key, label, description]) => <label key={key} className="flex items-start justify-between gap-4">
        <span><span className="block text-sm font-bold text-slate-700">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-400">{description}</span></span>
        <input type="checkbox" className="mt-1 h-5 w-5 accent-emerald-500" checked={value[key] !== false} onChange={event => setValue(previous => ({...previous, [key]: event.target.checked}))} />
      </label>)}
      <label className="block text-sm font-bold text-slate-700">追加心声提示词
        <textarea className="mt-2 min-h-32 w-full resize-y rounded-xl bg-slate-100 p-3 text-sm font-normal focus:outline-primary" value={value.innerVoiceCustomPrompt} placeholder="例如：内心想法不超过80字，暗流没有就留空。" onChange={event => setValue(previous => ({...previous, innerVoiceCustomPrompt: event.target.value}))} />
      </label>
      <p className="text-xs leading-5 text-slate-400">仅对当前角色生效。关闭生成后仍保留其他设置；追加要求仅调整心声内容，输出格式由系统保留。</p>
    </div>
  </Modal>;
}
