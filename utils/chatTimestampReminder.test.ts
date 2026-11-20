import {expect,it,vi} from 'vitest';
vi.mock('../features/experience/oracle',()=>({oracleContext:vi.fn().mockResolvedValue('')}));
import {ChatPrompts} from './chatPrompts';
const build=(enabled:boolean,appRules?:string)=>ChatPrompts.buildSystemPromptParts({id:'time-test',name:'角色',timeAwarenessEnabled:enabled} as any,{name:'用户'} as any,[],[],[],[],undefined,undefined,undefined,undefined,undefined,undefined,{appRules} as any);
it('puts raw-history time calibration in the uncached final reminder rather than the stable prefix',async()=>{
 const p=await build(true);
 expect(p.recencyTail).toContain('未归档的原始聊天');
 expect(p.recencyTail).toContain('不能把发言日期当成事件日期');
 expect(p.recencyTail).toContain('区分两种表达');
 expect(p.recencyTail).toContain('零点不强行切断');
 expect(p.recencyTail).toContain('10日凌晨4点是前天凌晨');
 expect(p.recencyTail).toContain('11日凌晨3点是昨天凌晨');
 expect(p.recencyTail).toContain('9日晚上9点可与10日凌晨4点视作前天那晚');
 expect(p.recencyTail).toContain('10日晚上9点按日期是前天晚上');
 expect(p.recencyTail).toContain('12日下午2点，再提12日凌晨1点的事可称昨晚');
 expect(p.recencyTail).not.toMatch(/睡觉|睡醒|几点睡|几点醒|作息/);
 expect(p.stable).not.toContain('【回复前核对时间】');
});
it('respects disabled real-time awareness and separate application rules',async()=>{
 expect((await build(false)).recencyTail).not.toContain('【回复前核对时间】');
 expect((await build(true,'独立应用规则')).recencyTail).not.toContain('【回复前核对时间】');
});
