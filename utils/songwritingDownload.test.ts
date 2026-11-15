import {it,expect,vi,afterEach} from 'vitest';
import {fetchSongFile} from '../features/songwriting/download';
afterEach(()=>vi.unstubAllGlobals());
it('fetches by task ID and preserves actual WAV extension despite generic CDN name',async()=>{
 const bytes=new Uint8Array(44);bytes.set(new TextEncoder().encode('RIFF'),0);bytes.set(new TextEncoder().encode('WAVE'),8);
 const request=vi.fn(async(_url: string, _options: any)=>new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));vi.stubGlobal('fetch',request);
 const result=await fetchSongFile('task123',{token:'key',cookie:'session=test'});expect(result.extension).toBe('wav');expect(result.blob.type).toBe('audio/wav');expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({songTaskId:'task123'});
});
it('does not save HTML errors disguised as files',async()=>{
 vi.stubGlobal('fetch',async()=>new Response('<html>denied</html>'));await expect(fetchSongFile('task123',{token:'key',cookie:'c'})).rejects.toThrow('不是可识别的音频');
});
