import {expect,it,vi} from 'vitest';
vi.mock('../features/experience/oracle',()=>({oracleContext:vi.fn().mockResolvedValue('')}));
import {ChatPrompts} from './chatPrompts';
const build=(enabled:boolean,appRules?:string)=>ChatPrompts.buildSystemPromptParts({id:'time-test',name:'角色',timeAwarenessEnabled:enabled} as any,{name:'用户'} as any,[],[],[],[],undefined,undefined,undefined,undefined,undefined,undefined,{appRules} as any);
it('puts raw-history time calibration in the uncached final reminder rather than the stable prefix',async()=>{
 const p=await build(true);
 expect(p.recencyTail).toContain('未归档的原始聊天');
 expect(p.recencyTail).toContain('不能把发言日期当成事件日期');
 expect(p.stable).not.toContain('【回复前核对时间】');
});
it('respects disabled real-time awareness and separate application rules',async()=>{
 expect((await build(false)).recencyTail).not.toContain('【回复前核对时间】');
 expect((await build(true,'独立应用规则')).recencyTail).not.toContain('【回复前核对时间】');
});
