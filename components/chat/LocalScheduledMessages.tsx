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
        // 旧功能已退役：仅在确有未完成的历史任务时才展示取消入口。
        // 首次展开设置时只读本地数据库，不轮询；点开后才每 5 秒刷新。
        let alive = true;
        setLoaded(false); setTasks([]); setError('');
        const refresh = async () => {
            try {
                const rows = await DB.getScheduledMessages(charId);
                if (alive) { setTasks(rows); setLoaded(true); setError(''); }
            } catch { if (alive) setError('暂时无法读取任务，请收起后重试。'); }
        };
        void refresh();
        const timer = open ? window.setInterval(refresh, 5000) : undefined;
        return () => { alive = false; if (timer !== undefined) window.clearInterval(timer); };
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
    // 空队列不再留一块历史功能的空设置；失败仍给用户恢复入口。
    if (!error && (!loaded || tasks.length === 0)) return null;
    return <details className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-bold text-emerald-800">历史本地待发消息 · 仅管理旧任务</summary>
        {open && <div className="mt-3 space-y-3">
            <p className="text-[11px] leading-relaxed text-slate-500">旧版本地预约已停用，不会创建新任务。这里仅保留过去已经安排、尚未发送的消息，等待原有投递或由你取消；云端预约请前往聊天加号里的「预约消息」。</p>
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
