import type {SongSheet} from '../../types';
import {getMelody,type MelodyVersion,type SongWithMelody} from './melody';
import {selectVocalRange,type VocalTarget} from './vocalMelody';
import {renderMelodyAudio} from './melodyAudio';
import {mutateSong} from './storage';
import {describeMelodyWithAudioApi,songAudioToPayload} from '../../utils/audioApi';
import {loadAudioApiConfig} from '../../utils/songListening';
const running=new Map<string,Promise<SongSheet>>();
export function listenVocalRange(song:SongSheet,version:MelodyVersion,target:VocalTarget):Promise<SongSheet>{
 const range=selectVocalRange(song,version,target),key=song.id+':'+version.id+':'+range.key;
 if(running.has(key))return running.get(key)!;
 const task=(async()=>{
  if(version.listeningReports?.some(r=>r.key===range.key)||(range.key==='song'&&version.listening))return song;
  const config=loadAudioApiConfig();if(!config?.enabled)throw Error('请先配置并开启独立音频识别 API，不会改用主模型识别');
  const {wav}=await renderMelodyAudio(range.version,song.title);
  const report=await describeMelodyWithAudioApi(await songAudioToPayload(wav,'vocal-melody.wav'),config);
  return mutateSong(song.id,current=>{
   const p=getMelody(current);if(!p?.versions.some(v=>v.id===version.id))throw Error('旋律版本已变化，未覆盖原谱');
   return {song:{...current,melody:{...p,versions:p.versions.map(v=>v.id===version.id?{...v,listeningReports:[...(v.listeningReports||[]).filter(r=>r.key!==range.key),{key:range.key,label:range.label,description:report}]}:v)}} as SongWithMelody};
  });
 })();running.set(key,task);void task.finally(()=>running.delete(key)).catch(()=>{});return task;
}
