import React,{useState} from 'react';
import Modal from '../os/Modal';
import {inspectAllVoices,clearAllVoices,type VoiceCleanupPlan} from '../../utils/voiceCleanup';
import {formatBytes} from '../../utils/storageStats';
export default function VoiceCleanupPanel(){
 const [busy,setBusy]=useState(false),[plan,setPlan]=useState<VoiceCleanupPlan|null>(null),[result,setResult]=useState('');
 const inspect=async()=>{setBusy(true);setResult('');try{setPlan(await inspectAllVoices());}catch(e){setResult(String(e));}finally{setBusy(false);}};
 const clear=async()=>{if(!plan||busy)return;setBusy(true);try{const r=await clearAllVoices(plan);setPlan(null);setResult(`已清理 ${r.files} 项语音，释放约 ${formatBytes(r.freedBytes)}。${r.retainedFiles?`${r.retainedFiles} 个文件仍被其他内容引用，已保留。`:''}即将刷新页面。`);setTimeout(()=>window.location.reload(),2500);}catch(e){setResult(`清理未完成：${String(e)}。已清理部分不会自动恢复，请重新扫描。`);setPlan(null);}finally{setBusy(false);}};
 return <div className="mt-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
  <div className="text-xs font-bold text-slate-700">所有语音一键清理</div>
  <p className="text-xs text-slate-500 leading-relaxed mt-2">清理所有角色语音、用户录音、收藏语音、陪伴语音及月栖语音。保留文字、转写、语气、聊天和记忆；音乐与 BGM 保留。</p>
  <button disabled={busy} onClick={()=>void inspect()} className="mt-3 px-4 py-2 rounded-xl bg-white text-emerald-700 border border-emerald-200 text-xs font-bold disabled:opacity-50">{busy?'处理中…':'扫描并清理全部语音'}</button>
  {result&&<p role="status" className="mt-2 text-xs text-slate-600">{result}</p>}
  <Modal isOpen={!!plan} title="清理全部语音" onClose={()=>{if(!busy)setPlan(null);}} footer={<>
   <button disabled={busy} className="flex-1 py-3 rounded-xl bg-slate-100" onClick={()=>setPlan(null)}>取消</button>
   <button disabled={busy} className="flex-1 py-3 rounded-xl bg-rose-100 text-rose-700" onClick={()=>void clear()}>{busy?'清理中…':'确认清理全部语音'}</button>
  </>}>
   <p className="text-sm leading-relaxed">预计可清理约 {formatBytes(plan?.estimatedBytes??0)}。收藏语音和未转写录音也包含在内，原声音清理后无法补回；角色 TTS 日后点击时可以重新生成。请先结束正在进行的录音、通话和月栖播放。完成后页面会刷新。</p>
  </Modal>
 </div>;
}
