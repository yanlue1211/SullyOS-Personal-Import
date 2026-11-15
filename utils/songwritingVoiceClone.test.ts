import {it,expect,vi,afterEach} from 'vitest';
import {DB} from './db';
import {createVoiceClone,inspectVoiceClone,loadVoiceClone,mutateVoiceClone,HAIMIAN_READING_TEXT} from '../features/songwriting/voiceClone';
import {haimianCall} from '../features/songwriting/production';
vi.mock('../features/songwriting/voiceAudio',()=>({prepareVoiceUpload:vi.fn(async (sample:Blob)=>sample)}));
vi.mock('../features/songwriting/production',()=>({haimianCall:vi.fn()}));
afterEach(()=>vi.clearAllMocks());
it('clone uses sample bytes and exact script, retains no credentials, and binds after ready',async()=>{
 vi.mocked(haimianCall).mockResolvedValueOnce({voiceId:'123'}).mockResolvedValueOnce({state:'ready'});
 const sample=new Blob([new Uint8Array(2000)],{type:'audio/wav'});await createVoiceClone('clone-a',sample,HAIMIAN_READING_TEXT,{token:'private-key',cookie:'session=private'});
 const [path,,body]=vi.mocked(haimianCall).mock.calls[0];expect(path).toBe('/music/voice-upload');expect((body as any).lyrics).toBe(HAIMIAN_READING_TEXT);expect((body as any).audioBase64.length).toBeGreaterThan(2000);
 expect((await loadVoiceClone('clone-a'))?.state).toBe('processing');await inspectVoiceClone('clone-a','123',{token:'private-key',cookie:'session=private'});expect((await loadVoiceClone('clone-a'))?.state).toBe('ready');expect(JSON.stringify(await loadVoiceClone('clone-a'))).not.toContain('private');expect(await loadVoiceClone('other-char')).toBeNull();
 await expect(createVoiceClone('clone-a',sample,HAIMIAN_READING_TEXT,{token:'k',cookie:'c'})).rejects.toThrow('已有音色');expect(haimianCall).toHaveBeenCalledTimes(2);
});
it('unknown upload is persisted and blocks repeated network submission',async()=>{
 vi.mocked(haimianCall).mockRejectedValueOnce(Error('timeout'));const blob=new Blob([new Uint8Array(1000)]);
 await expect(createVoiceClone('clone-b',blob,'完整台词',{token:'k',cookie:'c'})).rejects.toThrow('timeout');expect((await loadVoiceClone('clone-b'))?.state).toBe('unknown');await expect(createVoiceClone('clone-b',blob,'完整台词',{token:'k',cookie:'c'})).rejects.toThrow('已有音色');expect(haimianCall).toHaveBeenCalledTimes(1);
});
it('simultaneous submissions serialize before external upload and records survive backup',async()=>{
 vi.mocked(haimianCall).mockResolvedValue({voiceId:'456'});const blob=new Blob([new Uint8Array(1000)]);const results=await Promise.allSettled([createVoiceClone('clone-c',blob,'完整台词',{token:'k',cookie:'c'}),createVoiceClone('clone-c',blob,'完整台词',{token:'k',cookie:'c'})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(haimianCall).toHaveBeenCalledTimes(1);
 const backup=await DB.exportFullData();await DB.importFullData(backup as any);expect((await loadVoiceClone('clone-c'))?.id).toBe('456');
});
it('invalid files never call API or create a pending task',async()=>{
 await expect(createVoiceClone('clone-d',new Blob(['short']),'台词',{token:'k',cookie:'c'})).rejects.toThrow('8MB');expect(haimianCall).not.toHaveBeenCalled();expect(await loadVoiceClone('clone-d')).toBeNull();
});
