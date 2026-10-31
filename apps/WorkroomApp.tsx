import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { useLocalBackHandler } from '../hooks/useLocalBackHandler';
import WorkroomRunner from '../components/WorkroomRunner';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { drainWorkroomOutbox, WORKROOM_HISTORY_UPDATED } from '../features/workroom/delivery';
import { generateWorkroomReply } from '../features/workroom/creation';
import { listShares, shareWork, setIdeaStatus, readSharedWork } from '../features/workroom/collaboration';
import type { WorkroomShare } from '../features/workroom/schema';
import type { WorkroomShareSummary } from '../features/workroom/collaboration';
import { requestWorkroomCollection } from '../features/workroom/launch';
import { workroomLaunch } from '../features/workroom/launch';
import type { WorkroomCode, WorkroomTurn, WorkroomWork } from '../features/workroom/schema';

type Detail = Awaited<ReturnType<typeof W.get>>;
const blank: WorkroomCode = { html: '', css: '', js: '' };
const button = 'rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm disabled:opacity-40';
export default function WorkroomApp() {
    const os = useOS();
    const [charId, setCharId] = useState('');
    const [shares, setShares] = useState<WorkroomShareSummary[]>([]);
    const [previewShare,setPreviewShare]=useState<WorkroomShare|null>(null);
    const [recipient, setRecipient] = useState('');
    const shareRequest = useRef(crypto.randomUUID());
    const [works, setWorks] = useState<WorkroomWork[]>([]);
    const [workId, setWorkId] = useState('');
    const [detail, setDetail] = useState<Detail | null>(null);
    const [turns, setTurns] = useState<WorkroomTurn[]>([]);
    const [page, setPage] = useState<'talk' | 'run' | 'versions' | 'code'>('talk');
    const [input, setInput] = useState('');
    const [code, setCode] = useState<WorkroomCode>(blank);
    const [codeDirty, setCodeDirty] = useState(false);
    const dirty = useRef(false);
    const codeBase = useRef<{revision: number; versionId: string | null}>({revision: 0, versionId: null});
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [retry, setRetry] = useState<{ id: string; text: string } | null>(null);
    const [deleteCandidate, setDeleteCandidate] = useState(false);
    const abort = useRef<AbortController | null>(null);
    const scope = useRef('');
    const character = os.characters.find(char => char.id === charId);
    const version = detail?.versions.find(v => v.id === detail.work.currentVersionId);
    const cancel = () => { abort.current?.abort(new DOMException('已取消创作', 'AbortError')); abort.current = null; };
    const refresh = async (owner: string, selected: string) => {
        const expected = JSON.stringify([owner, selected]);
        const list = await W.list(owner);
        const incoming = await listShares(owner);
        const snapshot = selected ? await W.get(owner, selected) : null;
        const discussion = selected ? await W.turns(owner, selected) : [];
        if (scope.current !== expected) return;
        setWorks(list); setShares(incoming); setDetail(snapshot); setTurns(discussion);
        const last = discussion.at(-1);
        setRetry(last?.role === 'user' ? {id: last.id, text: last.text} : null);
        if (snapshot && !dirty.current) {
            const current = snapshot.versions.find(v => v.id === snapshot.work.currentVersionId);
            const source = snapshot.draft || current || blank;
            setCode({ html: source.html, css: source.css, js: source.js });
            codeBase.current = {revision: snapshot.draft?.revision || 0, versionId: snapshot.work.currentVersionId};
        }
    };
    const select = (owner: string, selected = '') => {
        cancel(); setPreviewShare(null); setRecipient(''); shareRequest.current=crypto.randomUUID(); dirty.current = false; setCodeDirty(false); scope.current = JSON.stringify([owner, selected]);
        setCharId(owner); setWorkId(selected); setWorks([]); setShares([]); setDetail(null); setTurns([]);
        setNotice(''); setBusy(false); setRetry(null); setPage('talk'); setDeleteCandidate(false); setInput('');
        if (owner) void refresh(owner, selected).catch(error => {
            if (scope.current === JSON.stringify([owner, selected])) setNotice(String(error));
        });
    };
    useEffect(() => {
        const consume = () => { const target = workroomLaunch.consume(); if (target) {select(target.charId, target.workId);if(target.shareId)void readSharedWork(target.charId,target.shareId).then(row=>{if(scope.current===JSON.stringify([target.charId,target.workId]))setPreviewShare(row);}).catch(error=>setNotice(String(error)));} };
        consume(); const unsubscribe = workroomLaunch.subscribe(consume);
        return () => { unsubscribe(); cancel(); scope.current = ''; };
    }, []);
    useLocalBackHandler(() => {
        if (previewShare) {setPreviewShare(null);return true;}
        if (deleteCandidate) { setDeleteCandidate(false); return true; }
        if (page !== 'talk') { setPage('talk'); return true; }
        if (workId) { select(charId); return true; }
        return false;
    }, 30);
    useEffect(() => {
        if (!charId) return;
        const changed = (event: Event) => {
            if ((event as CustomEvent).detail?.charId !== charId) return;
            const expected = scope.current;
            // An interaction does not change source code: do not reread every historical version.
            if (workId) void W.turns(charId, workId).then(rows => { if (scope.current === expected) setTurns(rows); }).catch(error => { if (scope.current === expected) setNotice(String(error)); });
            else void W.list(charId).then(rows => { if (scope.current === expected) setWorks(rows); }).catch(error => { if (scope.current === expected) setNotice(String(error)); });
        };
        window.addEventListener(WORKROOM_HISTORY_UPDATED, changed);
        return () => window.removeEventListener(WORKROOM_HISTORY_UPDATED, changed);
    }, [charId, workId]);
    const operate = async (task: () => Promise<void>) => {
        if (busy) return;
        const expected = scope.current; setBusy(true); setNotice('');
        try { await task(); }
        catch (error) { if (scope.current === expected) setNotice(error instanceof Error ? error.message : String(error)); }
        finally { if (scope.current === expected) setBusy(false); }
    };
    const create = () => operate(async () => {
        const owner = charId, expected = scope.current;
        const work = await W.create(owner, title.trim(), summary.trim());
        if (scope.current === expected) { setTitle(''); setSummary(''); select(owner, work.id); }
    });
    const send = (previous?: { id: string; text: string }) => operate(async () => {
        const owner = charId, selected = workId, expected = scope.current, text = previous?.text || input.trim();
        if (!text) return;
        const controller = new AbortController(); abort.current = controller; setRetry(null); setInput('');
        try {
            const result = await generateWorkroomReply({ charId: owner, workId: selected, text, retryTurnId: previous?.id,
                api: os.apiConfig, user: os.userProfile, signal: controller.signal,
                context: { realtimeConfig: os.realtimeConfig, groups: os.groups, emojis: [], categories: [] } });
            if (scope.current === expected) setNotice(result.savedDraft ? '新代码已保存为草稿，可以查看后保存版本运行。' : '交流已保存。');
        } catch (error) {
            if (scope.current === expected) {
                const latest = (await W.turns(owner, selected)).at(-1);
                if (latest?.role === 'user' && latest.text === text) setRetry({ id: latest.id, text });
                else setInput(text);
            }
            throw error;
        } finally {
            if (scope.current === expected) { abort.current = null; await refresh(owner, selected); }
        }
    });
    const saveDraft = () => operate(async () => {
        if (!detail) return;
        await W.saveDraft(charId, workId, code, codeBase.current.revision, codeBase.current.versionId);
        dirty.current = false; setCodeDirty(false);
        await refresh(charId, workId); setNotice('草稿已保存，正式版本未变。');
    });
    const publish = () => operate(async () => {
        if (!detail?.draft) return;
        const owner = charId, selected = workId;
        await W.publish(owner, selected, detail.draft.revision, version?.schemaVersion || 1);
        await drainWorkroomOutbox(owner); await refresh(owner, selected);
        if (scope.current === JSON.stringify([owner, selected])) { setPage('run'); setNotice('版本已保存，完成卡已写入聊天；现在可以实际体验。'); }
    });
    return <div className="h-full flex flex-col bg-[#fffaf0] text-stone-700" style={{ paddingTop: 'var(--chrome-top, 24px)' }}>
        <header className="px-5 py-4 border-b border-amber-100 flex items-center gap-3">
            <button type="button" aria-label="返回" onClick={() => previewShare ? setPreviewShare(null) : workId ? select(charId) : os.closeApp()} className="text-xl">‹</button>
            <div className="flex-1"><h1 className="text-lg font-semibold">🧸 造物间</h1><p className="text-xs text-stone-400">把小小的想法，慢慢做出来</p></div>
        </header>
        <div className="px-5 py-3 flex items-center gap-3 border-b border-amber-100">
            <label htmlFor="workroom-char" className="text-xs">当前创作者</label>
            <select id="workroom-char" value={charId} onChange={e => select(e.target.value)} className="min-w-0 flex-1 bg-white rounded-xl p-2 text-sm">
                <option value="">选择一位 Char</option>{os.characters.map(char => <option key={char.id} value={char.id}>{char.name}</option>)}
            </select>
        </div>
        {character && <label className="px-5 py-2 flex gap-2 items-center text-xs text-stone-500"><input type="checkbox" checked={character.workroomLinkEnabled === true} onChange={event => os.updateCharacter(charId, {workroomLinkEnabled: event.target.checked})}/>造物间联动（灵感、作品介绍、收藏和互动记录）</label>}
        {notice && <p role="status" className="mx-4 my-2 rounded-xl bg-amber-100/60 p-3 text-xs whitespace-pre-wrap">{notice}</p>}
        {!character ? <div className="m-auto p-8 text-center text-sm text-stone-400">选一位创作者，看看你们能一起做出什么。</div>
            : previewShare ? <main className="flex-1 min-h-0 flex flex-col"><div className="p-4 text-xs"><strong>{previewShare.snapshot.title}</strong><p>分享预览 · 原作者：{previewShare.snapshot.authorName}。预览进度仅保留本次，不产生聊天互动记录。</p></div><WorkroomRunner key={previewShare.id} charId={charId} preview version={{...previewShare.snapshot,id:'preview-'+previewShare.id,charId,workId:previewShare.id,number:1,createdAt:previewShare.createdAt}} onNotify={setNotice} onError={setNotice}/></main> : !workId ? <main className="flex-1 overflow-y-auto p-5 space-y-5">
                <section className="rounded-2xl bg-white p-4 border border-amber-100 space-y-3"><h2 className="font-medium">一个新的小想法</h2>
                    <input aria-label="作品名称" placeholder="给作品取个名字" value={title} onChange={e => setTitle(e.target.value)} maxLength={300} className="w-full bg-amber-50/60 rounded-xl p-3 text-sm"/>
                    <textarea aria-label="作品简介" placeholder="它可以做什么？写一句就好" value={summary} onChange={e => setSummary(e.target.value)} maxLength={2000} className="w-full bg-amber-50/60 rounded-xl p-3 text-sm"/>
                    <button className={button} disabled={busy || !title.trim() || !summary.trim()} onClick={create}>创建作品</button>
                </section>
                <section className="space-y-3"><h2 className="text-sm font-medium">{character.name} 的作品库 · {works.filter(w => !w.idea || w.idea.status === 'done').length}</h2>
                    {!works.length && <p className="text-xs text-stone-400">这里还空着，第一件作品会是什么呢？</p>}
                    {works.filter(w => !w.idea || w.idea.status === 'done').map(work => <button key={work.id} className="block w-full text-left rounded-2xl p-4 bg-white border border-amber-100" onClick={() => select(charId, work.id)}>
                        <strong className="text-sm">{work.title}</strong><p className="text-xs opacity-60 mt-1">{work.summary}</p><span className="text-xs text-amber-700">{work.currentVersionId ? '打开作品 ↗' : '继续创作 →'}</span>
                    </button>)}
                </section>
                <section className="space-y-3"><h2 className="text-sm font-medium">💡 灵感箱</h2>{works.filter(w => w.idea && w.idea.status !== 'done').map(work => <div key={work.id} className="p-4 rounded-2xl bg-white border border-amber-100"><strong>{work.title}</strong><p className="text-xs my-2">{work.summary} · {work.idea?.status === 'shelved' ? '已搁置' : '待创作'}</p><button className={button} onClick={() => select(charId,work.id)}>继续讨论</button><button className={button} disabled={busy} onClick={() => operate(async()=>{await setIdeaStatus(charId,work.id,work.idea?.status === 'shelved' ? 'open' : 'shelved');await refresh(charId,'');})}>{work.idea?.status === 'shelved' ? '重新打开' : '暂时搁置'}</button></div>)}</section>
                <section className="space-y-3"><h2 className="text-sm font-medium">📤 收到的分享</h2>{shares.map(share => <div key={share.id} className="p-4 rounded-2xl bg-white border border-amber-100"><strong>{share.snapshot.title}</strong><p className="text-xs my-2">{share.snapshot.summary} · 原作者：{share.snapshot.authorName}</p><button className={button} disabled={busy} onClick={()=>operate(async()=>{const expected=scope.current;const row=await readSharedWork(charId,share.id);if(scope.current===expected)setPreviewShare(row);})}>打开看看</button>{share.acceptedWorkId ? <button className={button} onClick={() => select(charId,share.acceptedWorkId!)}>打开已收藏副本</button> : <button className={button} disabled={!character.workroomLinkEnabled} onClick={() => requestWorkroomCollection(charId,share.id)}>询问 TA 是否收藏</button>}</div>)}</section>
            </main> : !detail ? <div className="p-6 text-sm">正在读取作品…</div> : <>
                <div className="px-5 pt-3"><h2 className="font-medium truncate">{detail.work.title}</h2><p className="text-xs opacity-60">{detail.work.summary}{detail.work.source && ` · 原作者：${detail.work.source.authorName}`}</p></div>
                <nav className="flex gap-2 px-4 py-3 overflow-x-auto shrink-0" aria-label="作品页面">
                    {([['talk', '创作交流'], ['run', '体验作品'], ['versions', '版本管理'], ['code', '代码草稿']] as const).map(([id, label]) =>
                        <button key={id} className={`${button} whitespace-nowrap ${page === id ? 'bg-amber-100' : ''}`} onClick={() => { setDeleteCandidate(false); setPage(id); }}>{label}</button>)}
                </nav>
                {page === 'run' ? <div className="flex-1 min-h-0 bg-white">{version ? <WorkroomRunner key={`${charId}:${version.id}`} charId={charId} version={version} onNotify={setNotice} onError={error => setNotice('作品运行错误：' + error)}/> : <p className="p-5 text-sm">还没有正式版本，先和 TA 一起制作吧。</p>}</div>
                    : page === 'talk' ? <main className="flex-1 min-h-0 flex flex-col"><div className="flex-1 overflow-y-auto px-5 space-y-4 pb-4">
                        {!turns.length && <p className="text-xs text-stone-400 py-5">和 {character.name} 聊聊玩法、颜色，或者直接请 TA 开始制作。</p>}
                        {turns.map(turn => <div key={turn.id} className={`rounded-2xl p-3 text-sm whitespace-pre-wrap ${turn.role === 'user' ? 'bg-amber-100 ml-8' : 'bg-white mr-5'}`}><small className="block text-xs opacity-50 mb-1">{turn.role === 'user' ? os.userProfile.name : character.name}</small>{turn.text}</div>)}
                        {busy && <p className="text-xs opacity-50">正在一起想办法…</p>}
                    </div><div className="p-4 border-t border-amber-100 space-y-2">
                        {retry && <button className={button} disabled={busy} onClick={() => send(retry)}>重试上一条</button>}
                        <textarea aria-label="创作交流" value={input} onChange={e => setInput(e.target.value)} maxLength={12000} placeholder="想做什么，或者哪里想再改改？" className="w-full rounded-xl bg-white p-3 text-sm"/>
                        <div className="flex justify-end gap-2">{busy && <button className={button} onClick={cancel}>停止</button>}<button className={button} disabled={busy || !input.trim()} onClick={() => send()}>发送</button></div>
                    </div></main>
                        : page === 'code' ? <main className="flex-1 overflow-y-auto p-4 space-y-3">
                            <p className="text-xs opacity-60">草稿和正式版本分开保存。生成代码尚未经过实际运行验收。{codeDirty && ' 当前编辑尚未保存。'}</p><button className={button} disabled={busy} onClick={() => { dirty.current = false; setCodeDirty(false); void refresh(charId, workId).catch(error => setNotice(String(error))); }}>重新读取已保存草稿</button>
                            {(['html', 'css', 'js'] as const).map(key => <label key={key} className="block text-xs uppercase">{key}<textarea aria-label={`${key}源码`} value={code[key]} onChange={e => { dirty.current = true; setCodeDirty(true); setCode(old => ({ ...old, [key]: e.target.value })); }} className="block w-full h-40 font-mono rounded-xl p-3 mt-1 bg-white normal-case" spellCheck={false}/></label>)}
                            <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={saveDraft}>保存草稿</button><button className={button} disabled={busy || !detail.draft || codeDirty} onClick={publish}>保存版本并打开</button></div>
                        </main> : <main className="flex-1 overflow-y-auto p-5 space-y-3">
                            {detail.draft && <p className="rounded-xl bg-amber-100 p-3 text-xs">有尚未发布的草稿 · 修订 {detail.draft.revision}</p>}
                            {detail.versions.map(item => <div key={item.id} className="rounded-xl bg-white p-4 flex items-center justify-between"><span className="text-sm">第 {item.number} 版{item.id === version?.id && ' · 当前版本'}</span>{version && item.id !== version.id && <button className={button} disabled={busy} onClick={() => operate(async () => { await W.rollback(charId, workId, item.id, version.id); await refresh(charId, workId); setNotice('已回退，兼容的游戏进度保留。'); })}>回退</button>}</div>)}
                            {version && <div className="flex flex-wrap gap-2"><select aria-label="分享给哪位角色" value={recipient} onChange={e=>setRecipient(e.target.value)} className={button}><option value="">分享给…</option>{os.characters.filter(c=>c.id!==charId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button className={button} disabled={busy || !recipient} onClick={()=>operate(async()=>{const key=shareRequest.current;await shareWork(charId,workId,recipient,key);shareRequest.current=crypto.randomUUID();setNotice('分享卡已发送；是否收藏由接收角色决定。');})}>分享作品</button></div>}
                            <button className={`${button} text-red-700`} onClick={() => setDeleteCandidate(true)}>删除作品…</button>
                            {deleteCandidate && <div role="alert" className="rounded-xl bg-red-50 p-4 space-y-3 text-sm"><p>删除这个作品的代码、版本和进度？聊天里已经保存的经历会保留。</p><button disabled={busy} className={button} onClick={() => operate(async () => { const owner = charId, expected = scope.current; await W.delete(owner, workId); if (scope.current === expected) select(owner); })}>确认删除作品</button><button className={button} onClick={() => setDeleteCandidate(false)}>取消</button></div>}
                        </main>}
            </>}
    </div>;
}
