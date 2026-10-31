// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
import { WORKROOM_STORES, transactionDone } from '../features/workroom/schema';
import { shareWork } from '../features/workroom/collaboration';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { createWorkroomMessage } from './workroomEvent';
import { isVisibleChatMessage } from './chatMessageVisibility';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), close: vi.fn(), update: vi.fn() }));
vi.mock('../features/workroom/creation', () => ({ generateWorkroomReply: mocks.generate }));
vi.mock('../context/OSContext', () => ({ useOS: () => ({
    characters: [{ id: 'a', name: '阿源' }, { id: 'b', name: 'Claude' }], apiConfig: {}, userProfile: { name: 'User' },
    groups: [], realtimeConfig: {}, closeApp: mocks.close, updateCharacter: mocks.update,
}) }));
import WorkroomApp from '../apps/WorkroomApp';
import ChatMessage from '../components/chat/MessageItem';
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.generate.mockReset();
    const db = await openDB(), tx = db.transaction(['characters', 'messages', ...WORKROOM_STORES], 'readwrite'), done = transactionDone(tx);
    for (const name of ['characters', 'messages', ...WORKROOM_STORES]) tx.objectStore(name).clear();
    tx.objectStore('characters').put({ id: 'a', name: '阿源' }); tx.objectStore('characters').put({ id: 'b', name: 'Claude' });
    await done;
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label || b.querySelector('strong')?.textContent===label);
    expect(button, label).toBeTruthy(); await act(async () => button!.click());
};
const fill = async (label: string, text: string) => {
    const input = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement;
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const choose = async (value: string) => {
    await act(async () => { const select = container.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
};
const waitText = async (text: string) => vi.waitFor(async () => { await act(async () => {}); expect(container.textContent).toContain(text); });

describe('造物间 App 与真实消息组件', () => {
    it('从角色选择创建作品并进入创作交流，角色切换后作品库独立', async () => {
        await act(async () => root.render(React.createElement(WorkroomApp)));
        expect(container.textContent).toContain('选择一位 Char');
        await choose('a'); await waitText('阿源 的造物间'); await click('开始创作'); await fill('作品名称', '小狗饲养屋'); await fill('作品简介', '喂食散步'); await click('创建作品');
        await waitText('创作交流');
        expect((await W.list('a'))[0].title).toBe('小狗饲养屋');
        await choose('b'); await waitText('Claude 的造物间');
        expect(container.textContent).not.toContain('小狗饲养屋');
    });
    it('编辑器保留未保存内容，其他窗口改草稿时拒绝覆盖', async () => {
        const work = await W.create('a', '草稿冲突测试', '保存保护');
        await act(async () => root.render(React.createElement(WorkroomApp)));
        await choose('a'); await waitText('阿源 的造物间'); await click('草稿箱'); await waitText('草稿冲突测试');
        const entry = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('草稿冲突测试'))!;
        await act(async () => entry.click()); await waitText('创作交流'); await click('代码草稿');
        await fill('html源码', '<p>我的未保存内容</p>');
        await W.saveDraft('a', work.id, { html: '其他窗口已经保存', css: '', js: '' }, 0, null);
        await click('保存草稿'); await waitText('草稿已被其他窗口修改');
        expect((container.querySelector('[aria-label="html源码"]') as HTMLTextAreaElement).value).toBe('<p>我的未保存内容</p>');
        expect((await W.get('a', work.id)).draft?.html).toBe('其他窗口已经保存');
    });
    it('切换角色立即取消旧请求，迟到结果不跳回旧角色页面', async () => {
        const work = await W.create('a', '旧角色的作品', '隔离请求');
        let resolve!: (v: unknown) => void;
        mocks.generate.mockImplementation(() => new Promise(r => { resolve = r; }));
        await act(async () => root.render(React.createElement(WorkroomApp)));
        await choose('a'); await waitText('阿源 的造物间'); await click('草稿箱'); await waitText('旧角色的作品');
        const entry = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('旧角色的作品'))!;
        await act(async () => entry.click()); await waitText('创作交流'); await fill('创作交流', '开始制作'); await click('发送');
        expect(mocks.generate).toHaveBeenCalledOnce(); const signal = mocks.generate.mock.calls[0][0].signal;
        await choose('b'); expect(signal.aborted).toBe(true);
        await act(async () => resolve({ turn: { text: '迟到结果' }, savedDraft: true }));
        await waitText('Claude 的造物间'); expect(container.textContent).not.toContain(work.title);
        expect(container.textContent).not.toContain('新代码已保存');
    });
    it('重新打开后能继续上次尚未收到回复的创作消息', async () => {
        const work = await W.create('a', '断点继续', '继续讨论');
        await W.appendTurn('a', work.id, 'user', '上次没来得及完成的想法');
        await act(async () => root.render(React.createElement(WorkroomApp)));
        await choose('a'); await waitText('阿源 的造物间'); await click('草稿箱'); await waitText('断点继续');
        const entry = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('断点继续'))!;
        await act(async () => entry.click());
        await waitText('上次没来得及完成的想法');
        expect([...container.querySelectorAll('button')].some(b => b.textContent === '重试上一条')).toBe(true);
    });
    it('收到的分享可先查看简介与打开沙盒预览，不自动加入组件库', async () => {
        const work=await W.create('a','分享预览作品','可以先体验');await W.saveDraft('a',work.id,{html:'<p>PREVIEW_CODE</p>',css:'',js:''},0,null);await W.publish('a',work.id,1);
        await shareWork('a',work.id,'b');
        vi.stubGlobal('MessageChannel',class {port1={onmessage:null,postMessage:()=>{},close:()=>{}};port2={};});
        await act(async()=>root.render(React.createElement(WorkroomApp)));
        await choose('b');await waitText('Claude 的造物间');await click('收到的分享');await waitText('分享预览作品');await click('打开看看');await waitText('预览进度仅保留本次');
        expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
        expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('PREVIEW_CODE');
        expect(await W.list('b')).toEqual([]);expect(mocks.generate).not.toHaveBeenCalled();
    });
    it('保存草稿后可临时试运行并记录反馈，正式进度不被测试覆盖',async()=>{
        const work=await W.create('a','草稿试运行','验证按钮');await W.saveDraft('a',work.id,{html:'<button>TEST_DRAFT</button>',css:'',js:''},0,null);
        vi.stubGlobal('MessageChannel',class {port1={onmessage:null,postMessage:()=>{},close:()=>{}};port2={};});
        await act(async()=>root.render(React.createElement(WorkroomApp)));await choose('a');await waitText('阿源 的造物间');await click('草稿箱');await waitText('草稿试运行');
        const entry=[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('草稿试运行'))!;await act(async()=>entry.click());await waitText('创作交流');await click('代码草稿');
        await click('试运行已保存草稿');await waitText('草稿试运行：');expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('TEST_DRAFT');
        await fill('测试反馈','按钮需要更大');await click('结束测试并保存记录');await waitText('试运行记录已保存');
        expect((await W.get('a',work.id)).work.testReport?.notes).toBe('按钮需要更大');expect(await DB.getRawStoreData('workroom_states')).toEqual([]);
    });
    it('系统角色的完成卡实际渲染且只有一层卡面，隐藏系统日志也不会隐藏它', async () => {
        const message = { id: 42, ...createWorkroomMessage({ version: 1, eventId: 'card', charId: 'a', charName: '阿源', kind: 'completed',
            subjectId: 'work', title: '小狗饲养屋', summary: '喂食散步', detail: '一起完成了游戏。', timestamp: Date.now() }) };
        expect(isVisibleChatMessage(message, true)).toBe(true);
        await act(async () => root.render(React.createElement(ChatMessage, { msg: message, isFirstInGroup: true, isLastInGroup: true,
            activeTheme: { ai: {}, user: {} } as any, charAvatar: '', userAvatar: '', charName: '阿源', selectionMode: false, isSelected: false,
            onLongPress: vi.fn(), onReply: vi.fn(), onToggleSelect: vi.fn() })));
        expect(container.textContent).toContain('作品完成'); expect(container.textContent).toContain('去造物间看看');
        expect(container.querySelectorAll('[data-card-kind="workroom_card"]')).toHaveLength(1);
    });
});
