import type {SongSheet, SongLine} from '../../types';
import type {MelodyBar, MelodyVersion} from './melody';
import {finalLines} from './model';
export interface VocalPhrase {
  id: string;
  lineId?: string;
  lyricText?: string;
  section: SongLine['section'];
  start: number; // inclusive measure index
  count: number;
}
export interface VocalTarget { scope: 'line' | 'section' | 'song'; lineIds: string[]; phraseIds?: string[]; section?: SongLine['section'] }
export interface LyricSectionGroup { section:SongLine['section']; occurrence:number; start:number; end:number; label:string }
const englishSections:Record<SongLine['section'],string>={intro:'Intro',verse:'Verse','pre-chorus':'Pre-chorus',chorus:'Chorus',bridge:'Bridge',outro:'Outro',free:'Free'};
const chineseSections:Record<SongLine['section'],string>={intro:'前奏',verse:'主歌','pre-chorus':'预副歌',chorus:'副歌',bridge:'桥段',outro:'尾奏',free:'自由段落'};
/** Repeated verse/chorus blocks are separate selectable occurrences, never one merged type. */
export function lyricSectionGroups(song:SongSheet):LyricSectionGroup[]{
 const lines=finalLines(song),groups:LyricSectionGroup[]=[],counts=new Map<string,number>();
 for(let start=0;start<lines.length;){
  const section=lines[start].section;let end=start+1;
  while(end<lines.length&&lines[end].section===section)end++;
  const occurrence=(counts.get(section)||0)+1;counts.set(section,occurrence);
  groups.push({section,occurrence,start,end,label:`${chineseSections[section]} ${occurrence} · ${englishSections[section]} ${occurrence}`});start=end;
 }
 return groups;
}
export function vocalTarget(song: SongSheet, scope: VocalTarget['scope'], position = 0): VocalTarget {
  const lines=finalLines(song),index=Math.max(0,Math.min(position,lines.length-1));
  if(scope==='song')return {scope,lineIds:lines.map(l=>l.id)};
  const selected=lines[index];if(!selected)return {scope,lineIds:[],section:'verse'};
  let start=index,end=index+1;
  if(scope==='section'){const group=lyricSectionGroups(song).find(g=>index>=g.start&&index<g.end);if(group){start=group.start;end=group.end;}}
  return {scope,lineIds:lines.slice(start,end).map(l=>l.id),section:selected.section};
}
export function vocalPhrases(version: MelodyVersion): VocalPhrase[] {
  return version.phrases?.length ? version.phrases : [{id:'legacy:'+version.id,section:'free',start:0,count:version.bars.length}];
}
export function phraseForLine(song: SongSheet, version: MelodyVersion | undefined, lineId: string): VocalPhrase | undefined {
  const line=finalLines(song).find(l=>l.id===lineId);
  return line&&version ? vocalPhrases(version).find(p=>p.lineId===lineId&&p.lyricText===line.content) : undefined;
}
export function selectVocalRange(song: SongSheet, version: MelodyVersion, target: VocalTarget): {version:MelodyVersion;key:string;label:string} {
  const phrases=vocalPhrases(version);
  const chosen=target.scope==='song'?phrases:phrases.filter(p=>target.phraseIds?.includes(p.id)||target.lineIds.some(id=>phraseForLine(song,version,id)?.id===p.id));
  if(!chosen.length)throw Error('这个范围还没有对应曲调，请先谱曲或关联歌词');
  const bars:MelodyBar[]=[],out:VocalPhrase[]=[];
  for(const p of chosen){out.push({...p,start:bars.length});bars.push(...version.bars.slice(p.start,p.start+p.count));}
  return {version:{...version,bars,phrases:out},key:target.scope==='song'?'song':chosen.map(p=>p.id).join('|'),label:target.scope==='song'?'整首':(target.scope==='line'?'单句：':'段落：')+chosen.map(p=>p.lyricText||`第${phrases.indexOf(p)+1}乐句`).join(' / ')};
}
/** Explicit bindings survive lyric edits; unchanged text follows new line IDs. Changed text is
 * marked by its old snapshot until the user binds it or asks the character to adapt it.
 * Never require one character per note: an entire phrase can contain melisma/rests/sustains. */
export function alignVocalLyrics(song: SongSheet, oldLines: SongLine[]): SongSheet {
  const project=(song as any).melody as {activeId:string;versions:MelodyVersion[]}|undefined;
  if(!project)return song;
  const lines=finalLines(song),old=oldLines.filter(l=>!l.isDraft);
  const versions=project.versions.map(v=>{
    if(v.id!==project.activeId||!v.phrases?.length)return v;
    const used=new Set<string>();
    const phrases=v.phrases.map(p=>{
      const existing=lines.find(l=>l.id===p.lineId&&l.content===p.lyricText);
      const same=lines.filter(l=>l.content===p.lyricText&&!used.has(l.id));
      const next=existing||(same.length===1?same[0]:undefined);
      if(next){used.add(next.id);return {...p,lineId:next.id,section:next.section};}return {...p};
    });
    // Melody-first: bind a matching number of new lyric lines in their written order.
    const unbound=phrases.filter(p=>!p.lineId&&!p.lyricText);
    const additions=lines.filter(l=>!used.has(l.id)&&!old.some(o=>o.id===l.id||o.content===l.content));
    if(unbound.length&&unbound.length===additions.length)unbound.forEach((p,i)=>{p.lineId=additions[i].id;p.lyricText=additions[i].content;p.section=additions[i].section;});
    return {...v,phrases};
  });
  return {...song,melody:{...project,versions}} as SongSheet;
}
export function inferVocalTarget(song: SongSheet, text: string, fallback: VocalTarget): VocalTarget {
  const numeric=text.match(/第\s*(\d+)\s*句/);
  if(numeric)return vocalTarget(song,'line',Number(numeric[1])-1);
  const chinese=text.match(/第([一二三四五六七八九十])句/);
  if(chinese)return vocalTarget(song,'line','一二三四五六七八九十'.indexOf(chinese[1]));
  if(/整首|全曲|全部旋律/.test(text))return vocalTarget(song,'song');
  const named=text.match(/(?:verse|主歌)\s*(\d+)|(?:chorus|副歌)\s*(\d+)|(?:bridge|桥段)\s*(\d+)/i);
  if(named){const section=named[1]?'verse':named[2]?'chorus':'bridge';const occurrence=Number(named[1]||named[2]||named[3]);const group=lyricSectionGroups(song).find(g=>g.section===section&&g.occurrence===occurrence);if(group)return vocalTarget(song,'section',group.start);}
  const sections=[['副歌','chorus'],['主歌','verse'],['桥段','bridge'],['尾奏','outro'],['前奏','intro']] as const;
  for(const [word,section]of sections)if(text.includes(word)){const index=finalLines(song).findIndex(l=>l.section===section);if(index>=0)return vocalTarget(song,'section',index);}
  return fallback;
}
