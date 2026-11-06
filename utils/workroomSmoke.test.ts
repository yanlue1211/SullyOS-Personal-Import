// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {smokeTestWorkroom} from '../features/workroom/smokeTest';
const code={html:'<button>运行</button>',css:'',js:''};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();document.body.innerHTML='';});
it('启动观察超时和取消均移除沙盒，不残留计时器',async()=>{
    vi.useFakeTimers();const controller=new AbortController();const result=smokeTestWorkroom(code,controller.signal);
    expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    await vi.advanceTimersByTimeAsync(5000);expect((await result).errors).toEqual(['启动观察超时']);expect(document.querySelector('iframe')).toBeNull();
    const cancelled=smokeTestWorkroom(code,controller.signal);const rejection=expect(cancelled).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejection;expect(document.querySelector('iframe')).toBeNull();expect(vi.getTimerCount()).toBe(0);
});
it('受控端口报告启动和错误后收集结果，不访问真实状态',async()=>{
    vi.useFakeTimers();let port:any;
    vi.stubGlobal('MessageChannel',class{port1=port={onmessage:null,postMessage:vi.fn(),close:vi.fn()};port2={};});
    const result=smokeTestWorkroom(code,new AbortController().signal),frame=document.querySelector('iframe')!;
    frame.onload!(new Event('load'));
    // jsdom also queues a synthetic about:blank load; the explicit event above models the srcdoc load.
    frame.onload=null;
    port.onmessage({data:{id:'1',method:'reportReady',args:['ready']}});
    port.onmessage({data:{id:'2',method:'reportError',args:['按钮错误']}});
    for(let i=0;i<8;i++)await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);
    const report=await result;expect(report.errors).toEqual(['按钮错误']);expect(report.notes).toContain('未验证所有玩法');expect(document.querySelector('iframe')).toBeNull();expect(port.close).toHaveBeenCalled();
});
