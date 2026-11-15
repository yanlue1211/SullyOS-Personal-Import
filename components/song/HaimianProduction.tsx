import { useMusic } from '../../context/MusicContext';
import { addProducedSong } from '../../features/songwriting/musicLibrary';
import { fetchSongFile } from '../../features/songwriting/download';
import { shareOrDownloadBlob } from '../../utils/shareExport';
import { useHaimianCredentials } from './HaimianCredentials';
import { loadVoiceClone } from "../../features/songwriting/voiceClone";
import React, { useEffect, useRef, useState } from 'react';
import type { SongSheet } from '../../types';
import { useOS } from '../../context/OSContext';
import { getSong, mutateSong, writeTurn } from '../../features/songwriting/storage';
import { lyricsText } from '../../features/songwriting/model';
import { generateProductionText, productionFingerprint, haimianCall, type SongProduction } from '../../features/songwriting/production';
export default function HaimianProduction({ song, onUpdate }: {
    song: SongSheet;
    onUpdate: (s: SongSheet) => void;
}) {
    const [download, setDownload] = useState<{ taskId: string; blob: Blob; fileName: string } | null>(null);
    const os = useOS();
    const music = useMusic();
    const [localAudioUrl, setLocalAudioUrl] = useState('');
    useEffect(() => { if (!download) { setLocalAudioUrl(''); return; } const url = URL.createObjectURL(download.blob); setLocalAudioUrl(url); return () => URL.revokeObjectURL(url); }, [download]);
    const connection = useHaimianCredentials();
    const { credentials } = connection;
    const { token, cookie } = credentials;
    const [voicePicker, setVoicePicker] = useState(false), [confirmGeneration, setConfirmGeneration] = useState(false), [recoveryOpen, setRecoveryOpen] = useState(false), [recoveryId, setRecoveryId] = useState('');
    const [vision, setVision] = useState(song.production?.vision || ''), [prompt, setPrompt] = useState(song.production?.prompt || ''), [voice, setVoice] = useState(''), [voices, setVoices] = useState<{
        id: string;
        title: string;
    }[]>([]), [busy, setBusy] = useState(''), [error, setError] = useState(''), [info, setInfo] = useState('');
    const lock = useRef(false), controller = useRef<AbortController | null>(null), active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
    const task = song.production?.task;
    const run = async (label: string, fn: () => Promise<void>) => { if (lock.current)
        return; lock.current = true; setBusy(label); setError(''); try {
        await fn();
    }
    catch (e: any) {
        if (active.current)
            setError(e.message || '操作失败');
    }
    finally {
        lock.current = false;
        if (active.current)
            setBusy('');
    } };
    const update = async (fn: (s: SongSheet) => SongSheet) => { const result = await mutateSong(song.id, s => ({ song: fn(s) })); if (active.current)
        onUpdate(result); return result; };
    const save = async () => update(s => ({ ...s, production: { ...s.production, vision, prompt, basedOn: vision === (s.production?.vision || '') ? s.production?.basedOn : undefined } }));
    const generateText = (kind: 'vision' | 'prompt') => void run(kind === 'vision' ? '角色正在构思' : '正在整理创作说明', async () => {
        const current = await save();
        const base = productionFingerprint(current);
        controller.current = new AbortController();
        const result = await generateProductionText(current, { api: os.apiConfig, user: os.userProfile, context: { groups: os.groups || [], emojis: [], categories: [], realtimeConfig: os.realtimeConfig } }, controller.current.signal, kind);
        await update(s => { if (productionFingerprint(s) !== base)
            throw Error('歌曲已在其他页面更新，请重新整理'); return { ...s, production: { ...s.production, vision: kind === 'vision' ? result : vision, prompt: kind === 'prompt' ? result : prompt, basedOn: kind === 'prompt' ? base : undefined } }; });
        if (kind === 'vision') {
            setVision(result);
            await writeTurn(current, 'assistant', '这首歌的创作设想：\n' + result, crypto.randomUUID());
        }
        else
            setPrompt(result);
    });
    const submit = () => void run('正在提交海绵', async () => {
        if (!token.trim() || !cookie.trim())
            throw Error('请先填写海绵连接密钥与 Cookie');
        if (!voice || !prompt.trim() || !lyricsText(song.lines).trim())
            throw Error('请先选择音色，保存歌词并整理创作说明');
        const saved = await save();
        if (saved.production?.basedOn !== productionFingerprint(saved))
            throw Error('歌词、歌名或创作设想已有变化，请重新整理说明');
        const marker = crypto.randomUUID();
        await update(s => { if (s.production?.task && ['submitting', 'unknown', 'processing'].includes(s.production.task.state))
            throw Error('已有未确认或未完成任务，请先查询或到官网核对'); if (productionFingerprint(s) !== productionFingerprint(saved))
            throw Error('歌曲已变化，请重新整理'); return { ...s, production: { ...s.production!, taskHistory: [...(s.production?.taskHistory || []), ...(s.production?.task ? [s.production.task] : [])], task: { id: marker, state: 'submitting', lyrics: lyricsText(s.lines), prompt, title: s.title, voiceId: voice } } }; });
        const changeTask = async (patch: Partial<NonNullable<SongProduction['task']>>) => update(s => { if (s.production?.task?.id !== marker)
            throw Error('任务已变化'); return { ...s, production: { ...s.production, task: { ...s.production.task, ...patch } } }; });
        try {
            const d = await haimianCall('/music/original', credentials, { voiceId: voice, lyrics: lyricsText(saved.lines), prompt, title: saved.title, genre: 'Custom', confirmSpend: true });
            await changeTask({ id: d.songTaskId, state: 'processing' });
            setInfo(`已提交，扣除 ${d.deductedCredit ?? '待确认'} 积分，请查询进度。`);
        }
        catch (e) {
            await changeTask({ state: 'unknown' });
            throw e;
        }
    });
    const inspect = () => void run('正在查询进度', async () => { if (!task)
        return; const d = await haimianCall('/music/original-status', credentials, { songTaskId: task.id }); await update(s => { if (s.production?.task?.id !== task.id)
        throw Error('任务已变化'); return { ...s, production: { ...s.production, task: { ...s.production.task, state: d.state } } }; }); setInfo(`当前状态：${d.state === 'complete' ? '已完成' : d.state === 'failed' ? '失败' : '处理中'}，进度 ${d.progress ?? '待确认'}%`); });
    return <section className="sw-production"><div className="sw-production-intro"><span className="sw-production-kicker">海绵音乐 · 原创歌曲</span><h3>让这首歌，有自己的声音</h3><p>写下设想，整理说明，再交给海绵唱出来。</p></div>
 <div className="sw-production-step"><div className="sw-production-step-heading"><span>01</span><div><h4>创作设想</h4><p>你来写，也可以让角色发挥。</p></div></div>
 <label>想表达的话 · 曲风与情绪<textarea aria-label="自由创作设想" rows={5} value={vision} maxLength={3000} onChange={e => setVision(e.target.value)} placeholder="比如：轻快的民谣，想唱出对明天的期待。主歌轻轻说，副歌明亮一点…"/></label>
 <div className="sw-actions"><button disabled={!!busy} onClick={() => void run('保存创作设想', async () => { await save(); })}>保存设想</button><button disabled={!!busy} onClick={() => generateText('vision')}>让角色填写</button></div><p className="sw-production-hint">角色填写会调用当前角色的聊天模型。</p></div>
 <div className="sw-production-step"><div className="sw-production-step-heading"><span>02</span><div><h4>生成说明</h4><p>整理成音乐要求，歌词保持原样。</p></div></div><button className="sw-production-outline" disabled={!!busy || !song.lines.some(l => !l.isDraft)} onClick={() => generateText('prompt')}>整理海绵创作说明</button>
 <label>预览与修改<textarea aria-label="海绵创作说明" rows={6} value={prompt} maxLength={2000} onChange={e => setPrompt(e.target.value)}/></label>
 <details><summary>本次完整歌词（不会由整理步骤改写）</summary><pre>{lyricsText(song.lines) || '请先保存歌词'}</pre></details></div>
 <details className="sw-production-step sw-production-connection"><summary><span className="sw-production-number">03</span>海绵演唱音色</summary><p className="sw-production-hint">连接密钥与 Cookie 请在「总设置 → 海绵音乐」中统一管理。</p>
 <button disabled={!!busy} onClick={() => void run('读取积分与音色', async () => { const b = await haimianCall('/probe/balance', credentials); if (b.data?.status_code !== 0)
        throw Error('积分查询失败'); const v = await haimianCall('/probe/voices', credentials); if (v.data?.status_code !== 0)
        throw Error('音色查询失败'); const items = [...(v.data.data.voices || []), ...(v.data.data.campaign_voices || [])].filter((v: any) => v.status === 2); setVoices([...new Map(items.map((v: any) => [String(v.id), { id: String(v.id), title: v.title || String(v.id) }])).values()] as {
        id: string;
        title: string;
    }[]); const binding = await loadVoiceClone(song.collaboratorId); setVoice(previous => binding?.state === 'ready' && items.some((v:any)=>String(v.id)===binding.id) ? binding.id : items.some((v:any)=>String(v.id)===previous) ? previous : ''); setInfo('当前积分：' + b.data.data.total_balance); })}>读取积分与音色</button>
 <button type="button" aria-label="海绵演唱音色" aria-expanded={voicePicker} disabled={!!busy} onClick={() => setVoicePicker(v => !v)}>{voices.find(v => v.id === voice)?.title || '选择已有音色'} · 更换音色</button>
 {voicePicker && <div role="group" aria-label="可用音色列表">{voices.length ? voices.map(v => <button key={v.id} type="button" aria-pressed={voice === v.id} disabled={!!busy} onClick={() => { setVoice(v.id); setVoicePicker(false); }}>{v.title}{voice === v.id ? ' · 已选择' : ''}</button>) : <p>还没有可用音色，请先读取积分与音色。</p>}</div>}
 </details>
 <div className="sw-production-step"><div className="sw-production-step-heading"><span>04</span><div><h4>生成歌曲</h4><p>确认后生成一首，会消耗海绵积分。</p></div></div><button className="sw-primary sw-production-submit" disabled={!!busy || !!task && ['submitting', 'unknown', 'processing'].includes(task.state)} onClick={() => { setError(''); setConfirmGeneration(true); }}>确认消耗积分，生成一首</button>
 {confirmGeneration && <div className="sw-note" role="group" aria-label="生成歌曲确认"><p>确认使用「{voices.find(v => v.id === voice)?.title || '未选择音色'}」生成一首？会消耗海绵积分，提交后不自动重试。</p><button disabled={!!busy} onClick={() => { setConfirmGeneration(false); submit(); }}>确认提交生成</button><button disabled={!!busy} onClick={() => setConfirmGeneration(false)}>取消生成</button></div>}
 {task && <div className="sw-production-task"><p className="sw-note">任务：{task.id} · {({submitting:"正在提交",unknown:"待核对",processing:"生成中",complete:"已完成",failed:"失败"})[task.state]}</p>{['submitting', 'unknown'].includes(task.state) ? <><p>提交结果尚未确认，请先到海绵官网核对，勿重复生成。</p><button disabled={!!busy} onClick={() => { setRecoveryId(''); setRecoveryOpen(v => !v); }}>核对并恢复任务</button></> : <button disabled={!!busy} onClick={inspect}>查询一次进度</button>}
 {recoveryOpen && ['submitting', 'unknown'].includes(task.state) && <div className="sw-note"><label>官网任务 ID<input value={recoveryId} onChange={e => setRecoveryId(e.target.value)} placeholder="已有任务时填写"/></label><button disabled={!!busy || !recoveryId.trim()} onClick={() => void run('恢复任务', async () => { const id = recoveryId.trim(); if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw Error('任务 ID 格式无效'); await update(s => { if (s.production?.task?.id !== task.id) throw Error('任务已变化'); return { ...s, production: { ...s.production, task: { ...task, id, state: 'processing' } } }; }); setRecoveryOpen(false); })}>按 ID 恢复任务</button><p>仅在核对官网确定没有生成任务后，才解除提交锁。</p><button disabled={!!busy} onClick={() => void run('解除提交锁', async () => { await update(s => { if (s.production?.task?.id !== task.id) throw Error('任务已变化'); return { ...s, production: { ...s.production, taskHistory: [...(s.production?.taskHistory || []), { ...task, state: 'failed' }], task: undefined } }; }); setRecoveryOpen(false); })}>已核对官网未受理，解除锁定</button></div>}
 {task.state === 'complete' && <button disabled={!!busy} onClick={() => void run('获取成品音频', async () => { const d = await haimianCall('/music/original-download', credentials, { songTaskId: task.id }); const saved = await mutateSong(song.id, s => { if (s.production?.task?.id !== task.id)
            throw Error('任务已变化'); const recorded = s.production.task.completionRecorded; return { song: { ...s, production: { ...s.production, task: { ...s.production.task, mediaUrl: d.mediaUrl, completionRecorded: true } } }, ...(!recorded ? { card: { kind: 'completed' as const, songId: s.id, title: task.title, label: '歌曲完成', author: os.characters.find(c => c.id === s.collaboratorId)?.name || '创作伙伴', version: s.lyricRevisions?.length || 1, after: task.lyrics, at: Date.now(), audio: '海绵音乐' } } : {}) }; }); if (active.current)
            onUpdate(saved); })}>获取播放与下载地址</button>}
 {task.state === 'complete' && <><button disabled={!!busy} onClick={() => void run('加入歌单', async () => { const result = download?.taskId === task.id ? download : await fetchSongFile(task.id, credentials); if (active.current && download?.taskId !== task.id) setDownload({ taskId: task.id, blob: result.blob, fileName: (task.title || '原创歌曲').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '.' + ('extension' in result ? result.extension : 'mp3') }); const local = await addProducedSong({ taskId: task.id, title: task.title, charId: song.collaboratorId, artist: os.characters.find(c => c.id === song.collaboratorId)?.name || '创作伙伴', lyrics: task.lyrics, blob: result.blob }); music.addLocalSong(local); setInfo('已加入「一起写的歌」歌单，音频已保存到糯米机'); })}>一键加入我的歌单</button><button disabled={!!busy} onClick={() => void run('正在下载成品文件', async () => { const result = await fetchSongFile(task.id, credentials); if (active.current) setDownload({ taskId: task.id, blob: result.blob, fileName: (task.title || '原创歌曲').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '.' + result.extension }); })}>下载成品文件</button>{download?.taskId === task.id && <><p>文件已准备好，点击保存到本机。</p><button disabled={!!busy} onClick={() => void run('保存成品', async () => { await shareOrDownloadBlob({ blob: download.blob, fileName: download.fileName }); })}>保存成品到本机</button></>}</>}
 {task.mediaUrl && <><audio controls src={download?.taskId === task.id && localAudioUrl ? localAudioUrl : task.mediaUrl}/><a href={task.mediaUrl} target="_blank" rel="noreferrer">打开音频链接</a><p className="sw-note">链接会过期，可再次获取。旧任务使用提交时保存的歌词与说明。</p></>}</div>}
 </div>
 {!!song.production?.taskHistory?.length && <details><summary>历史生成任务（{song.production.taskHistory.length}）</summary>{song.production.taskHistory.map(t => <details key={t.id}><summary>{t.title} · {t.id} · {t.state}</summary><pre>{t.lyrics}</pre><p>{t.prompt}</p></details>)}</details>}
 {busy && <p role="status">{busy}…</p>}{info && <p>{info}</p>}{error && <div className="sw-error" role="alert">{error}</div>}
 </section>;
}
