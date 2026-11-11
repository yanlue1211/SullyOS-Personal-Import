import {it,expect,vi,afterEach} from 'vitest';
import {ContextBuilder} from './context';
import {buildStoryCharacterContextParts} from './storyTheaterContextParts';
import {compileStoryPreset,BUILTIN_NIGHT_SCREENING_PRESET,appendStoryUserTurn} from './storyTheater';
import {toAnthropicRequest} from './anthropicApi';
import * as schedules from './dailySchedule';
const preset=(history=true)=>({...structuredClone(BUILTIN_NIGHT_SCREENING_PRESET),document:{...structuredClone(BUILTIN_NIGHT_SCREENING_PRESET.document),prompts:[
 {id:'a',enabled:true,role:'system',marker:'characters',content:''},
 {id:'p',enabled:true,role:'system',marker:'user',content:''},
 {id:'s',enabled:true,role:'system',marker:'scenario',content:''},
 {id:'h',enabled:history,role:'system',marker:'history',content:''},
]}} as any);
const history=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:'past '+i})) as any;
const compile=(round:number,p=preset(),rows=history)=>compileStoryPreset({preset:p,userName:'小明',characterNames:['角色甲'],historyMessages:rows,
 slots:{actors:'固定角色',persona:'固定身份',scenario:'固定场景',worldBefore:'',worldAfter:''},
 liveSlots:{actors:'本轮召回 '+round,persona:'面具召回 '+round,scenario:'档案召回 '+round}});
const native=(r:any)=>toAnthropicRequest({model:'claude-opus-5-5',messages:appendStoryUserTurn(r.messages,'继续',r.assistantPrefill,true)});
const prefix=(r:any)=>{const n=native(r);const blocks=n.messages.flatMap((m:any)=>m.content);const last=blocks.findLastIndex((b:any)=>b.cache_control);return {system:n.system,blocks:blocks.slice(0,last+1)};};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('keeps preset order and the actual history cached while actor, mask and archive recalls change',()=>{
 const a=compile(1),b=compile(2);expect(prefix(a)).toEqual(prefix(b));
 expect(JSON.stringify(prefix(a))).toContain('past 29');expect(JSON.stringify(prefix(a))).not.toContain('本轮召回');
 for(const text of ['本轮召回 2','面具召回 2','档案召回 2'])expect(JSON.stringify(native(b))).toContain(text);
 expect(a.messages.slice(0,3).map(m=>m.content)).toEqual(['固定角色','固定身份','固定场景']);
});
it('does not re-enable disabled slots, inject memory for missing slots, or move assistant prefill',()=>{
 const p=preset();p.document.prompts[0].enabled=false;p.document.assistantPrefill='正文开头';
 const r=compile(1,p);expect(JSON.stringify(r)).not.toContain('本轮召回');
 expect(appendStoryUserTurn(r.messages,'继续',r.assistantPrefill).at(-1)).toEqual({role:'assistant',content:'正文开头'});
 expect(appendStoryUserTurn(r.messages,'继续',r.assistantPrefill,true).at(-1)?.role).toBe('user');
});
it.each([false,true])('preserves first-turn/disabled-history slot context without creating fake dialogue (history=%s)',enabled=>{
 const r=compile(1,preset(enabled),[]);expect(r.messages.every(m=>m.role==='system')).toBe(true);
 expect(r.messages[0].content).toBe('固定角色\n\n本轮召回 1');
});
it.each([false,true])('splits the original core context without another retrieval or losing carried text (realTime=%s)',async realTime=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
 vi.spyOn(schedules,'getDailyScheduleForChar').mockResolvedValue(null);
 const char:any={id:'a',name:'角色甲',systemPrompt:'固定角色甲',memoryPalaceEnabled:true,memories:[],customTimezoneEnabled:true,customTimezone:'UTC'};
 const input:any={char,user:{name:'小明'},recalled:'角色甲的召回一',recent:[{id:1,charId:'a',role:'user',type:'text',content:'携带的原文一',timestamp:1}],identityName:'面具',header:'[剧情角色：角色甲]',skipWorldbookIds:new Set(),realTime};
 const a=await buildStoryCharacterContextParts(input);vi.setSystemTime(new Date('2026-11-11T12:02:00Z'));
 const b=await buildStoryCharacterContextParts({...input,recalled:'角色甲的召回二'});
 expect(a.stable).toBe(b.stable);expect(a.stable).not.toContain('召回一');expect(a.stable).not.toContain('当前时间 (Now)');
 expect(a.live).toContain('角色甲的召回一');expect(b.stable).toContain('携带的原文一');
 expect(b.live).not.toContain('携带的原文一');
 const changed=await buildStoryCharacterContextParts({...input,recent:[{...input.recent[0],content:'携带的原文二'}]});
 expect(changed.stable).toContain('携带的原文二');expect(changed.stable).not.toContain('携带的原文一');
 expect(a.live.includes('当前时间 (Now)')).toBe(realTime);
 expect(char).not.toHaveProperty('memoryPalaceInjection');
});

it('caches real history after fixed preset user/assistant examples and system slots', () => {
    const p = preset();
    p.document.prompts.unshift(
        {id: 'example-user', enabled: true, role: 'user', content: '固定示例请求'},
        {id: 'example-assistant', enabled: true, role: 'assistant', content: '固定示例回复'},
    );
    const a = compile(1, p), b = compile(2, p);
    expect(prefix(a)).toEqual(prefix(b));
    expect(JSON.stringify(prefix(a))).toContain('past 29');
    expect(JSON.stringify(prefix(a))).not.toContain('本轮召回');
    expect(a.messages.find(message => message.content === '固定角色')?.name).toBe('sully_history_context');
    expect(a.messages.find(message => message.content.includes('本轮剧情上下文'))?.name).toBeUndefined();
});

it('preserves the previous cached history prefix when the scene gains another dialogue pair', () => {
    const a = native(compile(1));
    const b = native(compile(2, preset(), [...history,
        {role: 'user', content: '下一轮推进'},
        {role: 'assistant', content: '下一轮正文'},
    ]));
    const flatten = (request: any) => request.messages.flatMap((message: any) => message.content.map((block: any) => ({role: message.role, ...block})));
    const oldBlocks = flatten(a);
    const end = oldBlocks.findLastIndex((block: any) => block.cache_control);
    const strip = ({cache_control: _cache, ...block}: any) => block;
    expect(flatten(b).slice(0, end + 1).map(strip)).toEqual(oldBlocks.slice(0, end + 1).map(strip));
});
