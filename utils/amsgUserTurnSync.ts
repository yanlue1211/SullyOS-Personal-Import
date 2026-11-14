import {AMSG_USER_TURN_KEY} from './amsgUserTurn';
import {amsgStateNamespace} from './amsgFirePack';
import {isAwayCloudRoute} from './awayMessage';
import {ActiveMsgClient} from './activeMsgClient';
import {markAmsgStateDirty,type AmsgSyncSnapshot} from './amsgStateSync';
const latestUserTurns=new Map<string,number>();
/** The user turn is already committed. No generation lease and no model call. */
export async function syncCommittedAmsgUserTurn(snapshot:AmsgSyncSnapshot,lastUserMessageAt:number){
 if(!snapshot.char.awayMessage?.enabled||!Number.isFinite(lastUserMessageAt)||lastUserMessageAt<=0)return;
 latestUserTurns.set(snapshot.char.id,Math.max(latestUserTurns.get(snapshot.char.id)||0,lastUserMessageAt));
 try{if(!await isAwayCloudRoute(snapshot.char))return;}catch{return;}
 markAmsgStateDirty(snapshot);
 void ActiveMsgClient.writeClientStateValue(amsgStateNamespace(snapshot.char.id),AMSG_USER_TURN_KEY,JSON.stringify({v:1,charId:snapshot.char.id,at:latestUserTurns.get(snapshot.char.id)}))
  .catch(error=>console.warn('[AwayMessage] 用户发言标记同步失败，完整上下文同步继续重试',error));
}
