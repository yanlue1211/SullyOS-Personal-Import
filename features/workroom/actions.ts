export interface GameAction {id:string;label:string}
export function readGameActions(value:unknown):GameAction[]{
 if(!Array.isArray(value)||value.length>12)throw Error('角色动作最多12个');
 const ids=new Set<string>();return value.map(v=>{if(!v||typeof v.id!=='string'||! /^[a-zA-Z0-9_-]{1,60}$/.test(v.id)||typeof v.label!=='string'||!v.label.trim()||v.label.length>100||ids.has(v.id))throw Error('角色动作无效');ids.add(v.id);return {id:v.id,label:v.label};});
}
