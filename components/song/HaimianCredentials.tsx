import React, { useState } from 'react';
import type { HaimianCredentials as Credentials } from '../../features/songwriting/production';
const STORAGE_KEY = 'songwriting:haimian-credentials:v1';
export function useHaimianCredentials() {
    const [credentials, setCredentials] = useState<Credentials>(() => {
        try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (typeof saved?.token === 'string' && typeof saved?.cookie === 'string') return saved;
        } catch {}
        return { token: '', cookie: '' };
    });
    const [message, setMessage] = useState('');
    const save = () => {
        try { if (!credentials.token.trim() || !credentials.cookie.trim()) throw Error('请先填写连接密钥与 Cookie');
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: credentials.token, cookie: credentials.cookie }));
            setMessage('已记住，下次进入会自动填入');
        } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败，请检查浏览器存储权限'); }
    };
    const clear = () => {
        try { localStorage.removeItem(STORAGE_KEY); setCredentials({ token: '', cookie: '' }); setMessage('已清除本机保存的凭证'); }
        catch { setMessage('清除失败，请检查浏览器存储权限'); }
    };
    return { credentials, setCredentials, message, save, clear };
}
export default function HaimianCredentials({ connection }: { connection: ReturnType<typeof useHaimianCredentials> }) {
    const { credentials, setCredentials, message, save, clear } = connection;
    return <><label>专用连接密钥<input type="password" autoComplete="off" value={credentials.token} onChange={e => setCredentials(c => ({ ...c, token: e.target.value }))}/></label>
    <label>海绵 Cookie<input type="password" autoComplete="off" value={credentials.cookie} onChange={e => setCredentials(c => ({ ...c, cookie: e.target.value }))}/></label>
    <p className="sw-note">可保存在当前浏览器，供专属歌声与海绵出歌共用。密码框只隐藏显示，本机保存不等于加密。</p>
    <div className="sw-actions"><button onClick={save}>记住连接凭证</button><button onClick={clear}>清除已存凭证</button></div>
    {message && <p role="status">{message}</p>}</>;
}
