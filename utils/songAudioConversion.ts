import {encodeMonoWav} from '../features/personal/chatMedia/recording';
export const SONG_RECOGNITION_SAMPLE_RATE=24000;
/** Decode actual compressed audio, then render a bounded mono PCM recognition copy. */
export async function convertSongAudioToWav(blob:Blob,maxBytes:number,durationHint=0):Promise<Blob>{
 const maxFrames=Math.floor((maxBytes-44)/2);
 const checkLength=(seconds:number)=>{
  const frames=Math.ceil(seconds*SONG_RECOGNITION_SAMPLE_RATE);
  if(!Number.isFinite(frames)||frames<1)throw Error('歌曲音频时长无效，无法转换供识别');
  if(frames>maxFrames)throw Error('歌曲转换后的识别音频超过大小上限，请使用 MP3 格式导入；原歌曲未修改');
  return frames;
 };
 if(durationHint>0)checkLength(durationHint);
 if(typeof OfflineAudioContext==='undefined')throw Error('当前浏览器不支持歌曲格式转换，请使用 MP3 或 WAV 格式导入');
 try{
  // Offline decoding does not start playback or request microphone permissions.
  const decoder=new OfflineAudioContext(1,1,SONG_RECOGNITION_SAMPLE_RATE);
  const decoded=await decoder.decodeAudioData(await blob.arrayBuffer());
  const renderer=new OfflineAudioContext(1,checkLength(decoded.duration),SONG_RECOGNITION_SAMPLE_RATE);
  const source=renderer.createBufferSource();source.buffer=decoded;source.connect(renderer.destination);source.start();
  try{
   const rendered=await renderer.startRendering();
   const wav=encodeMonoWav(rendered.getChannelData(0),SONG_RECOGNITION_SAMPLE_RATE);
   if(wav.size>maxBytes)throw Error('歌曲转换后的识别音频超过大小上限，请使用 MP3 格式导入');
   return wav;
  }finally{source.disconnect();source.buffer=null;}
 }catch(error){
  if(error instanceof Error&&/超过|时长无效/.test(error.message))throw error;
  throw Error('浏览器未能解码并转换这首歌曲，请改用 MP3 或 WAV 格式导入；原歌曲未修改');
 }
}
