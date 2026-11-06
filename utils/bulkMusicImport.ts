import type {Song} from '../context/MusicContext';
export interface ImportCandidate {key:string;url:string;song:Song;error?:string}
export function parseMusicLinks(text:string):string[]{
 const links=text.match(/https?:\/\/[^\s<>"，。]+/g)||[];
 const unique=[...new Set(links.map(x=>x.replace(/[)）;,；]+$/,'')))];
 if(!unique.length)throw Error('请输入歌曲链接，每行一条');
 if(unique.length>100)throw Error('每次最多100条链接');
 return unique;
}
export async function identifyMusicLinks(text:string,readDetail:(id:number)=>Promise<any>):Promise<ImportCandidate[]>{
 const out:ImportCandidate[]=[];
 for(const [index,raw] of parseMusicLinks(text).entries()){
  const url=new URL(raw),key=crypto.randomUUID();
  const id=/(?:^|\.)music\.163\.com$/.test(url.hostname)?Number(raw.match(/(?:[?&]id=|\/song\/)(\d+)/)?.[1]):0;
  let song:Song={id:-(Date.now()*1000+index),name:'',artists:'',album:'导入的歌曲',albumPic:'',duration:0,fee:0,local:true,remoteAudioUrl:url.href,localLyrics:'',lyricTimingMode:'plain'};
  let error:string|undefined;
  if(url.protocol!=='https:'){error='请换成 HTTPS 链接';}
  else if(id){
   song={...song,id,local:false,remoteAudioUrl:undefined};
   try{const data=await readDetail(id),track=data?.songs?.[0];if(!track||track.id!==id)throw Error('没有返回歌曲信息');song={...song,name:track.name||'',artists:(track.ar||track.artists||[]).map((x:any)=>x.name).join(' / '),album:track.al?.name||'',albumPic:(track.al?.picUrl||'').replace(/^http:/,'https:'),duration:(track.dt||0)/1000,fee:track.fee||0};}
   catch{error='信息读取失败，可手动填写名称和歌手后导入';}
  }else{
   const file=decodeURIComponent(url.pathname.split('/').pop()||'');
   song.name=file.replace(/\.(mp3|flac|m4a|wav|ogg|aac|opus)$/i,'');
  }
  out.push({key,url:raw,song,error});
 }
 return out;
}
