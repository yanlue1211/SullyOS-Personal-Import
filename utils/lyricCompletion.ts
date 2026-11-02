import {DB} from './db';
import {musicApi,type MusicCfg,parseLyric} from '../context/MusicContext';
export interface LyricTrack{id:string;name:string;artists?:string;album?:string;duration?:number;url?:string;assetKey?:string;blob?:Blob;lyrics?:string}
export interface LyricCandidate{id:string;name:string;artists:string;album?:string;duration?:number;synced?:string;plain?:string;source:'netease'|'lrclib'}
export type LyricResult={status:'success'|'confirm'|'missing'|'skipped'|'failed';track:LyricTrack;candidates:LyricCandidate[];chosen?:LyricCandidate;error?:string};
export const norm=(s='')=>s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const artist=(s='')=>[...new Set(s.split(/[,，/、;&]+/).map(norm).filter(Boolean))].sort().join('/');
const version=(s:string)=>['live|现场|演唱会','remix|混音','instrumental|伴奏','cover|翻唱','acoustic|不插电'].map((p,i)=>new RegExp(p,'i').test(s)?i:'').filter(x=>x!=='').join(',');
export function exactLyricMatch(t:LyricTrack,c:LyricCandidate){return !!artist(t.artists)&&norm(t.name)===norm(c.name)&&artist(t.artists)===artist(c.artists)&&version(t.name)===version(c.name)&&(!t.duration||!c.duration||Math.abs(t.duration-c.duration)<=Math.max(5,t.duration*.02));}
export function parseVorbisTags(bytes:Uint8Array):Record<string,string>{
 const tags:Record<string,string>={},parts:Uint8Array[]=[];let size=0;
 for(let page=0;page+27<bytes.length;){if(new TextDecoder().decode(bytes.subarray(page,page+4))!=='OggS')break;const count=bytes[page+26],table=page+27;let pos=table+count;if(pos>bytes.length)break;
 for(let i=0;i<count;i++){const len=bytes[table+i];if(pos+len>bytes.length)return tags;parts.push(bytes.subarray(pos,pos+len));size+=len;pos+=len;if(len<255){const packet=new Uint8Array(size);let n=0;for(const p of parts){packet.set(p,n);n+=p.length;}parts.length=0;size=0;
 if(packet[0]===3&&new TextDecoder().decode(packet.subarray(1,7))==='vorbis'){const v=new DataView(packet.buffer);let at=7;const u32=()=>{if(at+4>packet.length)throw Error('标签不完整');const x=v.getUint32(at,true);at+=4;return x;};try{const vendorLength=u32();at+=vendorLength;const total=u32();for(let j=0;j<Math.min(total,512);j++){const len=u32();if(at+len>packet.length)break;const line=new TextDecoder().decode(packet.subarray(at,at+len));at+=len;const eq=line.indexOf('=');if(eq>0)tags[line.slice(0,eq).toUpperCase()]=line.slice(eq+1);}return tags;}catch{return tags;}}}}
 page=pos;}return tags;
}
export async function readLightMetadata(t:LyricTrack,signal:AbortSignal):Promise<Partial<LyricTrack>>{
 let bytes:Uint8Array;const cap=131072;
 if(t.assetKey&&!t.blob){const asset=await DB.getAssetRaw(t.assetKey);signal.throwIfAborted();if(asset?.blob instanceof Blob)t={...t,blob:asset.blob};}
 if(t.blob)bytes=new Uint8Array(await t.blob.slice(0,cap).arrayBuffer());
 else if(t.url?.startsWith('data:')){const [header,data]=t.url.split(',');if(!header.includes(';base64'))return {};const decoded=atob(data.slice(0,Math.ceil(cap/3)*4));bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));}
 else if(t.url?.startsWith('https:')){const response=await fetch(t.url,{headers:{Range:'bytes=0-131071'},signal});if(!response.ok||!response.body)throw Error('元数据读取失败');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let n=0;try{while(n<cap){const r=await reader.read();if(r.done)break;const part=r.value.subarray(0,cap-n);chunks.push(part);n+=part.length;}}finally{await reader.cancel().catch(()=>{});}bytes=new Uint8Array(n);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}}
 else return {};
 const tags=parseVorbisTags(bytes);return {name:tags.TITLE||undefined,artists:tags.ARTIST||undefined,album:tags.ALBUM||undefined};
}
export function bounded<T>(job:Promise<T>,signal:AbortSignal,ms=15000):Promise<T>{
 signal.throwIfAborted();return new Promise((resolve,reject)=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};const cancel=()=>{finish();reject(signal.reason||new DOMException('已取消','AbortError'));};const timer=setTimeout(()=>{finish();reject(Error('请求超时，请稍后重试'));},ms);signal.addEventListener('abort',cancel,{once:true});job.then(value=>{finish();resolve(value);},error=>{finish();reject(error);});});
}
export async function matchLyrics(track:LyricTrack,cfg:MusicCfg,signal:AbortSignal,force=false):Promise<LyricResult>{
 const result=(status:LyricResult['status'],candidates:LyricCandidate[]=[],chosen?:LyricCandidate,error?:string):LyricResult=>({status,track,candidates,chosen,error});
 signal.throwIfAborted();if(track.lyrics?.trim()&&!force)return result('skipped');
 let t={...track};const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),12000);const cancel=()=>deadline.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});
 try{if(!t.artists||/^(未知|unknown)/i.test(t.artists)||/^[\w. -]+\.(mp3|ogg)$/i.test(t.name)){const meta=await readLightMetadata(t,deadline.signal);t={...t,name:meta.name||t.name,artists:meta.artists||t.artists,album:meta.album||t.album};}}catch{/* Optional metadata never blocks lyric lookup. */}finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
 signal.throwIfAborted();if(!t.name.trim())return result('missing');
 const candidates:LyricCandidate[]=[];
 try{const r=await bounded(musicApi.search(cfg,[t.name,t.artists].filter(Boolean).join(' ')),signal);signal.throwIfAborted();for(const s of (r?.result?.songs||[]).slice(0,8))candidates.push({id:String(s.id),name:s.name,artists:(s.ar||s.artists||[]).map((a:any)=>a.name).join('/'),album:s.al?.name||s.album?.name,duration:(s.dt||s.duration||0)/1000,source:'netease'});
 for(const c of candidates.filter(c=>exactLyricMatch(t,c)).slice(0,3)){signal.throwIfAborted();const l=await bounded(musicApi.lyric(cfg,Number(c.id)),signal);signal.throwIfAborted();c.synced=parseLyric(l?.lrc?.lyric||'').length?l.lrc.lyric:undefined;c.plain=c.synced?undefined:l?.lrc?.lyric;if(c.synced||c.plain)return {...result('success',candidates,c),track:t};}}
 catch(e){signal.throwIfAborted();}
 try{const fallback=new AbortController();const stop=()=>fallback.abort();signal.addEventListener('abort',stop,{once:true});const timeout=setTimeout(stop,15000);let response:Response;try{response=await fetch('https://lrclib.net/api/search?'+new URLSearchParams({track_name:t.name,...(t.artists?{artist_name:t.artists}:{})}),{signal:fallback.signal});}finally{clearTimeout(timeout);signal.removeEventListener('abort',stop);}if(!response.ok)throw Error('歌词来源暂时不可用');const rows=await bounded(response.json(),signal);for(const r of (Array.isArray(rows)?rows:[]).slice(0,15))if(r.syncedLyrics||r.plainLyrics)candidates.push({id:String(r.id),name:r.trackName,artists:r.artistName,album:r.albumName,duration:r.duration,synced:r.syncedLyrics||undefined,plain:r.plainLyrics||undefined,source:'lrclib'});}
 catch(e){signal.throwIfAborted();if(!candidates.length)return {...result('failed',[],undefined,String(e)),track:t};}
 const exact=candidates.filter(c=>exactLyricMatch(t,c)&&(c.synced||c.plain)).sort((a,b)=>Number(!!b.synced)-Number(!!a.synced));
 if(exact.length)return {...result('success',candidates,exact[0]),track:t};
 return {...result(candidates.length?'confirm':'missing',candidates),track:t};
}
export async function resolveCandidate(c:LyricCandidate,cfg:MusicCfg,signal:AbortSignal){if(c.source==='netease'&&!c.synced&&!c.plain){const l=await bounded(musicApi.lyric(cfg,Number(c.id)),signal);signal.throwIfAborted();return {...c,synced:parseLyric(l?.lrc?.lyric||'').length?l.lrc.lyric:undefined,plain:l?.lrc?.lyric};}return c;}
export function lyricFields(c:LyricCandidate){const lines=parseLyric(c.synced||'');return {localLyrics:lines.length?lines.map(l=>l.text).join('\n'):(c.plain||c.synced||'').trim(),lyricLineTimings:lines.length?lines.map(l=>l.t):undefined,lyricTimingMode:lines.length?'synced' as const:'plain' as const};}
