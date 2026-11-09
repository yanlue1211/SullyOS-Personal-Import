import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {audioBlobToPayload,buildTestToneWav,fetchSongAudio,describeAudioWithAudioApi,recognizeUserRecording,AUDIO_RECOGNITION_TEMPERATURE,normalizeSongAudio,assertAudioDescription} from './audioApi';
import {musicApi} from '../context/MusicContext';
const cfg={workerUrl:'https://music.invalid',cookie:'',quality:'standard' as const};
beforeEach(()=>vi.restoreAllMocks());afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('preserves actual audio bytes through NetEase download and the real safeFetchJson network boundary',async()=>{
 const wav=buildTestToneWav(),requests:any[]=[];
 vi.spyOn(musicApi,'_raw').mockResolvedValue({data:[{url:'https://cdn.test/netease.mp3'}]});
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(String(url).includes('netease'))return new Response(await wav.arrayBuffer(),{headers:{'Content-Type':'audio/mpeg'}});
  requests.push(JSON.parse(String(options.body)));return Response.json({choices:[{message:{content:'这是一段持续的单音，没有人声。'}}]});
 }));
 const song=await fetchSongAudio({id:123,name:'网易云歌曲'} as any,cfg);
 const payload=await audioBlobToPayload(song.blob,song.nameHint);
 expect(payload.format).toBe('wav');
 await describeAudioWithAudioApi(payload,{enabled:true,baseUrl:'https://audio.invalid/v1',apiKey:'test',model:'gemini-4-argon'});
 const part=requests[0].messages[1].content.find((p:any)=>p.type==='input_audio');
 const systemPrompt = String(requests[0].messages[0].content);
 expect(systemPrompt).toContain('高音、真假声转换');
 expect(systemPrompt).toContain('不等于嘶吼、撕裂');
 expect(systemPrompt).toContain('可写近似 BPM、拍号、分段时间码');
 expect(systemPrompt).toContain('听清的歌词、乐器编配');
 expect(requests[0].temperature).toBe(0);
 expect(requests[0].temperature).toBe(AUDIO_RECOGNITION_TEMPERATURE);
 expect(part.input_audio.format).toBe('wav');expect(atob(part.input_audio.data).slice(0,4)).toBe('RIFF');expect(part.input_audio.data).toBe(payload.base64);expect(requests[0].messages[1].content.some((p:any)=>p.type==='image_url')).toBe(false);
});
it('sends the same 0 temperature to recording ASR regardless of dialogue preset or model choice',async()=>{
 const requests:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url, options)=>{
   const body=JSON.parse(String(options.body));
   requests.push(body);
   return Response.json({choices:[{message:{content:JSON.stringify({transcript:'我今天挺精神的',analysis:'语速明快，声音清亮。'})}}]});
 }));
 const wav=buildTestToneWav();
 const payload=await audioBlobToPayload(wav);
 const models=['gemini-audio-first','gemini-audio-second'];
 for(const model of models){
   const result=await recognizeUserRecording(payload,{enabled:true,baseUrl:'https://audio.invalid/v1',apiKey:'test',model});
   expect(result.transcript).toBe('我今天挺精神的');
 }
 expect(requests).toHaveLength(2);
 expect(requests.map(r=>r.temperature)).toEqual([0,0]);
 expect(requests.map(r=>r.model)).toEqual(models);
});
it('imports jsDelivr audio by its remote URL and retains binary content despite generic MIME',async()=>{
 vi.spyOn(musicApi,'_raw');const mp3=new Blob(['ID3',new Uint8Array(200)],{type:'application/octet-stream'});
 const fetch=vi.fn(async()=>new Response(await mp3.arrayBuffer(),{headers:{'Content-Type':'application/octet-stream'}}));vi.stubGlobal('fetch',fetch);
 const url='https://cdn.jsdelivr.net/gh/yanlue1211/yan@main/tonghuashun.mp3';
 const audio=await fetchSongAudio({id:-1,local:true,remoteAudioUrl:url} as any,cfg);
 expect(fetch).toHaveBeenCalledWith(url,expect.anything());expect(musicApi._raw).not.toHaveBeenCalled();expect(audio.blob.type).toBe('audio/mpeg');expect(atob((await audioBlobToPayload(audio.blob)).base64).slice(0,3)).toBe('ID3');
});
it('rejects downloaded error pages and supports existing WebM recording assets',async()=>{
 await expect(normalizeSongAudio(new Blob(['<html>expired</html>'],{type:'audio/mpeg'}))).rejects.toThrow('网页');
 expect((await normalizeSongAudio(new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3,0])]))).type).toBe('audio/webm');
 expect(()=>assertAudioDescription('我只收到了[图片]占位符，没有收到音频')).toThrow('不会保存');
 expect(()=>assertAudioDescription('没有人声，主要是钢琴与吉他。')).not.toThrow();
});
it.skipIf(!process.env.REAL_SONG_FIXTURE)('round-trips the downloaded GitHub song into the actual outgoing input_audio request',async()=>{
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');const bytes=await readFile(process.env.REAL_SONG_FIXTURE!);let sent:any;
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(String(url).includes('cdn.jsdelivr.net'))return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':'audio/mpeg'}});
  sent=JSON.parse(String(options.body));return Response.json({choices:[{message:{content:'这首歌有完整的人声和伴奏。'}}]});
 }));
 const song=await fetchSongAudio({id:-2,local:true,remoteAudioUrl:'https://cdn.jsdelivr.net/gh/yanlue1211/yan@main/tonghuashun.mp3'} as any,cfg);
 const payload=await audioBlobToPayload(song.blob,song.nameHint);expect(payload.format).toBe('ogg');
 await describeAudioWithAudioApi(payload,{enabled:true,baseUrl:'https://audio.invalid/v1',apiKey:'test',model:'gemini-4-argon'});
 const audio=sent.messages[1].content.find((p:any)=>p.type==='input_audio');expect(audio.input_audio.format).toBe('ogg');
 expect(createHash('sha256').update(Buffer.from(audio.input_audio.data,'base64')).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
});
it('does not reuse or save an analysis that says no audio was received',async()=>{
 const {DB}=await import('./db');const {SOUND_ARCHIVE_PREFIX,getSongSoundRecord}=await import('../features/personal/songArchive/storage');const {getOrAnalyzeSongSound}=await import('./songListening');
 vi.stubGlobal('window',new EventTarget());
 await DB.deleteDB();localStorage.clear();localStorage.setItem('os_api_config',JSON.stringify({audioApi:{enabled:true,baseUrl:'https://audio.invalid/v1',apiKey:'test',model:'gemini-4-argon'}}));
 await DB.saveAsset(SOUND_ARCHIVE_PREFIX+888,JSON.stringify({songId:888,description:'我只收到了[图片]占位符，没有收到音频',updatedAt:1}));
 const wav=buildTestToneWav();let calls=0;vi.spyOn(musicApi,'_raw').mockResolvedValue({data:[{url:'https://cdn.test/netease.mp3'}]});
 vi.stubGlobal('fetch',vi.fn(async(url)=>{if(String(url).includes('netease'))return new Response(await wav.arrayBuffer());calls++;return Response.json({choices:[{message:{content:calls===1?'主要是轻快的吉他伴奏和人声。':'<音频不可用/>'}}]});}));
 const song={id:888,name:'歌',artists:'歌手'} as any;
 expect(await getOrAnalyzeSongSound(song)).toContain('吉他');expect(calls).toBe(1);
 await expect(getOrAnalyzeSongSound({...song,id:889})).rejects.toThrow('不会保存');expect(await getSongSoundRecord(889)).toBeNull();
});
