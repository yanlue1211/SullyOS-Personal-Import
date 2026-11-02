/** Existing first two desktop pages keep eight apps each. Later pages hold sixteen. */
export const isDesktopEmpty=(id:string)=>/^launcher-empty-\d+$/.test(id);
export function desktopSlots(saved:string[]|undefined,available:string[]){
 const valid=new Set(available),seen=new Set<string>();
 const slots=(saved||[]).filter(id=>{if((valid.has(id)||isDesktopEmpty(id))&&!seen.has(id)){seen.add(id);return true;}return false;});
 // Keep interior holes, but trim trailing padding before adding newly visible apps.
 const trailing:string[]=[];while(slots.length&&isDesktopEmpty(slots[slots.length-1])){const id=slots.pop()!;seen.delete(id);trailing.unshift(id);}
 for(const id of available)if(!seen.has(id)){slots.push(id);seen.add(id);}
 const count=Math.max(32,16+Math.ceil(Math.max(0,slots.length-16)/16)*16);
 let n=0;while(slots.length<count){while(seen.has('launcher-empty-'+n))n++;const id=trailing.shift()||'launcher-empty-'+n++;seen.add(id);slots.push(id);}return slots;
}
export function desktopPages<T>(slots:T[]){const pages=[slots.slice(0,8),slots.slice(8,16)];for(let i=16;i<slots.length;i+=16)pages.push(slots.slice(i,i+16));return pages;}
export function moveDesktopSlot(slots:string[],source:string,target:string){const from=slots.indexOf(source),to=slots.indexOf(target);if(from<0||to<0||from===to||isDesktopEmpty(source))return slots;const next=[...slots];if(isDesktopEmpty(target)){[next[from],next[to]]=[next[to],next[from]];}else{next.splice(from,1);next.splice(to,0,source);}return next;}
