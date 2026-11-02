import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {newSession} from '../features/yueqi/model';
vi.mock('../features/yueqi/storage',()=>({storage:{save:vi.fn(async()=>{}),get:vi.fn(async()=>null),list:vi.fn(async()=>[]),clearAudio:vi.fn(async s=>s)}}));
vi.mock('../features/yueqi/generate',()=>({compact:vi.fn(async s=>s),generate:vi.fn(),synthesize:vi.fn(async s=>s),summarize:vi.fn(async s=>({...s,summary:'摘要'})),deliver:vi.fn(async s=>({...s,cardId:1})),addReply:(s:any,text:string)=>({...s,turns:[...s.turns,{id:'reply',role:'assistant',text,played:false}],clips:[...s.clips,{id:'clip-reply',turnId:'reply',audio:'data:test',text}]})}));
vi.mock('../utils/speechToText',()=>({startStt:vi.fn(async()=>({stop:vi.fn()}))}));
vi.mock('../features/yueqi/listen',()=>({handsFree:vi.fn(async()=>vi.fn())}));
import {moon} from '../features/yueqi/runtime';
import {generate} from '../features/yueqi/generate';
import {startStt} from '../utils/speechToText';
class FakeAudio {src:string;paused=true;volume=1;playbackRate=1;currentTime=0;onended:(()=>void)|null=null;ontimeupdate:(()=>void)|null=null;onerror:(()=>void)|null=null;constructor(src=''){this.src=src;}async play(){this.paused=false;}pause(){this.paused=true;}removeAttribute(){this.src='';}load(){}}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('Audio',FakeAudio);vi.stubGlobal('requestAnimationFrame',(fn:any)=>0);vi.stubGlobal('cancelAnimationFrame',()=>{});moon.session=newSession('a','night',{status:'ready',clips:[{id:'one',turnId:'first',text:'第一句',audio:'data:test'}],turns:[{id:'first',role:'assistant',text:'第一句',at:0,source:'automatic',played:false}]});moon.configure({api:{},user:{},context:{groups:[],emojis:[],categories:[]}} as any);moon.busy=false;moon.handsFree=false;});
afterEach(async()=>{await moon.end();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks();});
it('角色播放期间无法录音，按序播放结束才允许接话',async()=>{await moon.play();await moon.record();expect(startStt).not.toHaveBeenCalled();const first=moon.voice!;first.onended!(new Event('ended'));await Promise.resolve();await Promise.resolve();await moon.record();expect(moon.session?.cursor).toBe(1);expect(moon.session?.turns[0].played).toBe(true);expect(startStt).toHaveBeenCalledTimes(1);});
it('暂停和继续复用当前音频，不再调用生成',async()=>{await moon.play();const audio=moon.voice;moon.pause();await moon.play();expect(moon.voice).toBe(audio);expect(generate).not.toHaveBeenCalled();});
it('同一时刻禁止第二个回复，不重复加入用户消息',async()=>{await moon.play();moon.voice!.onended!(new Event('ended'));await Promise.resolve();await Promise.resolve();let resolve!:(value:string)=>void;vi.mocked(generate).mockImplementation(()=>new Promise(r=>{resolve=r;}));const first=moon.send('我想听海的声音');await Promise.resolve();await Promise.resolve();await expect(moon.send('又一句')).rejects.toThrow('正在准备回复');resolve('海风很轻。');await first;expect(moon.session?.turns.filter(t=>t.role==='user')).toHaveLength(1);});
it('结束后过期请求不能回写或重新播放',async()=>{moon.session!.status='active';let resolve!:(value:string)=>void;vi.mocked(generate).mockImplementation(()=>new Promise(r=>{resolve=r;}));const pending=moon.send('晚安');for(let i=0;i<20&&!resolve;i++)await Promise.resolve();expect(resolve).toBeTypeOf('function');await moon.end();resolve('过期回复');await pending;expect(moon.session?.status).toBe('ended');expect(moon.voice).toBeNull();expect(moon.session?.turns.some(t=>t.text==='过期回复')).toBe(false);});
it('历史重听暂停后继续，保留同一播放器与播放位置',async()=>{moon.session!.status='ended';await moon.play();const voice=moon.voice!;voice.currentTime=8;moon.pause();await moon.play();expect(moon.voice).toBe(voice);expect(moon.voice?.currentTime).toBe(8);});
it('用户消息落盘期间，也拒绝快速重复发送',async()=>{const {storage}=await import('../features/yueqi/storage');moon.session!.status='active';let release!:()=>void;vi.mocked(storage.save).mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));const first=moon.send('第一句');await expect(moon.send('重复句')).rejects.toThrow('正在准备回复');await moon.end();release();await first;expect(moon.session?.turns.filter(t=>t.role==='user')).toHaveLength(1);expect(generate).not.toHaveBeenCalled();});
it('暂停续播后，仍然正常衔接下一段',async()=>{moon.session!.clips.push({id:'two',turnId:'second',text:'第二句',audio:'data:second'});await moon.play();const first=moon.voice!;moon.pause();await moon.play();first.onended!(new Event('ended'));for(let i=0;i<8;i++)await Promise.resolve();expect(moon.session?.cursor).toBe(1);expect(moon.voice).toBe(first);expect(moon.voice?.src).toBe('data:second');});

it('slow or failed persistence cannot block the next cached clip',async()=>{
 const {storage}=await import('../features/yueqi/storage');
 moon.session!.clips.push({id:'two',turnId:'second',text:'第二句',audio:'data:second'});
 await moon.play();const first=moon.voice!;
 vi.mocked(storage.save).mockImplementationOnce(()=>new Promise(()=>{}));
 first.onended!(new Event('ended'));
 expect(moon.voice).toBe(first);expect(moon.voice?.src).toBe('data:second');expect(moon.session?.cursor).toBe(1);
});
it('long stories carry distinct continuation instructions through all six parts',async()=>{
 moon.session=newSession('a','story',{targetMinutes:30});
 vi.mocked(generate).mockResolvedValue('新内容');await moon.prepare();
 const tasks=vi.mocked(generate).mock.calls.map(c=>c[2]);
 expect(tasks).toHaveLength(7);expect(tasks[0]).toContain('情节互不重叠');
 expect(tasks[3]).toContain('第3/6');expect(tasks[6]).toContain('第6/6');
 expect(tasks[6]).toContain('前面5部分已经讲完');
 expect(vi.mocked(generate).mock.calls[6][0].turns).toHaveLength(5);
});
