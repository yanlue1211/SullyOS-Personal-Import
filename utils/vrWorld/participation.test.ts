import { afterEach, expect, it, vi } from 'vitest';
import { allowsAutomaticVR, joinVRState, withLatestVRParticipation, isSARActivityOccupant } from './participation';
import { VRScheduler } from './scheduler';

afterEach(() => {
    VRScheduler.reconcile([]);
    VRScheduler.onTrigger(() => {});
    VRScheduler.reconcile([]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

it('only places characters with a current SAR activity in the SAR room',()=>{
    browser();
    const state={enabled:true,intervalMinutes:120};
    expect(isSARActivityOccupant({vrState:state})).toBe(false);
    expect(isSARActivityOccupant({vrState:{...state,currentRoom:'sar'}})).toBe(false);
    expect(isSARActivityOccupant({vrState:{...state,currentRoom:'library',sarActivity:'fishing'}})).toBe(false);
    for(const sarActivity of ['cabinet','module-shop','fishing','market','garden'] as const){
        expect(isSARActivityOccupant({vrState:{...state,currentRoom:'sar',sarActivity}})).toBe(true);
        expect(isSARActivityOccupant({vrState:{...state,enabled:false,currentRoom:'sar',sarActivity}})).toBe(false);
    }
});

const browser = () => {
    vi.stubGlobal('document', {visibilityState:'visible',addEventListener(){},removeEventListener(){}});
    vi.stubGlobal('window', {addEventListener(){},removeEventListener(){}});
};

it('new participation needs no automatic schedule; existing automatic users keep their setting', () => {
    browser();
    const joined = joinVRState();
    expect(joined).toMatchObject({enabled:true,activityMode:'manual'});
    expect(allowsAutomaticVR(joined)).toBe(false);
    const legacy = {enabled:true,intervalMinutes:240};
    expect(allowsAutomaticVR(legacy)).toBe(true);
    expect(joinVRState(legacy)).toMatchObject({activityMode:'scheduled',intervalMinutes:240});
    expect(joinVRState({...joined,enabled:false})).toMatchObject({enabled:true,activityMode:'manual'});
    expect(allowsAutomaticVR({enabled:false,intervalMinutes:60,activityMode:'scheduled'})).toBe(false);
});

it('restoring manual participation removes stale schedules; inviting once does not restart them', () => {
    browser();vi.useFakeTimers();
    localStorage.clear();
    const trigger=vi.fn();
    VRScheduler.onTrigger(trigger);
    VRScheduler.start('manual',30);
    const characters=[{id:'manual',vrState:joinVRState()},{id:'legacy',vrState:{enabled:true,intervalMinutes:60}}];
    VRScheduler.reconcile(characters.filter(c=>allowsAutomaticVR(c.vrState)).map(c=>({charId:c.id,intervalMinutes:c.vrState.intervalMinutes})));
    expect(VRScheduler.isActiveFor('manual')).toBe(false);
    vi.advanceTimersByTime(31*60*1000);
    expect(trigger).not.toHaveBeenCalled();
    VRScheduler.triggerNow('manual','sar');
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('manual','sar',undefined,true);
    expect(VRScheduler.isActiveFor('manual')).toBe(false);
    vi.advanceTimersByTime(31*60*1000);
    expect(trigger.mock.calls.filter(c=>c[0]==='manual')).toHaveLength(1);
    expect(trigger.mock.calls.some(c=>c[0]==='legacy')).toBe(true);
});

it('finishing an in-flight activity cannot undo a switch to manual or disabled', () => {
    browser();
    const patch={vrState:{enabled:true,intervalMinutes:120,currentRoom:'sar' as const,activityMode:'scheduled' as const,lastActiveAt:123}};
    const current={id:'a',vrState:{enabled:true,intervalMinutes:240,activityMode:'manual'}} as any;
    expect(withLatestVRParticipation(current,patch).vrState).toMatchObject({enabled:true,activityMode:'manual',intervalMinutes:240,currentRoom:'sar',lastActiveAt:123});
    expect(withLatestVRParticipation({...current,vrState:{...current.vrState,enabled:false}},patch).vrState?.enabled).toBe(false);
});

it('repairs a restored automatic schedule whose last-fire timestamp was lost without firing immediately', () => {
    browser(); vi.useFakeTimers(); localStorage.clear();
    const trigger = vi.fn();
    localStorage.setItem('vr_schedules', JSON.stringify({legacy: {charId:'legacy', intervalMs:30*60*1000}}));
    VRScheduler.onTrigger(trigger);
    VRScheduler.reconcile([{charId:'legacy', intervalMinutes:30}]);
    expect(trigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29*60*1000);
    expect(trigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60*1000);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('legacy');
    VRScheduler.reconcile([{charId:'legacy', intervalMinutes:30}]);
    vi.advanceTimersByTime(30*60*1000);
    expect(trigger).toHaveBeenCalledTimes(2);
});

it('restores the 08:00 activity and 12h setting before checking a stale short schedule', () => {
    browser(); vi.useFakeTimers(); localStorage.clear();
    const morning = Date.UTC(2026,10,11,0);
    vi.setSystemTime(morning + 60*60*1000);
    localStorage.setItem('vr_schedules', JSON.stringify({legacy:{charId:'legacy',intervalMs:30*60*1000}}));
    localStorage.setItem('vr_last_fire', JSON.stringify({legacy:morning-60*60*1000}));
    const trigger=vi.fn();
    VRScheduler.reconcile([{charId:'legacy',intervalMinutes:720,lastActiveAt:morning}]);
    VRScheduler.onTrigger(trigger);
    expect(trigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11*60*60*1000-1);
    expect(trigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(trigger).toHaveBeenCalledTimes(1);
});

it('importing old activity without a schedule waits a full interval instead of calling immediately', () => {
    browser(); vi.useFakeTimers(); localStorage.clear();
    const now=Date.UTC(2026,10,11,0);
    vi.setSystemTime(now);
    const trigger=vi.fn();
    VRScheduler.reconcile([{charId:'imported',intervalMinutes:720,lastActiveAt:now-3*24*60*60*1000}]);
    VRScheduler.onTrigger(trigger);
    expect(trigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(12*60*60*1000-1);
    expect(trigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(trigger).toHaveBeenCalledTimes(1);
});
