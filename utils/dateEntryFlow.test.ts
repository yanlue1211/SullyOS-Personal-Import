// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    toast: vi.fn(), updateCharacter: vi.fn(), fetch: vi.fn(),
    session: null as any, rows: [] as any[], suspended: null as any, suspend: vi.fn(),
    characters: [{ id: 'c', name: '测试角色', avatar: '', savedDateState: { currentText: '旧快照' } }],
}));
vi.mock('../context/OSContext', async () => {
    const React = await import('react');
    return { useOS: () => {
        const [activeCharacterId, setActiveCharacterId] = React.useState('c');
        return {
            activeCharacterId, setActiveCharacterId,
            suspendedDate: mocks.suspended, suspendDate: mocks.suspend, takeSuspendedDate: vi.fn(),
            characters: mocks.characters,
            closeApp: vi.fn(), openApp: vi.fn(), addToast: mocks.toast, updateCharacter: mocks.updateCharacter,
            updateUserProfile: vi.fn(), userProfile: { name: '用户' }, groups: [], characterGroups: [],
            virtualTime: { hours: 12, minutes: 0, day: 'Thu' }, apiConfig: { baseUrl: 'https://example.invalid' }, consumeDateAutoStart: vi.fn(),
        };
    } };
});
vi.mock('../components/date/DateSession', () => ({ default: (props: any) => {
    mocks.session = props;
    return React.createElement('button', { onClick: props.onExit }, '退出见面');
} }));
vi.mock('../components/date/DateSettings', () => ({ default: () => null }));
vi.mock('../components/date/story/StoryTheater', () => ({ default: () => React.createElement('div',null,'小剧场选择页') }));
vi.mock('../features/experience/oracle',async original=>({...await original<any>(),oracleContext:vi.fn().mockResolvedValue('【糖的效果】')}));
vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('./amsgStateSync', () => ({ markAmsgStateDirty: vi.fn() }));
vi.mock('./chatContextRange', async importOriginal => ({
    ...await importOriginal<typeof import('./chatContextRange')>(),
    loadCharacterContextMessages: vi.fn(async () => []),
}));
vi.mock('./visionApi', () => ({ materializeVisionDescriptions: vi.fn(async messages => messages) }));
vi.mock('./safeApi', () => ({ safeResponseJson: vi.fn(async () => ({})), extractContent: vi.fn(() => '测试开场正文') }));
vi.mock('./db', () => ({ DB: {
    getAsset: vi.fn(async () => undefined),
    getRecentMessagesByCharIdAndSource: vi.fn(async () => mocks.rows),
    getEmojis: vi.fn(async () => []),
    saveMessage: vi.fn(async message => { mocks.rows.push({ ...message, id: mocks.rows.length + 1, timestamp: 1 }); return mocks.rows.length; }),
} }));
import DateApp from '../apps/DateApp';
import {dateLaunch} from './dateLaunch';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    dateLaunch.consume();
    vi.clearAllMocks();
    localStorage.setItem('sully-date-entry-guide-v1', 'seen');
    mocks.rows = [];
    mocks.session = null;
    mocks.suspended = null;
    mocks.fetch.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mocks.fetch);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

it.each(['靠近他', '让他靠近'])('%s 生成对应开场并保存场次和开场方式', async label => {
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    await clickText(label);
    expect(mocks.fetch, JSON.stringify(mocks.toast.mock.calls)).toHaveBeenCalledTimes(1);
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(JSON.stringify(request.messages)).toContain(label === '靠近他' ? '用户正在悄悄靠近' : '由你主动以合理的方式');
    await clickText(label === '靠近他' ? '走过去' : '见到他');
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0].metadata).toMatchObject({
        isOpening: true, dateEncounterId: mocks.session.encounterId,
        dateOpeningMode: label === '靠近他' ? 'approach' : 'invite',
    });
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});
const clickText = async (text: string) => {
    const element = Array.from(container.querySelectorAll('button, span')).find(el => el.textContent === text);
    expect(element, text).toBeTruthy();
    await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

it('首次到达三个选项才展示说明，确认后重新打开也不再提示', async () => {
    localStorage.removeItem('sully-date-entry-guide-v1');
    await act(async () => root.render(React.createElement(DateApp)));
    expect(container.textContent).not.toContain('选择这次见面的开场方式');
    await clickText('测试角色');
    expect(container.textContent).toContain('选择这次见面的开场方式');
    expect(container.textContent).toContain('你主动走过去');
    expect(container.textContent).toContain('他主动来见你');
    expect(container.textContent).toContain('直接见面 · 不生成开场白');
    await clickText('知道了');
    expect(localStorage.getItem('sully-date-entry-guide-v1')).toBe('seen');
    expect(container.textContent).not.toContain('选择这次见面的开场方式');
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    expect(container.textContent).not.toContain('选择这次见面的开场方式');
    expect(mocks.fetch).not.toHaveBeenCalled();
});

it('有旧快照仍显示三个入口；直接见面不请求开场，退出无弹窗，再进入是独立场次', async () => {
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    expect(container.textContent).toContain('靠近他');
    expect(container.textContent).toContain('让他靠近');
    expect(container.textContent).toContain('直接见面');
    expect(container.textContent).not.toContain('继续上次');
    await clickText('直接见面');
    const firstId = mocks.session.encounterId;
    expect(firstId).toBeTruthy();
    expect(mocks.session.peekStatus).toBe('');
    expect(mocks.session.initialState).toBeUndefined();
    expect(mocks.fetch).not.toHaveBeenCalled();
    await clickText('退出见面');
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('保存并退出');
    mocks.rows = [{ id: 1, role: 'assistant', content: '上一场', timestamp: 1,
        metadata: { source: 'date', dateEncounterId: firstId } }];
    await clickText('测试角色');
    await clickText('直接见面');
    expect(mocks.session.encounterId).not.toBe(firstId);
    expect(mocks.session.messages.map((message: any) => message.content)).toEqual(['上一场']);
});

it('切换应用挂起原场次，不解除持久见面锁；显式结束不挂起', async () => {
    const { isAmsgActiveDate } = await import('./amsgInteractionGuard');
    await act(async () => root.render(React.createElement(DateApp)));
    await clickText('测试角色');
    await clickText('直接见面');
    const encounter = mocks.session.encounterId;
    expect(isAmsgActiveDate('c')).toBe(true);
    await act(async () => root.unmount());
    expect(mocks.suspend).toHaveBeenCalledWith(expect.objectContaining({charId:'c', encounterId:encounter}));
    expect(isAmsgActiveDate('c')).toBe(true);
    mocks.suspended = mocks.suspend.mock.calls.at(-1)![0];
    mocks.suspend.mockClear();
    root = createRoot(container);
    dateLaunch.request({surface:'companion',resume:true});
    await act(async () => root.render(React.createElement(DateApp)));
    expect(mocks.session.encounterId).toBe(encounter);
    await clickText('退出见面');
    expect(isAmsgActiveDate('c')).toBe(false);
    await act(async () => root.unmount());
    expect(mocks.suspend).not.toHaveBeenCalled();
    root = createRoot(container);
});

it('线上消息已结束见面后不恢复旧的挂起场次', async () => {
    const {setAmsgActiveDate} = await import('./amsgInteractionGuard');
    setAmsgActiveDate('c', true, 'old-encounter');
    mocks.suspended = {charId:'c',charName:'测试角色',encounterId:'old-encounter',peekStatus:'',
      cameFromChat:false,state:null,suspendedAt:1};
    setAmsgActiveDate('c', false);
    await act(async () => root.render(React.createElement(DateApp)));
    expect(container.textContent).toContain('选择见面对象');
    expect(mocks.session).toBeNull();
});

it('暂离后普通入口显示选择页并保留锁，可以选择新角色或小剧场；返回横条才恢复', async()=>{
 const {setAmsgActiveDate,isAmsgActiveDate}=await import('./amsgInteractionGuard');
 setAmsgActiveDate('c',true,'old');
 mocks.suspended={charId:'c',charName:'测试角色',encounterId:'old',peekStatus:'旧场景',cameFromChat:false,state:null,suspendedAt:1};
 await act(async()=>root.render(React.createElement(DateApp)));
 expect(container.textContent).toContain('选择见面对象');expect(mocks.session).toBeNull();
 expect(isAmsgActiveDate('c')).toBe(true);expect(mocks.fetch).not.toHaveBeenCalled();
 await act(async()=>dateLaunch.request({surface:'companion',resume:true}));
 expect(mocks.session.encounterId).toBe('old');
 expect(mocks.fetch).not.toHaveBeenCalled();
});
it('见面我谕只保存幕后记录，不触发API，带场次范围',async()=>{
 await act(async()=>root.render(React.createElement(DateApp)));
 await clickText('测试角色');await clickText('直接见面');
 const {oracleMessage,emptyOracle}=await import('../features/experience/oracle');
 const message=oracleMessage({...emptyOracle(),name:'糖',effect:'甜',cognition:'看得到'});
 await act(async()=>mocks.session.onExperienceSend(message));
 expect(mocks.fetch).not.toHaveBeenCalled();
 expect(mocks.rows.at(-1)).toMatchObject({role:'system',metadata:{source:'date',dateEncounterId:mocks.session.encounterId,oracle:message.metadata.oracle}});
 await act(async()=>mocks.session.onSendMessage('我吃一颗糖'));
 expect(mocks.fetch).toHaveBeenCalledOnce();
});

it('保留A的见面锁时仍能进入剧情选择页和B的见面准备页',async()=>{
 const {setAmsgActiveDate,isAmsgActiveDate}=await import('./amsgInteractionGuard');
 setAmsgActiveDate('c',true,'old-a');
 mocks.suspended={charId:'c',charName:'测试角色',encounterId:'old-a',peekStatus:'',cameFromChat:false,state:null,suspendedAt:1};
 mocks.characters.push({id:'b',name:'另一位角色',avatar:'',savedDateState:{currentText:''}});
 try{
  await act(async()=>root.render(React.createElement(DateApp)));
  await clickText('剧情');expect(container.textContent).toContain('小剧场选择页');
  await act(async()=>dateLaunch.request({surface:'companion'}));
  await clickText('另一位角色');expect(container.textContent).toContain('直接见面');
  expect(isAmsgActiveDate('c')).toBe(true);expect(mocks.fetch).not.toHaveBeenCalled();
 }finally{mocks.characters.pop();}
});
