export interface WorkroomLaunch { charId: string; workId: string; shareId?: string }
let pending: WorkroomLaunch | null = null;
const listeners = new Set<() => void>();
export const workroomLaunch = {
    request(value: WorkroomLaunch) { pending = value; listeners.forEach(listener => listener()); },
    consume() { const value = pending; pending = null; return value; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

let pendingAsk: {charId:string;shareId:string} | null = null;
export function requestWorkroomCollection(charId:string,shareId:string){pendingAsk={charId,shareId};window.dispatchEvent(new CustomEvent('workroom-chat-requested',{detail:{charId}}));}
export function consumeWorkroomCollection(charId:string){if(pendingAsk?.charId!==charId)return null;const value=pendingAsk;pendingAsk=null;return value;}
