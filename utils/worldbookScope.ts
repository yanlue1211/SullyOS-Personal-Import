import type { CharacterProfile, Worldbook, MountedWorldbook } from '../types';
import { toMountedWorldbook } from './worldbook';

/** Missing scope is legacy personal; never silently expand old backups. */
export const worldbookScope = (book: Pick<Worldbook, 'scope'>) => book.scope === 'global' ? 'global' : 'personal';
export const newGlobalWorldbook = (book: Worldbook): Worldbook => ({...book, scope:'global', globalEnabled:false});

/** Persist the effective union so every existing App and older backup readers see it. */
export function reconcileWorldbookMounts<T extends CharacterProfile>(char:T, library:Worldbook[]):T {
 const byId=new Map(library.map(book=>[book.id,book]));
 const excluded=new Set(char.disabledGlobalWorldbookIds || []);
 const mounted:MountedWorldbook[]=[];const seen=new Set<string>();
 const add=(book:MountedWorldbook)=>{if(!seen.has(book.id)){mounted.push(book);seen.add(book.id);}};
 for(const old of char.mountedWorldbooks || []) {
  const book=byId.get(old.id);
  if(!book){
   // Character cards carry effective snapshots even when the receiving library
   // does not contain the original global entry. Preserve these as personal.
   if(old.globalMount){const {globalMount,personalMount,...personal}=old;add(personal);}else add(old);
   continue;
  }
  if(worldbookScope(book)==='global' && book.globalEnabled){
   add({...toMountedWorldbook(book),globalMount:true,personalMount:old.globalMount ? old.personalMount===true : true,disable:book.disable || excluded.has(book.id)});
  }else if(old.globalMount){
   // Moving to personal retains current recipients, while turning global off
   // restores only explicit personal mounts that predated global inheritance.
   if(worldbookScope(book)==='personal' ? !excluded.has(book.id) : old.personalMount){
    add({...toMountedWorldbook(book),...(worldbookScope(book)==='global' && excluded.has(book.id)?{disable:true}: {})});
   }
  }else add(worldbookScope(book)==='global'?{...toMountedWorldbook(book),disable:book.disable || excluded.has(book.id)}:old);
 }
 for(const book of library)if(worldbookScope(book)==='global' && book.globalEnabled && !seen.has(book.id)){
  add({...toMountedWorldbook(book),globalMount:true,personalMount:false,disable:book.disable || excluded.has(book.id)});
 }
 const next={...char,mountedWorldbooks:mounted};
 return JSON.stringify(char.mountedWorldbooks || [])===JSON.stringify(mounted)?char:next;
}
