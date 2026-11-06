import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DB } from '../../utils/db';
import { isVisibleChatMessage } from '../../utils/chatMessageVisibility';

/**
 * User-controlled loopback link. No LLM API keys, character files, memory
 * database, or whole conversation history ever go to the deskpet.
 * Chat.tsx remains the ONLY chat generator.
 *
 * Prototype limitation: SullyOS Chat must stay mounted, and browser
 * background timers must not be suspended.
 */
type PetEvent = {id: string; text: string; at?: number};
type Reply = {ok?: boolean; error?: string; token?: string; events?: PetEvent[]};
type BridgeState = 'off' | 'connecting' | 'connected' | 'error';
const URL = 'http://127.0.0.1:18347';

async function call(path: string, token?: string, body?: unknown): Promise<Reply> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), path === '/watch' ? 17000 : 7000);
    try {
        const init: RequestInit & {targetAddressSpace?: string} = {
            method: body ? 'POST' : 'GET', mode: 'cors', cache: 'no-store',
            credentials: 'omit', targetAddressSpace: 'loopback',
            headers: body ? {
                'Content-Type':'application/json',
                ...(token ? {'X-TapNest-Token':token} : {})
            } : token ? {'X-TapNest-Token':token} : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: ctrl.signal,
        };
        const res = await fetch(URL+path, init);
        const data: Reply = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw Error(data.error || ('HTTP '+res.status));
        return data;
    } finally { clearTimeout(timer); }
}

type Props = {
    open: boolean;
    onClose: () => void;
    charId: string;
    charName: string;
    isTyping: boolean;
    onPetMessage: (text: string, id: string) => Promise<boolean>;
};

export default function TapNestLocalBridge({open,onClose,charId,charName,isTyping,onPetMessage}:Props) {
    const [state,setState] = useState<BridgeState>('off');
    const [info,setInfo] = useState('');
    const token = useRef('');
    const pending = useRef<{cursor: number; deadline: number; quietSince: number; gotReply: boolean}|null>(null);
    const busy = useRef(false);
    const alive = useRef(true);
    const onMessageRef = useRef(onPetMessage);
    const isTypingRef = useRef(isTyping);
    onMessageRef.current = onPetMessage;
    isTypingRef.current = isTyping;

    useEffect(() => {
        alive.current=true;
        return () => {
            alive.current=false;token.current='';
            pending.current=null;
        };
    },[charId]);

    const connect = useCallback(async () => {
        if (state === 'connecting') return;
        const pin=window.prompt('🐶 将桌宠绑定到「'+charName+'」\n运行 AutoJs6 V0.13 后，输入日志中的六位配对码：');
        if (!pin) return;
        if (!/^\d{6}$/.test(pin.trim())) {setInfo('配对码需要六位数字');setState('error');return;}
        setState('connecting');setInfo('正在连接本机 127.0.0.1…');
        try {
            // Must happen on user click so Chrome can ask loopback permission.
            await call('/health');
            const result=await call('/pair',undefined,{pin:pin.trim()});
            if (!result.token) throw Error('缺少配对令牌');
            token.current=result.token;pending.current=null;
            if (alive.current) {setState('connected');setInfo('已绑定 '+charName+' · 本机通信');}
        } catch(e) {
            if (alive.current) {setState('error');setInfo('连接失败：'+String(e));}
        }
    },[state,charName]);

    const disconnect=useCallback(() => {
        token.current='';pending.current=null;setState('off');setInfo('已断开');
    },[]);

    useEffect(() => {
        if (state!=='connected') return;
        let disposed=false;
        let timer:ReturnType<typeof setTimeout>|null=null;
        let running=false;
        const pollMs=() => document.visibilityState==='visible' ? 320 : 700;
        const pump=async () => {
            if (disposed || running || !token.current) return;
            running=true;
            try {
                const secret=token.current;
                if (!pending.current && !busy.current && !isTypingRef.current) {
                    const result=await call('/watch',secret);
                    const event=result.events?.find(e=>e && typeof e.id==='string' && typeof e.text==='string' && e.text.trim());
                    if (event && !disposed) {
                        busy.current=true;
                        try {
                            const before=await DB.getRecentMessagesByCharId(charId,8);
                            const cursor=before.reduce((n,m)=>Math.max(n,Number(m.id)||0),0);
                            const accepted=await onMessageRef.current(event.text.slice(0,300),event.id);
                            if (accepted) {
                                pending.current={cursor,deadline:Date.now()+90000,quietSince:0,gotReply:false};
                                await call('/ack',secret,{ids:[event.id]});
                                if (alive.current) {
                                    const elapsed = typeof event.at==='number' ? (Date.now()-event.at)/1000 : NaN;
                                    const latency = Number.isFinite(elapsed) && elapsed>=0 ? ' · 传输 '+elapsed.toFixed(1)+' 秒' : '';
                                    setInfo('已送达 '+charName+' 的原生聊天'+latency+'，等待角色回复');
                                }
                            }
                        } finally { busy.current=false; }
                    }
                }
                const stateNow=pending.current;
                if(stateNow) {
                    if(Date.now()>stateNow.deadline) {
                        pending.current=null;
                        if(alive.current) setInfo('等待回复超时，可检查聊天页');
                    } else {
                        const recent=await DB.getRecentMessagesByCharId(charId,60);
                        const replies=recent.filter(m=>Number(m.id)>stateNow.cursor
                            && m.role==='assistant' && m.type==='text'
                            && isVisibleChatMessage(m)).sort((a,b)=>a.id-b.id);
                        for (const m of replies.slice(0,8)) {
                            const answer=String(m.content||'').trim();
                            if (!answer) continue;
                            await call('/speech',secret,{text:answer.slice(0,1000)});
                            stateNow.cursor=Math.max(stateNow.cursor,Number(m.id));
                            stateNow.gotReply=true;
                            stateNow.quietSince=0;
                            if(alive.current) setInfo(charName+' 已回复桌宠 🐶');
                        }
                        if(!isTypingRef.current && stateNow.gotReply && !replies.length) {
                            if(!stateNow.quietSince)stateNow.quietSince=Date.now();
                            if(Date.now()-stateNow.quietSince>1800)pending.current=null;
                        }
                    }
                }
            } catch(e) {
                if(!disposed && alive.current){
                    setInfo('桥接暂时中断：'+String(e));
                    setState('error');token.current='';pending.current=null;
                }
            } finally {
                running=false;
                if(!disposed)timer=setTimeout(pump,pollMs());
            }
        };
        const wake=()=>{
            if(disposed || running || !token.current) return;
            if(timer) clearTimeout(timer);
            timer=setTimeout(pump,0);
        };
        document.addEventListener('visibilitychange',wake);
        window.addEventListener('focus',wake);
        timer=setTimeout(pump,100);
        return ()=>{
            disposed=true;
            if(timer)clearTimeout(timer);
            document.removeEventListener('visibilitychange',wake);
            window.removeEventListener('focus',wake);
        };
    },[state,charId,charName]);

    // The component remains mounted while the sheet is closed. Closing the UI
    // must not interrupt a paired pet or trigger chat reinitialization.
    if (!open) return null;
    return createPortal(
      <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/25" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
        <div role="dialog" aria-modal="true" aria-label="点点栖桌宠连接" className="mb-safe w-full max-w-md rounded-t-3xl border border-emerald-100 bg-white p-5 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <strong className="text-base text-emerald-800">🐶 点点栖 · {charName}</strong>
            <button type="button" className="rounded-full px-3 py-2 text-slate-500" onClick={onClose} aria-label="收起桌宠连接面板">收起</button>
          </div>
          <p className="mb-4 text-sm leading-relaxed text-slate-600">
            桌宠就是当前 Char 的桌面分身。角色回复由糯米机原生聊天生成，仍使用现有角色与记忆。
          </p>
          <button type="button" onClick={state==='connected'?disconnect:connect}
              disabled={state==='connecting'}
              className="w-full rounded-xl bg-emerald-100 px-4 py-3 font-semibold text-emerald-800 disabled:opacity-50"
              title="本机连接；不会导出原生记忆库">
              {state==='connected'?'断开桌宠连接':state==='connecting'?'正在连接…':'连接桌宠（输入配对码）'}
          </button>
          <p role="status" className="mt-3 break-words text-xs leading-relaxed text-slate-500">
            {info||'使用 AutoJs6 运行桌宠；双击输入；保持糯米机聊天页挂载。'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-700">
            当前为同机实验版：浏览器进入后台后可能暂停 JS，导致发送变慢。
          </p>
        </div>
      </div>,
      document.body
    );
}
