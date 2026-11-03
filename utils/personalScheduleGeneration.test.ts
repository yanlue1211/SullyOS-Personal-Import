import { LIFE_DIVERSITY_PROMPT } from './chatPromptPreferences';
import { afterEach, expect, it, vi } from 'vitest';
import { generateDailyScheduleForChar } from './scheduleGenerator';
import { ContextBuilder } from './context';
const api = { baseUrl:'https://schedule.example/v1', apiKey:'test', model:'test' };
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('makes one generation request for concurrent loads and reuses the saved day even when forced', async()=>{
 vi.spyOn(ContextBuilder,'buildCharacterRequest').mockImplementation(async(_input,messages)=>messages as any);
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({slots:[{startTime:'08:00',activity:'画画'},{startTime:'18:00',activity:'散步'}]})}}]}),{status:200,headers:{'Content-Type':'application/json'}})); vi.stubGlobal('fetch',fetcher);
 const char={id:`schedule-gen-${Date.now()}`,name:'画师',scheduleFeatureEnabled:true,scheduleStyle:'lifestyle',systemPrompt:'画师',memories:[],description:''} as any;
 const results=await Promise.all([generateDailyScheduleForChar(char,{name:'用户'} as any,api),generateDailyScheduleForChar(char,{name:'用户'} as any,api)]);
 expect(results[0]?.slots).toHaveLength(2);expect(results[1]).toEqual(results[0]);expect(fetcher).toHaveBeenCalledTimes(1);
 await generateDailyScheduleForChar(char,{name:'用户'} as any,api,true);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not repeatedly spend requests after a failed automatic daily attempt', async()=>{
 vi.spyOn(ContextBuilder,'buildCharacterRequest').mockImplementation(async(_input,messages)=>messages as any);
 const fetcher=vi.fn(async()=>new Response('',{status:500}));vi.stubGlobal('fetch',fetcher);
 const char={id:`schedule-fail-${Date.now()}`,name:'角色',scheduleFeatureEnabled:true,systemPrompt:'角色',memories:[],description:''} as any;
 expect(await generateDailyScheduleForChar(char,{name:'用户'} as any,api)).toBeNull();
 expect(await generateDailyScheduleForChar(char,{name:'用户'} as any,api)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['lifestyle', 'mindful'])('sends life diversity to physical-life schedules only (%s), keeping the slots protocol and single request', async style => {
 vi.spyOn(ContextBuilder,'buildCharacterRequest').mockImplementation(async(_input,messages)=>messages as any);
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({slots:[{startTime:'08:00',activity:'排练'}]})}}]}),{status:200,headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
 const char={id:`schedule-diversity-${style}-${Date.now()}`,name:'角色',scheduleFeatureEnabled:true,scheduleStyle:style,systemPrompt:'角色',memories:[],description:''} as any;
 await generateDailyScheduleForChar(char,{name:'用户'} as any,api);
 expect(fetcher).toHaveBeenCalledTimes(1);
 const messages=JSON.parse((fetcher.mock.calls[0] as any)[1].body).messages;
 const sent=messages.map((message:any)=>message.content).join('\n');
 expect(sent.includes(LIFE_DIVERSITY_PROMPT)).toBe(style==='lifestyle');
 expect(sent).toContain('只输出 JSON {"slots":[{"startTime":"08:00","activity":"活动","description":"简要计划","emoji":"☀️"}]}');
 expect(sent).toContain('不生成情绪或预设心声');
});
