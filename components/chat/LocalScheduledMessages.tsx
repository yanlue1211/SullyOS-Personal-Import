import React, { useEffect, useState } from 'react';
import { DB, type ScheduledMessage } from '../../utils/db';
import { LocalNotifications } from '@capacitor/local-notifications';

/** Local queue only; cloud 2.0 tasks keep their original management page. */
export default function LocalScheduledMessages({ charId }: { charId: string }) {
    const [open, setOpen] = useState(false);
    const [tasks, setTasks] = useState<ScheduledMessage[]>([]);
    const [error, setError] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [pending, setPending] = useState<string>();
    useEffect(() => {
        if (!open) return;
        let alive = true;
        setLoaded(false); setTasks([]); setError('');
        const refresh = async () => {
            try {
                const rows = await DB.getScheduledMessages(charId);
                if (alive) { setTasks(rows); setLoaded(true); setError(''); }
            } catch { if (alive) setError('暂时无法读取任务，请收起后重试。'); }
        };
        void refresh();
        const timer = window.setInterval(refresh, 5000);
        return () => { alive = false; window.clearInterval(timer); };
    }, [open, charId]);
    const cancel = async (task: ScheduledMessage) => {
        setPending(task.id); setError('');
        try {
            await DB.deleteScheduledMessage(task.id);
            setTasks(rows => rows.filter(row => row.id !== task.id));
            if (task.notificationId !== undefined) {
                try { await LocalNotifications.cancel({ notifications: [{ id: task.notificationId }] }); }
                catch { setError('消息已取消，但系统提醒未能移除。'); }
            }
        } catch { setError('取消失败，请重试。'); }
        finally { setPending(undefined); }
    };
    return <details className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-bold text-emerald-800">稍后联系 · 本地任务</summary>
        {open && <div className="mt-3 space-y-3">
            <p className="text-[11px] leading-relaxed text-slate-500">这里显示当前角色尚未发送的本地消息，需保持糯米机运行。云端任务请到主动消息 2.0 查看。时间按你的设备显示。</p>
            {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
            {!loaded && !error && <p className="text-xs text-slate-400">正在读取…</p>}
            {loaded && !tasks.length && <p className="py-2 text-xs text-slate-400">暂时没有待发消息</p>}
            {tasks.map(task => <article key={task.id} className="rounded-xl bg-white p-3 shadow-sm">
                <time className="text-[11px] font-semibold text-emerald-800">{new Date(task.dueAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                {task.dueAt <= Date.now() && <span className="ml-2 text-[10px] text-amber-700">已到时 · 等待发送</span>}
                <p className="my-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">{task.content}</p>
                <button type="button" disabled={!!pending} onClick={() => void cancel(task)} className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600 disabled:opacity-50">{pending === task.id ? '正在取消…' : '取消任务'}</button>
            </article>)}
            <p className="text-[10px] leading-relaxed text-slate-400">已开始发送的消息无法撤回；旧任务若留有系统通知，取消消息后该提醒仍可能出现。</p>
        </div>}
    </details>;
}
