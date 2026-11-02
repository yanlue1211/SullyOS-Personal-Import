import {result,type Post,type Config} from './schema';
import {postText,canRead} from './permissions';
/** Source-linked palace memories and literal legacy citations are repaired atomically. */
export async function repairMomentMemories(tx:IDBTransaction,old:Post,next:Post|null,config:Config){
 const nodes=tx.objectStore('memory_nodes'),all:any[]=await result(nodes.getAll());
 const literal=(text:unknown)=>typeof text==='string'&&((text.includes('动态ID：'+old.id)||(old.id.length>=16&&text.includes(old.id)))||(old.text.length>=8&&text.includes(old.text)&&text.includes(old.name)&&text.includes('朋友圈')));
 const affected=new Set(all.filter(n=>n.sourcePostIds?.includes(old.id)||literal(n.content)).map(n=>n.id));
 let changed=true;while(changed){changed=false;for(const n of all)if(n.sourceId&&affected.has(n.sourceId)&&!affected.has(n.id)){affected.add(n.id);changed=true;}}
 for(const n of all.filter(n=>affected.has(n.id))){
  if(!next||!canRead(config,n.charId,next))nodes.delete(n.id);
  else nodes.put({...n,content:`${postText(next)}（${new Date(next.at).toISOString()}）`,sourcePostIds:[old.id],embedded:false});
  tx.objectStore('memory_vectors').delete(n.id);
 }
 const assets=tx.objectStore('assets');
 for(const charId of new Set(all.filter(n=>affected.has(n.id)).map(n=>n.charId))){
  const key='moments-invalid-memory:'+charId,existing=await result<any>(assets.get(key));
  assets.put({id:key,data:[...new Set([...(Array.isArray(existing?.data)?existing.data:[]),...all.filter(n=>n.charId===charId&&affected.has(n.id)).map(n=>n.id)])]});
 }
 const links=tx.objectStore('memory_links');for(const link of await result<any[]>(links.getAll()))if(affected.has(link.sourceId)||affected.has(link.targetId))links.delete(link.id);
 const characters=tx.objectStore('characters');
 for(const char of await result<any[]>(characters.getAll())){
  let dirty=false;
  const rewrite=(text:string)=>{if(!literal(text))return text;dirty=true;return next&&canRead(config,char.id,next)?(old.text?text.split(old.text).join(next.text):text).split(old.id).join(next.id):text.split('\n').filter(line=>!literal(line)).join('\n');};
  const memories=(char.memories||[]).flatMap((fragment:any)=>{
   if(affected.has(fragment.palaceMemoryId)){dirty=true;return next&&canRead(config,char.id,next)?[{...fragment,summary:postText(next)}]:[];}
   const summary=rewrite(fragment.summary||'');return summary.trim()?[{...fragment,summary}]:[];
  });
  const refinedMemories=Object.fromEntries(Object.entries(char.refinedMemories||{}).map(([key,value])=>[key,typeof value==='string'?rewrite(value):value]));
  if(dirty)characters.put({...char,memories,refinedMemories});
 }
}
