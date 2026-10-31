import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { generateWorkroomReply, parseWorkroomReply } from '../features/workroom/creation';
import { WORKROOM_STORES, transactionDone } from '../features/workroom/schema';
import * as palace from './memoryPalace/pipeline';
const smoke=vi.hoisted(()=>vi.fn(async()=>({errors:['按钮报错'],notes:'短时启动观察'})));
vi.mock('../features/workroom/smokeTest',()=>({smokeTestWorkroom:smoke}));
vi.mock('./activeMsgRuntime', () => ({ prepareInboxBeforeChat: vi.fn(async () => {}) }));
let workId: string;
const api = { baseUrl: 'https://global.invalid/v1', model: 'global', apiKey: 'global-key' };
beforeEach(async () => {
    localStorage.clear();
    const db = await openDB(), tx = db.transaction(['characters', 'messages', ...WORKROOM_STORES], 'readwrite'), done = transactionDone(tx);
    for (const name of ['characters', 'messages', ...WORKROOM_STORES]) tx.objectStore(name).clear();
    tx.objectStore('characters').put({ id: 'a', name: '阿源', systemPrompt: '温柔但有主见的人设标记', worldview: '正常世界观标记',
        memoryPalaceEnabled: true, contextRangePolicyVersion: 1, contextRangeMode: 'manual', contextLimit: 100,
        dialogueApi: { baseUrl: 'https://character.invalid/v1', model: 'char-model', apiKey: 'char-key' },
        mountedWorldbooks: [{ id: 'book', title: '世界书', content: '世界书完整标记', constant: true, position: 1 }] });
    tx.objectStore('characters').put({ id: 'b', name: '其他角色', systemPrompt: '其他角色私有设定' });
    await done;
    await DB.saveMessage({ charId: 'a', role: 'user', type: 'text', content: '正常聊天历史标记' });
    await DB.saveMessage({ charId: 'b', role: 'user', type: 'text', content: '不应读取的私人聊天' });
    workId = (await W.create('a', '小狗饲养屋', '喂食散步')).id;
    vi.spyOn(palace, 'injectMemoryPalace').mockImplementation(async char => { char.memoryPalaceInjection = '记忆召回结果标记'; return { stages: [] } as any; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const args = () => ({ charId: 'a', workId, text: '帮我制作小狗小游戏', api, user: { name: 'User' } as any, signal: new AbortController().signal });
function model(responses: string[]) {
    const calls: Array<{url: string; body: any; headers: any}> = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
        return new Response(JSON.stringify({ choices: [{ message: { content: responses.shift() } }] }), { status: 200 });
    }));
    return calls;
}
it('创作入口使用角色 API 和完整共享上下文，代码只落草稿，回复进入共享聊天', async () => {
    const calls = model([JSON.stringify({ text: '第一版草稿做好了，可以看看。', code: { html: '<button>小狗</button>', css: '', js: '// CODE_ONLY' } })]);
    await generateWorkroomReply(args());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://character.invalid/v1/chat/completions');
    expect(calls[0].body.model).toBe('char-model');
    expect(calls[0].headers.Authorization).toBe('Bearer char-key');
    const sent = JSON.stringify(calls[0].body.messages);
    for (const marker of ['人设标记', '正常世界观标记', '世界书完整标记', '正常聊天历史标记', '记忆召回结果标记', '帮我制作小狗小游戏']) expect(sent).toContain(marker);
    expect(palace.injectMemoryPalace).toHaveBeenCalled();
    expect(sent).not.toContain('其他角色私有设定'); expect(sent).not.toContain('不应读取的私人聊天');
    const snapshot = await W.get('a', workId);
    expect(snapshot.draft?.js).toBe('// CODE_ONLY'); expect(snapshot.work.currentVersionId).toBeNull();
    const history = await DB.getMessagesByCharId('a', true);
    expect(history.some(m => m.content.includes('第一版草稿做好了'))).toBe(true);
    expect(history.some(m => m.content.includes('CODE_ONLY'))).toBe(false);
});
it('已有代码按需读取，一次工具后续答；日常讨论不自动附带代码', async () => {
    await W.saveDraft('a', workId, { html: '<p>当前源码标记</p>', css: '', js: '' }, 0, null);
    const calls = model(['{"action":"read_code"}', '{"text":"我看过现有代码，可以保持原来的进度结构。"}']);
    await generateWorkroomReply(args());
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[0].body.messages)).not.toContain('当前源码标记');
    expect(JSON.stringify(calls[1].body.messages)).toContain('当前源码标记');
    expect(palace.injectMemoryPalace).toHaveBeenCalledTimes(1);
    expect((await W.turns('a', workId)).map(t => t.role)).toEqual(['user', 'assistant']);
});
it('截断或无效的模型代码不覆盖草稿，不伪造成功交流', async () => {
    await W.saveDraft('a', workId, { html: '旧草稿', css: '', js: '' }, 0, null);
    model(['{"text":"完成","code":{"html":"截断']);
    await expect(generateWorkroomReply(args())).rejects.toThrow();
    expect((await W.get('a', workId)).draft?.html).toBe('旧草稿');
    expect((await W.turns('a', workId)).map(t => t.role)).toEqual(['user']);
});
it('停止后即使迟到的网络结果返回，也不能保存草稿或角色回复', async () => {
    const controller = new AbortController(); let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
    const promise = generateWorkroomReply({ ...args(), signal: controller.signal });
    const assertion = expect(promise).rejects.toThrow();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    controller.abort();
    resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"迟到回复","code":{"html":"新代码","css":"","js":""}}' } }] })));
    await assertion;
    expect((await W.get('a', workId)).draft).toBeUndefined();
    expect((await W.turns('a', workId)).every(t => t.role === 'user')).toBe(true);
});
it('同一用户消息重试不产生重复用户记录，新讨论出现后拒绝旧回复', async () => {
    const input = await W.appendTurn('a', workId, 'user', '失败后重试');
    model(['{"text":"这次收到了。"}']);
    await generateWorkroomReply({ ...args(), text: input.text, retryTurnId: input.id });
    expect((await W.turns('a', workId)).filter(t => t.role === 'user')).toHaveLength(1);
    await W.appendTurn('a', workId, 'user', '后来的消息');
    await expect(W.commitReply('a', workId, { userTurnId: input.id, expectedVersionId: null, expectedDraftRevision: 0, text: '旧请求' })).rejects.toThrow('新的创作交流');
});
it('输出协议不接受缺失字段、临时资源或重复读代码后的伪成功', () => {
    expect(() => parseWorkroomReply('{"text":"","code":{}}')).toThrow();
    expect(() => parseWorkroomReply('{"text":"好","code":{"html":"blob:temp","css":"","js":""}}')).toThrow();
    expect(parseWorkroomReply('```json\n{"text":"先讨论一下"}\n```')).toEqual({ text: '先讨论一下' });
});

it('角色明确请求测试已保存草稿时才启动隔离观察，并将错误交给后续模型和维护记录',async()=>{
    await W.saveDraft('a',workId,{html:'<button>测试</button>',css:'',js:''},0,null);
    const calls=model([JSON.stringify({action:'test_code'}),JSON.stringify({text:'按钮报错了，我来修改。'})]);
    await generateWorkroomReply(args());expect(calls).toHaveLength(2);expect(smoke).toHaveBeenCalled();
    expect(JSON.stringify(calls[1].body.messages)).toContain('按钮报错');expect((await W.get('a',workId)).work.testReport?.errors).toEqual(['按钮报错']);
});
