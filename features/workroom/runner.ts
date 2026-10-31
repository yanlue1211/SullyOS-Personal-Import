import { assertCode, type WorkroomCode } from './schema';

export const WORKROOM_SANDBOX = 'allow-scripts';
export const WORKROOM_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const WORKROOM_RPC_METHODS = ['loadState', 'saveState', 'emitEvent', 'notify', 'requestUpdate', 'reportError', 'reportReady', 'generate'] as const;
export type WorkroomMethod = typeof WORKROOM_RPC_METHODS[number];
export interface WorkroomRpc { id: string; method: WorkroomMethod; args: unknown[] }
export function readWorkroomRpc(value: unknown): WorkroomRpc | undefined {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const v = value as Record<string, unknown>;
        if (typeof v.id !== 'string' || !/^[1-9][0-9]{0,9}$/.test(v.id)
            || !WORKROOM_RPC_METHODS.includes(v.method as WorkroomMethod) || !Array.isArray(v.args) || v.args.length > 2
            || JSON.stringify(value).length > 270_000) return;
        return { id: v.id, method: v.method as WorkroomMethod, args: v.args };
    } catch { return; }
}

/** A private capability port; no host database, credentials or model API enter this doc. */
export function buildWorkroomDocument(code: WorkroomCode, session: string): string {
    assertCode(code);
    const bootstrap = `(() => {
        const session = ${JSON.stringify(session).replace(/</g, '\\u003c')};
        let port; let sequence = 0; const pending = new Map(); const waiting = [];
        function call(method, ...args) {
            return new Promise((resolve, reject) => {
                if(pending.size >= 60) return reject(new Error('请求过多'));
                const id = String(++sequence);
                const timer = setTimeout(() => {pending.delete(id); reject(new Error('组件接口超时'));}, method==='generate'?180000:10000);
                pending.set(id, {resolve, reject, timer});
                const message = {id, method, args};
                if(port) port.postMessage(message); else waiting.push(message);
            });
        }
        const api = Object.freeze({
            loadState: () => call('loadState'), saveState: state => call('saveState', state),
            emitEvent: (detail, actionId) => call('emitEvent', detail, actionId || 'event-'+(++sequence)),
            generate: request => call('generate', request),
            notify: text => call('notify', text), requestUpdate: text => call('requestUpdate', text)
        });
        Object.defineProperty(window, 'workroom', {value: api, writable: false, configurable: false});
        function init(event) {
            if(event.source !== parent || event.data?.workroomSession !== session || !event.ports[0] || port) return;
            port = event.ports[0];
            port.onmessage = event => {
                const reply = event.data; const request = pending.get(reply?.id); if(!request) return;
                pending.delete(reply.id); clearTimeout(request.timer);
                if(reply.ok) request.resolve(reply.value); else request.reject(new Error(reply.error || '接口失败'));
            };
            window.removeEventListener('message', init);
            waiting.splice(0).forEach(message => port.postMessage(message));
        }
        window.addEventListener('message', init);
        window.addEventListener('DOMContentLoaded', () => {void call('reportReady','ready').catch(()=>{});}, {once:true});
        window.addEventListener('error', event => {void call('reportError', String(event.message).slice(0,2000)).catch(()=>{});});
        window.addEventListener('unhandledrejection', event => {void call('reportError', String(event.reason).slice(0,2000)).catch(()=>{});});
    })();`;
    return '<!doctype html><html><head><meta charset="utf-8">'
        + `<meta http-equiv="Content-Security-Policy" content="${WORKROOM_CSP}">`
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + `<script>${bootstrap}</script><style>html,body{margin:0;min-height:100%;font-family:system-ui}*{box-sizing:border-box}</style>`
        + `<style>${code.css}</style></head><body>${code.html}<script>${code.js}</script></body></html>`;
}
