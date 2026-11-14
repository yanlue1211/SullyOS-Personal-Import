import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({dirty:vi.fn(),write:vi.fn().mockResolvedValue(undefined),route:vi.fn().mockResolvedValue(true)}));
vi.mock('./amsgStateSync',()=>({markAmsgStateDirty:m.dirty}));vi.mock('./activeMsgClient',()=>({ActiveMsgClient:{writeClientStateValue:m.write}}));vi.mock('./awayMessage',()=>({isAwayCloudRoute:m.route}));
import {syncCommittedAmsgUserTurn} from './amsgUserTurnSync';
const snapshot={char:{id:'a',awayMessage:{enabled:true}},userProfile:{},groups:[]} as any;
beforeEach(()=>{vi.clearAllMocks();m.route.mockResolvedValue(true);});
it('publishes a committed user message without a generated reply or generation lease',async()=>{await syncCommittedAmsgUserTurn(snapshot,1000);expect(m.dirty).toHaveBeenCalledWith(snapshot);expect(m.write).toHaveBeenCalledWith('amsg:char:a','last_user_turn_v1',JSON.stringify({v:1,charId:'a',at:1000}));});
it('older events cannot regress the latest committed user time',async()=>{await syncCommittedAmsgUserTurn(snapshot,3000);await syncCommittedAmsgUserTurn(snapshot,2000);expect(JSON.parse(m.write.mock.calls.at(-1)![2]).at).toBe(3000);});
it('local route and disabled away settings cause no cloud writes',async()=>{m.route.mockResolvedValue(false);await syncCommittedAmsgUserTurn(snapshot,4000);await syncCommittedAmsgUserTurn({...snapshot,char:{id:'b',awayMessage:{enabled:false}}},4000);expect(m.dirty).not.toHaveBeenCalled();expect(m.write).not.toHaveBeenCalled();});
