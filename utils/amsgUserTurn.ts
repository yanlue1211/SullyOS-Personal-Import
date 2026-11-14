export const AMSG_USER_TURN_KEY='last_user_turn_v1';
export function readAmsgUserTurnAt(raw:string|undefined,charId:string):number|null{
 try{const v=JSON.parse(raw||'null');return v?.v===1&&v.charId===charId&&Number.isFinite(v.at)&&v.at>0?v.at:null;}catch{return null;}
}
