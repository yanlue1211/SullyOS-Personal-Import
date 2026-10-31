export interface WorkroomLaunch { charId: string; workId: string }
let pending: WorkroomLaunch | null = null;
const listeners = new Set<() => void>();
export const workroomLaunch = {
    request(value: WorkroomLaunch) { pending = value; listeners.forEach(listener => listener()); },
    consume() { const value = pending; pending = null; return value; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
