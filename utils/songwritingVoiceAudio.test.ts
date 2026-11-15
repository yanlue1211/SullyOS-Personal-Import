import {it,expect,vi,afterEach} from 'vitest';
import {prepareVoiceUpload} from '../features/songwriting/voiceAudio';
afterEach(()=>vi.unstubAllGlobals());
it('decodes compressed samples and emits mono 48kHz PCM16 WAV without changing original',async()=>{
 const input=new Blob(['original mp3']);const samples=new Float32Array([0,-1,1]);const disconnect=vi.fn();const decode=vi.fn(async()=>({duration:3/48000}));
 vi.stubGlobal('OfflineAudioContext',class {
  destination={};decodeAudioData=decode;
  createBufferSource(){return {buffer:null,connect:vi.fn(),start:vi.fn(),disconnect};}
  async startRendering(){return {getChannelData:()=>samples};}
 });
 const wav=await prepareVoiceUpload(input);const v=new DataView(await wav.arrayBuffer());
 expect(wav.type).toBe('audio/wav');expect(v.getUint16(20,true)).toBe(1);expect(v.getUint16(22,true)).toBe(1);expect(v.getUint32(24,true)).toBe(48000);expect(v.getUint16(34,true)).toBe(16);expect(v.getUint32(40,true)).toBe(6);expect(disconnect).toHaveBeenCalledOnce();expect(await input.text()).toBe('original mp3');
});
it('rejects invalid decoding before submission',async()=>{
 vi.stubGlobal('OfflineAudioContext',class {async decodeAudioData(){throw Error('bad mp3');}});
 await expect(prepareVoiceUpload(new Blob(['bad']))).rejects.toThrow('尚未上传');
});
