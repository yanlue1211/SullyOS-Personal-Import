import { drainWorkroomOutbox } from './delivery';
import { WorkroomStorage } from './storage';
import { cloneWorkroomState, validText } from './schema';
import {readRuntimeRequest} from './runtimeProtocol';
import { readWorkroomRpc } from './runner';

/** Revocable capability: identity comes from the host, never from RPC arguments. */
export function createWorkroomHost(charId: string, workId: string, versionId: string, session: string,
    callbacks: { onNotify?: (text: string) => void; onError?: (text: string) => void; onStop?: () => void; onReady?: () => void; onEvent?: (text:string) => void; onGenerate?: (request:unknown,requestId:string,signal:AbortSignal)=>Promise<unknown> } = {}, preview = false) {
    const generationAbort=new AbortController();
    let previewData:unknown = {};
    let previewRevision = 1;
    let active = true;
    let port: MessagePort | undefined;
    let stateRevision: number | undefined;
    let queue = Promise.resolve();
    let highestRequest = 0;
    let lastPublicEvent = '';
    let lastPublicAt = 0;
    const inFlight = new Set<string>();
    const replies = new Map<string, unknown>();
    const respond = (id: string, reply: unknown) => {
        inFlight.delete(id); replies.set(id, reply);
        if (replies.size > 256) replies.delete(replies.keys().next().value!);
        if (active) port?.postMessage(reply);
    };
    let windowStart = performance.now();
    let count = 0;
    const dispose = () => { active = false; generationAbort.abort(new DOMException('组件已关闭','AbortError'));port?.close(); };
    return {
        close: dispose,
        bind(nextPort: MessagePort) {
            if (!active || port) { nextPort.close(); return; }
            port = nextPort;
            port.onmessage = event => {
                if (!active) return;
                const request = readWorkroomRpc(event.data);
                if (!request) { dispose(); callbacks.onStop?.(); return; }
                if (Number(request.id) <= highestRequest) {
                    if (replies.has(request.id)) port?.postMessage(replies.get(request.id));
                    else if (!inFlight.has(request.id)) port?.postMessage({ id: request.id, ok: false, error: '请求已过期' });
                    return;
                }
                highestRequest = Number(request.id); inFlight.add(request.id);
                if (performance.now() - windowStart > 10000) { windowStart = performance.now(); count = 0; }
                if (++count > 60) { dispose(); callbacks.onStop?.(); return; }
                queue = queue.then(async () => {
                    if (!active) return;
                    try {
                        let result: unknown;
                        const args = request.args;
                        if(request.method==='generate'){
                            if(preview||!callbacks.onGenerate)throw Error('请在正式作品中开启运行时AI后使用');
                            const task=readRuntimeRequest(args[0]);result=await callbacks.onGenerate(task,session+'-'+request.id,generationAbort.signal);
                        } else if (request.method === 'loadState') {
                            const state = preview ? {revision:previewRevision,data:previewData} : await WorkroomStorage.loadState(charId, workId, versionId);
                            stateRevision = state.revision; result = state.data;
                        } else if (request.method === 'saveState') {
                            if (stateRevision === undefined) throw Error('请先读取进度');
                            const state = preview ? (()=>{const data=cloneWorkroomState(args[0]);previewData=data;return {revision:++previewRevision,data};})() : await WorkroomStorage.saveState(charId, workId, versionId, stateRevision, args[0]);
                            stateRevision = state.revision; result = { revision: state.revision };
                        } else if (request.method === 'emitEvent') {
                            if (!validText(args[0], 2000) || !validText(args[1], 100)) throw Error('互动事件格式无效');
                            const description = String(args[0]);
                            // A component may report the same visible interaction more than once.
                            const isRepeat = description === lastPublicEvent && Date.now()-lastPublicAt < 1500;
                            if(!isRepeat){lastPublicEvent=description;lastPublicAt=Date.now();}
                            result = preview ? 'preview-'+request.id : isRepeat ? 'duplicate-'+request.id : (await WorkroomStorage.recordEvent(charId, workId, versionId, args[1], description)).id;
                            if(!preview && !isRepeat){await drainWorkroomOutbox(charId);if(active)callbacks.onEvent?.(description);}
                        } else {
                            if (!validText(args[0], 2000)) throw Error('组件说明无效');
                            if(request.method==='reportReady'){
                                if(active)callbacks.onReady?.();
                            } else if (request.method === 'requestUpdate') {
                                if(preview)throw Error('预览不创建开发任务，请先收藏独立副本');
                                await WorkroomStorage.recordDiagnostic(charId,workId,versionId,'update',args[0]);
                                result = (await WorkroomStorage.recordEvent(charId, workId, versionId, `update-${request.id}-${session}`,
                                    `作品提出修改请求（尚未执行）：${args[0]}`)).id;
                                await drainWorkroomOutbox(charId);
                            } else if (request.method === 'notify') {
                                if (active) callbacks.onNotify?.(args[0]);
                            } else {
                                if(!preview)await WorkroomStorage.recordDiagnostic(charId,workId,versionId,'error',args[0]);
                                if(active)callbacks.onError?.(args[0]);
                            }
                        }
                        respond(request.id, { id: request.id, ok: true, value: result });
                    } catch (error) {
                        respond(request.id, { id: request.id, ok: false, error: error instanceof Error ? error.message : '组件操作失败' });
                    }
                });
            };
        },
    };
}
