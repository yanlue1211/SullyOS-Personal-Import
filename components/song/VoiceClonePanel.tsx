import React, { useEffect, useRef, useState } from 'react';
import { createVoiceClone, inspectVoiceClone, loadVoiceClone, mutateVoiceClone, type VoiceCloneRecord } from '../../features/songwriting/voiceClone';
export default function VoiceClonePanel({ charId, sample, script }: {
    charId: string;
    sample: Blob | null;
    script: string;
}) {
    const [token, setToken] = useState(''), [cookie, setCookie] = useState(''), [record, setRecord] = useState<VoiceCloneRecord | null>(null), [id, setId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const lock = useRef(false), active = useRef(true);
    useEffect(() => { active.current = true; void loadVoiceClone(charId).then(r => { if (active.current) {
        setRecord(r);
        if (r && ['processing', 'ready', 'failed'].includes(r.state))
            setId(r.id);
    } }).catch(() => setError('音色记录读取失败')); return () => { active.current = false; }; }, [charId]);
    const refresh = async () => { const r = await loadVoiceClone(charId); if (active.current) {
        setRecord(r);
        if (r && ['processing', 'ready', 'failed'].includes(r.state))
            setId(r.id);
    } };
    const run = async (fn: () => Promise<void>) => { if (lock.current)
        return; lock.current = true; setBusy(true); setError(''); try {
        await fn();
    }
    catch (e: any) {
        if (active.current)
            setError(e.message || '音色操作失败');
    }
    finally {
        await refresh().catch(() => { });
        lock.current = false;
        if (active.current)
            setBusy(false);
    } };
    const credentials = { token, cookie };
    return <div className="sw-production sw-clone"><div className="sw-production-step"><div className="sw-production-step-heading"><span>02</span><div><h4>上传朗读，创建音色</h4><p>直接发送音频文件，不经过外放录音。</p></div></div>
 <label>专用连接密钥<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)}/></label><label>海绵 Cookie<input type="password" autoComplete="off" value={cookie} onChange={e => setCookie(e.target.value)}/></label>
 <p className="sw-production-hint">只在本页内存使用。先试听上面的朗读，确认是你想要的角色声音，再上传一次。</p>
 <button className="sw-primary sw-production-submit" disabled={busy || !sample || !!record && record.state !== 'failed'} onClick={() => void run(async () => { if (!sample)
        return; if (!confirm('确认将这份角色朗读音频上传到海绵，创建一个音色？'))
        return; await createVoiceClone(charId, sample, script, credentials); })}>上传当前朗读，创建音色</button>
 {record && <p className="sw-note">{({ submitting: '正在提交；离开后请先核对官网', unknown: '提交结果待核对，暂不重复上传', processing: '音色处理中', ready: '音色已就绪，已绑定当前角色', failed: '处理失败，可检查素材后重新创建' })[record.state]}{['ready', 'processing', 'failed'].includes(record.state) && ` · ${record.id}`}</p>}
 </div><div className="sw-production-step"><div className="sw-production-step-heading"><span>03</span><div><h4>查询并使用音色</h4><p>已有音色也可填 ID 验证后绑定。</p></div></div>
 <label>海绵音色 ID<input inputMode="numeric" value={id} onChange={e => setId(e.target.value)} placeholder="提交成功后自动填入"/></label><button disabled={busy || !id.trim()} onClick={() => void run(async () => { await inspectVoiceClone(charId, id.trim(), credentials); })}>查询音色状态并绑定</button>
 {record && ['unknown', 'submitting'].includes(record.state) && <button disabled={busy} onClick={() => void run(async () => { if (!confirm('请先到海绵音色列表核对。确认本次没有创建出音色，再解除提交锁？'))
        return; await mutateVoiceClone(charId, old => { if (old?.id !== record.id)
        throw Error('任务已变化'); return { ...old, state: 'failed' }; }); })}>已核对官网，未受理本次上传</button>}
 {record?.state === 'ready' && <p className="sw-note">回到「海绵出歌」，读取音色列表后会优先选中这个音色。以后生成歌曲只用歌词和创作说明，不再上传朗读。</p>}
 {busy && <p role="status">正在处理，请稍等…</p>}{error && <div className="sw-error" role="alert">{error}</div>}</div></div>;
}
