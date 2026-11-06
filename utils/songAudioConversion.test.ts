import {afterEach,expect,it,vi} from 'vitest';
import {songAudioToPayload,MAX_AUDIO_BYTES} from './audioApi';
import {convertSongAudioToWav} from './songAudioConversion';
afterEach(()=>vi.unstubAllGlobals());
function decoder(){
 const disconnect=vi.fn();
 class Offline {
  destination={};length:number;
  constructor(_channels:number,length:number,_rate:number){this.length=length;}
  async decodeAudioData(){return {duration:1};}
  createBufferSource(){return {buffer:null,connect:vi.fn(),start:vi.fn(),disconnect};}
  async startRendering(){return {getChannelData:()=>new Float32Array(this.length).fill(.25)};}
 }
 vi.stubGlobal('OfflineAudioContext',Offline);return disconnect;
}
it('sends actual PCM WAV bytes for Ogg without changing the source bytes',async()=>{
 const disconnect=decoder();const source=new Blob(['OggS-original'],{type:'audio/ogg'});
 const payload=await songAudioToPayload(source,'song.ogg');const decoded=atob(payload.base64);
 expect(payload.format).toBe('wav');expect(decoded.slice(0,4)).toBe('RIFF');expect(decoded.slice(8,12)).toBe('WAVE');
 const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
 expect(view.getUint32(24,true)).toBe(24000);expect(view.getUint16(22,true)).toBe(1);expect(view.getInt16(44,true)).toBeGreaterThan(0);
 expect(await source.text()).toBe('OggS-original');expect(source.type).toBe('audio/ogg');expect(disconnect).toHaveBeenCalled();
});
it('passes MP3 and WAV through without decoding',async()=>{
 vi.stubGlobal('OfflineAudioContext',vi.fn(()=>{throw Error('must not decode');}));
 for(const [mime,format,content] of [['audio/mpeg','mp3','ID3original'],['audio/wav','wav','RIFForiginal']]){
  const payload=await songAudioToPayload(new Blob([content],{type:mime}));expect(payload.format).toBe(format);expect(atob(payload.base64)).toBe(content);
 }
});
it('rejects oversized PCM before decoding and reports codec failures without sending mislabeled bytes',async()=>{
 const ctor=vi.fn();vi.stubGlobal('OfflineAudioContext',ctor);
 await expect(convertSongAudioToWav(new Blob(['OggS']),MAX_AUDIO_BYTES,3600)).rejects.toThrow('超过');expect(ctor).not.toHaveBeenCalled();
 class Broken {async decodeAudioData(){throw Error('codec');}}
 vi.stubGlobal('OfflineAudioContext',Broken);await expect(songAudioToPayload(new Blob(['OggS'],{type:'audio/ogg'}))).rejects.toThrow('未能解码');
});
