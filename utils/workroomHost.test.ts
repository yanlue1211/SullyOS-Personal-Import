import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { createWorkroomHost } from '../features/workroom/host';
import { WORKROOM_STORES, transactionDone } from '../features/workroom/schema';

beforeEach(async () => {
    const db = await openDB();
    const tx = db.transaction(['characters', ...WORKROOM_STORES], 'readwrite');
    const done = transactionDone(tx);
    for (const name of WORKROOM_STORES) tx.objectStore(name).clear();
    tx.objectStore('characters').put({ id: 'runner-char', name: '阿源' });
    await done;
});
async function harness() {
    const work = await W.create('runner-char', '小狗', '饲养小狗');
    await W.saveDraft('runner-char', work.id, { html: '<p>小狗</p>', css: '', js: '' }, 0, null);
    const version = await W.publish('runner-char', work.id, 1);
    const replies: any[] = [];
    const close = vi.fn();
    const onStop = vi.fn(); const onNotify = vi.fn();
    const port = { onmessage: undefined as any, close, postMessage: (reply: unknown) => replies.push(reply) };
    const host = createWorkroomHost('runner-char', work.id, version.id, 'session', { onStop, onNotify });
    host.bind(port as unknown as MessagePort);
    const send = (id: number, method: string, args: unknown[] = []) => port.onmessage({ data: { id: String(id), method, args } });
    const wait = async (id: number) => { await vi.waitFor(() => expect(replies.some(r => r.id === String(id))).toBe(true)); return replies.find(r => r.id === String(id)); };
    return { work, version, host, send, wait, replies, close, onStop, onNotify };
}

describe('沙盒宿主与真实 IndexedDB 联通', () => {
    it('通过受控接口读取、写入和重新读取进度，重复请求不重复执行', async () => {
        const h = await harness();
        h.send(1, 'loadState'); expect((await h.wait(1)).value).toEqual({});
        h.send(2, 'saveState', [{ level: 4 }]); h.send(2, 'saveState', [{ level: 99 }]);
        expect((await h.wait(2)).ok).toBe(true);
        h.send(3, 'loadState'); expect((await h.wait(3)).value).toEqual({ level: 4 });
        expect((await W.loadState('runner-char', h.work.id, h.version.id)).revision).toBe(2);
        h.host.close();
    });
    it('未读进度不能盲写；未知数据库/模型接口撤销端口', async () => {
        const h = await harness();
        h.send(1, 'saveState', [{ level: 3 }]); expect((await h.wait(1)).ok).toBe(false);
        h.send(2, 'getAllCharacters');
        expect(h.close).toHaveBeenCalled(); expect(h.onStop).toHaveBeenCalled();
        h.send(3, 'notify', ['越权后不能通知']);
        await Promise.resolve(); expect(h.onNotify).not.toHaveBeenCalled();
    });
    it('端口撤销后排队请求不再调用存储或通知', async () => {
        const h = await harness();
        h.send(1, 'loadState'); h.send(2, 'saveState', [{ level: 9 }]); h.send(3, 'notify', ['不应出现']);
        h.host.close();
        await Promise.resolve(); await Promise.resolve();
        expect((await W.loadState('runner-char', h.work.id, h.version.id)).data).toEqual({});
        expect(h.onNotify).not.toHaveBeenCalled();
    });
    it('运行错误和通知不冒充作品发布；互动只记本作品本地事件', async () => {
        const h = await harness();
        h.send(1, 'emitEvent', ['小狗升到三级', 'feed-1']); expect((await h.wait(1)).ok).toBe(true);
        h.send(2, 'requestUpdate', ['增加散步']); expect((await h.wait(2)).ok).toBe(true);
        h.send(3, 'notify', ['小狗想你了']); await h.wait(3);
        expect(h.onNotify).toHaveBeenCalledWith('小狗想你了');
        const rows = await DB.getRawStoreData('workroom_events');
        expect(rows).toHaveLength(3);
        expect(rows.filter(r => r.event.kind === 'completed')).toHaveLength(1);
        expect(rows.every(r => r.charId === 'runner-char' && r.workId === h.work.id)).toBe(true);
        expect(rows.find(r => r.event.kind === 'completed').delivery).toBe('delivered');
        expect(rows.filter(r => r.event.kind === 'progress').every(r => r.delivery === 'local')).toBe(true);
        h.host.close();
    });
});

it('分享预览的状态与事件只留在内存，不能创建任务或改写真实进度',async()=>{
    const replies:any[]=[];const port={onmessage:undefined as any,postMessage:(v:unknown)=>replies.push(v),close:vi.fn()};
    const host=createWorkroomHost('runner-char','preview-work','preview-version','preview',{},true);host.bind(port as unknown as MessagePort);
    const send=async(id:number,method:string,args:unknown[]=[])=>{port.onmessage({data:{id:String(id),method,args}});await vi.waitFor(()=>expect(replies.some(r=>r.id===String(id))).toBe(true));return replies.find(r=>r.id===String(id));};
    expect((await send(1,'loadState')).value).toEqual({});
    await send(2,'saveState',[{level:8}]);expect((await send(3,'loadState')).value).toEqual({level:8});
    expect((await send(4,'emitEvent',['预览里喂食','preview-feed'])).ok).toBe(true);
    expect((await send(5,'requestUpdate',['不要真的创建任务'])).ok).toBe(false);
    expect(await DB.getRawStoreData('workroom_states')).toEqual([]);expect(await DB.getRawStoreData('workroom_events')).toEqual([]);
    expect(await DB.getRawStoreData('workroom_works')).toEqual([]);host.close();
});
