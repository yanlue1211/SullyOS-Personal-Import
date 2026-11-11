// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('./activeMsgClient', () => ({ ActiveMsgClient: {scheduleCharacterTask:vi.fn()} }));
vi.mock('./activeMsgStore', () => ({ ActiveMsgStore: {getGlobalConfig:vi.fn()} }));
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { prepareInPersonScheduling, applyInPersonSchedules } from './inPersonScheduling';
import { setAmsgActiveDate, isAmsgActiveDate } from './amsgInteractionGuard';
const actor = (id:string, enabled=true):any => ({id,name:id,activeMsg2Config:{enabled,tasks:[],minIntervalMinutes:1}});
const a=actor('a'), b=actor('b');
const updates=vi.fn(), report=vi.fn();
const base:any={userProfile:{name:'用户'},groups:[],realtimeConfig:{},apiConfig:{},updateCharacter:updates};
const call=(id?:string,hours=1,extra={})=>`schedule_active_message(${JSON.stringify({...(id?{character_id:id}:{}),send_at:new Date(Date.now()+hours*3600000).toISOString(),mode:'auto',prompt_hint:'出门后报备',expire_policy:'expire',...extra})})`;
beforeEach(()=>{
    localStorage.clear();vi.clearAllMocks();
    vi.useFakeTimers({now:new Date('2026-11-11T04:00:00Z')});
    setAmsgActiveDate('a',true,'date-a');setAmsgActiveDate('b',true,'story-b');
    vi.mocked(ActiveMsgStore.getGlobalConfig).mockResolvedValue({workerUrl:'https://example.test'} as any);
    let n=0;
    vi.mocked(ActiveMsgClient.scheduleCharacterTask).mockImplementation(async()=>({uuid:`task-${++n}`,clientTaskId:`client-${n}`,resolvedSendAt:new Date(Date.now()+3600000).toISOString()} as any));
});
afterEach(()=>vi.useRealTimers());
it.each(['普通见面','真实时间陪伴'])('%s：真实工具桥保存任务、场次归属正确、清除正文语法且排程不解锁',async()=>{
    const context=await prepareInPersonScheduling([a],true);
    expect(context.prompt).toContain('未来要真正通过线上聊天');
    expect(await applyInPersonSchedules(`明早出门再联系。\n${call()}`,context,base,report)).toBe('明早出门再联系。');
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledWith(expect.objectContaining({char:a,task:expect.objectContaining({selfScheduled:true,dateExitEncounterId:'date-a',recurrenceType:'none'})}));
    expect(updates).toHaveBeenCalledWith('a',expect.objectContaining({activeMsg2Config:expect.objectContaining({tasks:[expect.objectContaining({taskUuid:'task-1'})]})}));
    expect(report).toHaveBeenCalledWith(true);
    expect(isAmsgActiveDate('a')).toBe(true);
});
it('多人严格按 ID 归属，不能默认猜角色；关闭的参与者和 NPC 不能排',async()=>{
    const context=await prepareInPersonScheduling([a,b,actor('c',false)],true);
    await applyInPersonSchedules(`${call()}\n${call('c')}`,context,base,report);
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
    await applyInPersonSchedules(`${call('b')}\n${call('a',2)}`,context,base,report);
    expect(vi.mocked(ActiveMsgClient.scheduleCharacterTask).mock.calls.map(([arg])=>[arg.char.id,arg.task.dateExitEncounterId])).toEqual([['b','story-b'],['a','date-a']]);
});
it('虚构剧场、重掷、未开启或没有 Worker 均不开放也不执行',async()=>{
    for (const context of [await prepareInPersonScheduling([a],false),await prepareInPersonScheduling([a],true,false),await prepareInPersonScheduling([actor('a',false)],true)]) {
        expect(context.prompt).toBe('');
        expect(await applyInPersonSchedules(`正文\n${call('a')}`,context,base,report)).toBe('正文');
    }
    vi.mocked(ActiveMsgStore.getGlobalConfig).mockResolvedValue({} as any);
    expect((await prepareInPersonScheduling([a],true)).prompt).toBe('');
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
});
it('单人同轮两条累加、全轮上限两条；内部参数不能由模型覆盖',async()=>{
    const context=await prepareInPersonScheduling([a],true);
    const text=await applyInPersonSchedules([call('a',1,{__dateExitEncounterId:'forged',recurrence:'daily'}),call('a',2),call('a',3)].join('\n'),context,base,report);
    expect(text).toBe('');
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledTimes(2);
    expect(updates.mock.calls.at(-1)?.[1].activeMsg2Config.tasks).toHaveLength(2);
    expect(vi.mocked(ActiveMsgClient.scheduleCharacterTask).mock.calls[0][0].task).toMatchObject({recurrenceType:'none',dateExitEncounterId:'date-a'});
});
it('重复调用不二次创建；代码示例不执行',async()=>{
    const context=await prepareInPersonScheduling([a],true);
    await applyInPersonSchedules(`${call()}\n${call()}`,context,base,report);
    expect(ActiveMsgClient.scheduleCharacterTask).toHaveBeenCalledTimes(1);
    vi.mocked(ActiveMsgClient.scheduleCharacterTask).mockClear();
    const text='`'+call()+'`';
    expect(await applyInPersonSchedules(text,context,base,report)).toBe(text);
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
});
it('见面已结束或切到新场次，旧请求的迟到回复不能排程',async()=>{
    const context=await prepareInPersonScheduling([a,b],true);
    setAmsgActiveDate('a',false);setAmsgActiveDate('b',true,'new');
    await applyInPersonSchedules(`${call('a')}\n${call('b')}`,context,base,report);
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
});
it('云端失败不报预约成功，仍保留正常正文',async()=>{
    const context=await prepareInPersonScheduling([a],true);
    vi.mocked(ActiveMsgClient.scheduleCharacterTask).mockRejectedValue(new Error('offline'));
    expect(await applyInPersonSchedules(`正文\n${call()}`,context,base,report)).toBe('正文');
    expect(report).toHaveBeenCalledWith(false);
    expect(updates).not.toHaveBeenCalled();
});

it('上下文准备期间切到其他场次，不能把旧剧情的预约挂到新见面',async()=>{
    setAmsgActiveDate('a',true,'new-date');
    const context=await prepareInPersonScheduling([a],true,true,new Map([['a','date-a']]));
    expect(context.prompt).toBe('');
    await applyInPersonSchedules(call(),context,base,report);
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
});

it('等待全局配置期间开始新场次，仍保留旧身份并拒绝迟到预约',async()=>{
    let resolve!: (value:any)=>void;
    vi.mocked(ActiveMsgStore.getGlobalConfig).mockReturnValueOnce(new Promise(done=>{resolve=done;}));
    const pending=prepareInPersonScheduling([a],true);
    setAmsgActiveDate('a',true,'new-date');
    resolve({workerUrl:'https://example.test'});
    const context=await pending;
    await applyInPersonSchedules(call(),context,base,report);
    expect(ActiveMsgClient.scheduleCharacterTask).not.toHaveBeenCalled();
});
