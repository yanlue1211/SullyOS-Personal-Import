// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {call,connection,recoverSession,disconnect} from '../features/tapnest/bridge';
import {rememberDevice,rememberedDevice} from '../features/tapnest/device';
import {petControlAbort,petTimeout,isPetControlCancellation} from '../features/tapnest/transport';
afterEach(()=>{disconnect();localStorage.clear();vi.useRealTimers();vi.unstubAllGlobals();});
it('distinguishes a watch timeout from user cancellation; quiets only marked local control flow',async()=>{
 vi.useFakeTimers();let signal:AbortSignal;vi.stubGlobal('fetch',vi.fn((url,init)=>new Promise((_,reject)=>{signal=init.signal;signal.addEventListener('abort',()=>reject(signal.reason));})));
 const request=call('/watch').catch(e=>e);await vi.advanceTimersByTimeAsync(17000);const e=await request;expect(e.name).toBe('TimeoutError');expect(isPetControlCancellation(e,signal!,'http://127.0.0.1:18347/watch')).toBe(true);expect(isPetControlCancellation(e,signal!,'https://model.example/chat/completions')).toBe(false);
 const c=new AbortController(),reason=petControlAbort();c.abort(reason);expect(isPetControlCancellation(reason,c.signal,'http://127.0.0.1:18347/state')).toBe(true);expect(isPetControlCancellation(new TypeError('Failed to fetch'),c.signal,'http://127.0.0.1:18347/watch')).toBe(false);
});
it('resumes a restarted script with the persistent credential, not the new PIN',async()=>{
 rememberDevice('a'.repeat(48));connection.token='old';connection.runtimeToken='old';let starts=0;const start=()=>starts++;window.addEventListener('tapnest-runtime-start',start);
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{expect(url).toContain('/resume');expect(JSON.parse(init.body).deviceKey).toBe('a'.repeat(48));return {ok:true,json:async()=>({ok:true,token:'new',visible:true})};}));
 expect(await recoverSession(new AbortController().signal)).toBe(true);expect(connection.token).toBe('new');expect(connection.runtimeToken).toBe('new');expect(rememberedDevice()).toBe('a'.repeat(48));expect(starts).toBe(0);window.removeEventListener('tapnest-runtime-start',start);
});
it('does not forget the device on a temporary failure or resurrect an explicitly disconnected runtime',async()=>{
 rememberDevice('a'.repeat(48));connection.token='old';vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));await expect(recoverSession(new AbortController().signal)).rejects.toThrow();expect(rememberedDevice()).not.toBe('');expect(connection.token).toBe('old');
 let resolve:any;vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>resolve=r)));const pending=recoverSession(new AbortController().signal);disconnect();resolve({ok:true,json:async()=>({ok:true,token:'late',visible:true})});expect(await pending).toBe(false);expect(connection.token).toBe('');
});
