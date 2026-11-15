import React from 'react';
import { useHaimianCredentials } from '../song/HaimianCredentials';

/** Haimian is an independent music service; keep its credentials out of dialogue API settings. */
export default function HaimianMusicSettings() {
    const { credentials, setCredentials, message, save, clear } = useHaimianCredentials();
    const fieldClass = 'w-full bg-white/60 border border-slate-200/70 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all';
    return (
        <section className="rounded-2xl border border-emerald-200/60 bg-emerald-50/35 p-3.5 space-y-2.5">
            <div>
                <h3 className="text-xs font-bold text-emerald-800">海绵音乐 · 连接设置</h3>
                <p className="text-[11px] text-slate-500 mt-1">写歌的「海绵出歌」和「专属歌声」共用这里的连接信息，原有已保存的凭证会自动读取。</p>
            </div>
            <label className="block text-[11px] text-slate-600">
                专用 Worker 连接密钥
                <input type="password" autoComplete="off" spellCheck={false} className={fieldClass + ' mt-1'} value={credentials.token} onChange={event => setCredentials(old => ({ ...old, token: event.target.value }))} />
            </label>
            <label className="block text-[11px] text-slate-600">
                海绵 Cookie
                <input type="password" autoComplete="off" spellCheck={false} className={fieldClass + ' mt-1'} value={credentials.cookie} onChange={event => setCredentials(old => ({ ...old, cookie: event.target.value }))} />
            </label>
            <p className="text-[10px] text-slate-500 leading-relaxed">凭证仅保存到当前浏览器的本地存储，并非加密保管；不会提交到 GitHub 或写入歌曲、聊天记录。仅在个人可信设备上保存。</p>
            <div className="flex gap-2">
                <button type="button" onClick={save} className="flex-1 rounded-xl bg-emerald-700 text-white text-xs py-2.5">保存海绵连接</button>
                <button type="button" onClick={clear} className="rounded-xl border border-slate-200 bg-white/70 text-slate-600 text-xs px-3 py-2.5">清除</button>
            </div>
            {message && <p role="status" className="text-[11px] text-emerald-800">{message}</p>}
        </section>
    );
}
