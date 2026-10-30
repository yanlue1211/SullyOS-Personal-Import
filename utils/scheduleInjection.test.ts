import { describe, expect, it } from 'vitest';
import { buildScheduleInjection, getFlowNarrativeKey, resolveScheduleSlots, type RenderableSchedule } from './scheduleInjection';
const schedule: RenderableSchedule = { slots:[{startTime:'07:00',activity:'晨跑'},{startTime:'13:00',activity:'写稿'},{startTime:'22:00',activity:'看剧'}], flowNarrative:{morning:'预先写好的独白',evening:'旧的夜间独白'} };
const at=(hour:number)=>new Date(2026,7,2,hour);
describe('daily initial plan context',()=>{
 it('defaults to the full plan at every hour instead of declaring planned events as current facts',()=>{const morning=buildScheduleInjection(schedule,undefined,at(1));expect(morning).toBe(buildScheduleInjection(schedule,undefined,at(14)));expect(morning).toBe(buildScheduleInjection(schedule,undefined,at(23)));for(const word of ['晨跑','写稿','看剧'])expect(morning).toContain(word);expect(morning).not.toContain('你正在');});
 it('explains that the initial plan is flexible and is not a demand on the user',()=>{const out=buildScheduleInjection(schedule);expect(out).toContain('不是已发生事实');expect(out).toContain('灵活调整');expect(out).toContain('不是给对方列的待办');expect(out).toContain('不用追着问进展');});
 it('does not inject pre-generated emotions as the new per-turn inner voice',()=>{const out=buildScheduleInjection(schedule,'另一个旧独白');expect(out).not.toContain('预先写好');expect(out).not.toContain('旧的夜间');expect(out).not.toContain('另一个旧独白');});
 it('honors disabled clock awareness while preserving activities',()=>{const out=buildScheduleInjection(schedule,undefined,at(14),{includeClock:false});expect(out).toContain('晨跑');expect(out).not.toContain('07:00');expect(out).not.toContain('13:00');expect(out).not.toContain('22:00');});
 it('does not inject an empty schedule',()=>{expect(buildScheduleInjection(null)).toBe('');expect(buildScheduleInjection({slots:[]})).toBe('');});
 it('keeps original slot lookup available to music and home consumers',()=>{expect(resolveScheduleSlots(schedule,at(14)).current?.activity).toBe('写稿');expect(getFlowNarrativeKey(1)).toBe('morning');expect(getFlowNarrativeKey(13)).toBe('afternoon');expect(getFlowNarrativeKey(21)).toBe('evening');});
});
