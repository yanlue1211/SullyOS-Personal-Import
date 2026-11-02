import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('./safeApi',()=>({safeFetchJson:vi.fn()}));
import {safeFetchJson} from './safeApi';
import {momentsFetchJson,readMonitor,controlMonitor,MONITOR_KEY} from '../features/moments/apiMonitor';
const options={method:'POST',headers:{Authorization:'PRIVATE_KEY'},body:JSON.stringify({model:'test-model',messages:[{role:'system',content:'PRIVATE_BODY'}]})};
const meta={appName:'朋友圈',charName:'阿青',purpose:'社交活动'};
beforeEach(()=>{localStorage.removeItem(MONITOR_KEY);vi.mocked(safeFetchJson).mockReset();vi.mocked(safeFetchJson).mockResolvedValue({choices:[{message:{content:'PRIVATE_REPLY'}}],usage:{prompt_tokens:100000,completion_tokens:10,total_tokens:100010,prompt_tokens_details:{cached_tokens:90000}}});});
afterEach(()=>vi.useRealTimers());
it('records only moments calls and leaves the real arguments and response unchanged',async()=>{
 await momentsFetchJson('https://api.invalid/v1/chat/completions',options,0,0,{appName:'聊天'});
 expect(readMonitor()).toBeNull();
 const data=await momentsFetchJson('https://api.invalid/v1/chat/completions?key=PRIVATE_URL',options,0,0,meta);
 expect(data.usage.prompt_tokens).toBe(100000);
 expect(vi.mocked(safeFetchJson).mock.calls[1][1]).toBe(options);
 expect(readMonitor()?.entries[0]).toMatchObject({role:'阿青',purpose:'社交活动',model:'test-model',host:'api.invalid',state:'ok',input:100000,output:10,cached:90000});
 const stored=localStorage.getItem(MONITOR_KEY)!;expect(stored).not.toMatch(/PRIVATE_KEY|PRIVATE_URL|PRIVATE_BODY|PRIVATE_REPLY/);
});
it('stops at two days while continuing every real model request',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 await momentsFetchJson('https://api.invalid',options,0,0,meta);
 vi.setSystemTime(Date.now()+2*86400000+1);
 await momentsFetchJson('https://api.invalid',options,0,0,meta);
 expect(safeFetchJson).toHaveBeenCalledTimes(2);expect(readMonitor()?.entries).toHaveLength(1);
});
it('clear and disable never resurrect in-flight calls',async()=>{
 let resolve!:(data:any)=>void;vi.mocked(safeFetchJson).mockImplementationOnce(()=>new Promise(r=>resolve=r));
 const pending=momentsFetchJson('https://api.invalid',options,0,0,meta);
 expect(readMonitor()?.entries[0].state).toBe('pending');controlMonitor('clear');resolve({});await pending;
 expect(readMonitor()?.entries).toEqual([]);
 controlMonitor('remove');await momentsFetchJson('https://api.invalid',options,0,0,meta);
 expect(readMonitor()?.enabled).toBe(false);expect(readMonitor()?.entries).toEqual([]);
});
it('records failures, preserves exceptions and does not invent missing usage',async()=>{
 const error=new Error('PRIVATE_ERROR');vi.mocked(safeFetchJson).mockRejectedValueOnce(error);
 await expect(momentsFetchJson('https://api.invalid',options,0,0,meta)).rejects.toBe(error);
 expect(readMonitor()?.entries[0]).toMatchObject({state:'error'});
 expect(readMonitor()?.entries[0].input).toBeUndefined();
 expect(localStorage.getItem(MONITOR_KEY)).not.toContain('PRIVATE_ERROR');
});
it('storage failures never block or change the provider response',async()=>{
 const spy=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw Error('storage unavailable');});
 try{await expect(momentsFetchJson('https://api.invalid',options,0,0,meta)).resolves.toHaveProperty('usage.prompt_tokens',100000);expect(safeFetchJson).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}
});
