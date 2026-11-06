/** Local, deterministic address matching; no model call or bare-character substring matching. */
export function resolveMomentsNames<T extends {id:string;name:string}>(text:string,characters:T[]):T[]{
 const names=characters.map(c=>({...c,name:c.name.trim()})).filter(c=>c.name);
 const full=names.filter(c=>[...c.name].length>1);
 const identity=(c:T):string=>{
  if([...c.name].length!==1||!/^\p{Script=Han}$/u.test(c.name))return c.name;
  const parents=[...new Set(full.filter(p=>p.name.includes(c.name)).map(p=>p.name))];
  return parents.length===1?parents[0]:c.name;
 };
 const groups=new Map<string,T[]>();
 for(const c of names){const key=identity(c);groups.set(key,[...(groups.get(key)||[]),c]);}
 const hit=(name:string)=>{
  if([...name].length>1)return text.includes(name);
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(!/^[\p{Script=Han}]$/u.test(name))return new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?=$|[^a-zA-Z0-9])`,'i').test(text);
  return new RegExp(`(?:^|[^\\p{L}\\p{N}]|看看|看一下|去看|去刷|查看|翻翻)${escaped}(?=$|[^\\p{L}\\p{N}]|的|说|发|在|朋友圈)`,'u').test(text);
 };
 let matches=[...groups].filter(([name,members])=>hit(name)||members.some(m=>hit(m.name)));
 const addressed=matches.flatMap(([name,members])=>[name,...members.map(m=>m.name)]).filter(n=>n.length>1).reduce((body,n)=>body.split(n).join(' '),text);
 const aliasMatches=[...groups].filter(([name,members])=>{
  const aliases=new Set<string>();
  for(const n of [name,...members.map(m=>m.name)])if(/^[\p{Script=Han}]{1,4}$/u.test(n)){
   for(const ch of n){for(const prefix of ['小','老','阿'])aliases.add(prefix+ch);for(const suffix of ['哥','哥哥','姐','姐姐','老师','总'])aliases.add(ch+suffix);aliases.add(ch+ch);}
   if(n.length>=3)aliases.add(n.slice(1));
  }
  return [...aliases].some(a=>addressed.includes(a));
 });
 matches=[...matches,...aliasMatches.filter(([key])=>!matches.some(([known])=>known===key))];
 // Distinct identities remain ambiguous. Same-name / one-character account variants form one group.
 return matches.length===1?matches[0][1]:[];
}
