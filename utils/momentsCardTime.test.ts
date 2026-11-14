import {it,expect,vi} from 'vitest';
import {activityTime,activityCardText} from '../features/moments/cards';
it('renders a UTC event in device local time with an explicit offset, including half-hour zones',()=>{
 const value='2026-11-14T09:04:06.117Z';
 for(const [zone,want] of [['Asia/Shanghai','2026-11-14 17:04 (UTC+08:00)'],['America/New_York','2026-11-14 04:04 (UTC-05:00)'],['Asia/Kolkata','2026-11-14 14:34 (UTC+05:30)']]){
  vi.stubEnv('TZ',zone);
  try{expect(activityTime(value)).toBe(want);expect(activityCardText([],value)).toContain(want);}finally{vi.unstubAllEnvs();}
 }
});
