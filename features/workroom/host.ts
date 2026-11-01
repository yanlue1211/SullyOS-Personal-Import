import {DB} from '../../utils/db';
import {gameNarration,ensureGameStarted} from './narration';
import {readGameActions,type GameAction} from './actions';
import { drainWorkroomOutbox } from './delivery';
import { WorkroomStorage } from './storage';
import { cloneWorkroomState, validText } from './schema';
import {readRuntimeRequest} from './runtimeProtocol';
import { readWorkroomRpc } from './runner';

/** Revocable capability: identity comes from the host, never from RPC arguments. */
export function createWorkroomHost(charId: string, workId: string, versionId: string, session: string,
    callbacks: { userName?:string; onActions?: (actions:GameAction[])=>void; onNotify?: (text: string) => void; onError?: (text: string) => void; onStop?: () => void; onReady?: () => void; onGenerateError?: (error:unknown)=>void; onEvent?: (text:string) => void; onGenerate?: (request:unknown,requestId:string,signal:AbortSignal)=>Promise<unknown> } = {}, preview = false) {
    const generationAbort=new AbortController();
    let previewData:unknown = {};
    let previewRevision = 1;
    let active = true;
    let port: MessagePort | undefined;
    let stateRevision: number | undefined;
    let queue = Promise.resolve();
    let highestRequest = 0;
    let declaredActions:GameAction[]=[];
    let characterAction:{id:string;events:string[]}|undefined;
    let batchSequence=0;
    let userEvents:{id:string;details:string[]}|undefined;
    let flushTimer:ReturnType<typeof setTimeout>|undefined;
    const persist=async(id:string,details:string[],actor:'user'|'char')=>{if(preview||!details.length)return;const char=await DB.getCharacter(charId);if(!char)return;const name=actor==='char'?char.name:(callbacks.userName||'用户');const text=gameNarration(name,details,char.name,callbacks.userName||'用户');await ensureGameStarted(charId,workId,versionId,callbacks.userName);await WorkroomStorage.recordEvent(charId,workId,versionId,id,text,{actor,userName:callbacks.userName||'用户'});await drainWorkroomOutbox(charId);if(active)callbacks.onEvent?.(text);};
    const flushUser=async()=>{clearTimeout(flushTimer);const batch=userEvents;userEvents=undefined;if(batch)await persist(batch.id,batch.details,'user');};
    const seenEvents=new Set<string>();
    const inFlight = new Set<string>();
    const replies = new Map<string, unknown>();
    const respond = (id: string, reply: unknown) => {
        inFlight.delete(id); replies.set(id, reply);
        if (replies.size > 256) replies.delete(replies.keys().next().value!);
        if (active) port?.postMessage(reply);
    };
    let windowStart = performance.now();
    let count = 0;
    const dispose = () => { clearTimeout(flushTimer);void flushUser().catch(()=>{});const action=characterAction;characterAction=undefined;if(action?.events.length)void persist(action.id,action.events,'char').catch(()=>{});active = false; generationAbort.abort(new DOMException('组件已关闭','AbortError'));port?.close(); };
    return {
        close: dispose,
        characterPlay(){if(active&&!preview&&!characterAction&&declaredActions.length){void flushUser().catch(e=>callbacks.onError?.(String(e)));characterAction={id:'char-'+session+'-'+crypto.randomUUID(),events:[]};port?.postMessage({event:'characterPlay'});}},
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
                        if(request.method==='registerActions'){const actions=readGameActions(args[0]);declaredActions=actions;if(!preview)callbacks.onActions?.(actions);result=true;
                        } else if(request.method==='finishCharacterAction'){
                            const action=characterAction;if(!action)throw Error('没有待完成的角色动作');const value=args[0] as any;
                            if(!value||typeof value.actionId!=='string'||typeof value.reply!=='string'||value.reply.length>1000)throw Error('角色动作结果无效');
                            const selected=declaredActions.find(a=>a.id===value.actionId);if(value.actionId!=='none'&&!selected)throw Error('角色动作无效');
                            if(selected&&!action.events.length&&value.failed!==true)action.events.push('执行了「'+selected.label+'」。');
                            if(selected&&value.reply&&value.failed!==true)action.events.push('公开回应：'+value.reply);
                            characterAction=undefined;await persist(action.id,action.events,'char');result=true;
                        } else if(request.method==='generate'){
                            if(preview||!callbacks.onGenerate)throw Error('请在正式作品中开启运行时AI后使用');
                            const task=readRuntimeRequest(args[0]);task.companion=false;if(characterAction){task.publicEvent=undefined;task.companion=false;}result=await callbacks.onGenerate(task,session+'-'+request.id,generationAbort.signal);
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
                            const eventKey=JSON.stringify([characterAction?.id||'user',args[1],description]);
                            const isRepeat=seenEvents.has(eventKey);
                            if(!isRepeat){seenEvents.add(eventKey);if(seenEvents.size>256)seenEvents.delete(seenEvents.values().next().value!);}
                            if(!preview&&!isRepeat){
                                await WorkroomStorage.recordEvent(charId,workId,versionId,'raw-'+session+'-'+request.id,description,{actor:characterAction?'char':'user',userName:callbacks.userName||'用户',raw:true});
                                if(!active){respond(request.id,{id:request.id,ok:true,value:'saved-local'});return;}
                                if(characterAction)characterAction.events.push(description);
                                else{if(!userEvents)userEvents={id:'user-'+session+'-'+(++batchSequence),details:[]};userEvents.details.push(description);clearTimeout(flushTimer);flushTimer=setTimeout(()=>{queue=queue.then(flushUser).catch(e=>callbacks.onError?.(String(e)));},250);}
                            }
                            result=preview?'preview-'+request.id:isRepeat?'duplicate-'+request.id:'queued-'+request.id;
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
                        if(active&&request.method==='generate'&&!generationAbort.signal.aborted)callbacks.onGenerateError?.(error);
                        respond(request.id, { id: request.id, ok: false, error: error instanceof Error ? error.message : '组件操作失败' });
                    }
                });
            };
        },
    };
}
