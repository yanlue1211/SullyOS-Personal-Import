import {beforeEach,expect,it} from 'vitest';
import {DB,openDB} from './db';
import {putImageBlob,getBlobForRef} from './blobRef';
import {REF_SOURCE_STORES} from './blobGc';
import {inspectAllVoices,clearAllVoices} from './voiceCleanup';
beforeEach(async()=>{localStorage.clear();const db=await openDB();await new Promise<void>((resolve,reject)=>{const tx=db.transaction([...REF_SOURCE_STORES,'blob_assets'],'readwrite');for(const name of [...REF_SOURCE_STORES,'blob_assets'])tx.objectStore(name).clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});});
it('clears user and character speech, favorites, companion and Yueqi while preserving text, music and pictures',async()=>{
 const audio=new Blob(['voice'],{type:'audio/wav'});
 for(const id of ['tts_test','voice_favorite_audio_fav','companion-touch-voice:a:test'])await DB.saveAssetRaw(id,{blob:audio});
 await DB.saveAssetRaw('voice_msg_1',{blob:audio,originalText:'原文',spokenText:'口语',favorite:true});
 await DB.saveAssetRaw('voice_favorites_index_v1',{version:1,items:[{id:'fav',originalText:'收藏文字'}]});
 await DB.putBlobAsset('companion-startup-voice:a:legacy',audio);
 await DB.saveAssetRaw('yueqi:audio:clip','data:audio/wav;base64,dm9pY2U=');
 await DB.saveAssetRaw('yueqi:session:one',{id:'one',summary:'总结',turns:[{text:'夜话'}],clips:[{id:'clip',text:'故事文字',audioKey:'yueqi:audio:clip',audioBytes:5}]});
 await DB.saveAssetRaw('yueqi:bgm:music',audio);
 await DB.saveAssetRaw('song-music',audio);
 await DB.saveAssetRaw('character_config',{voiceId:'keep-model',voiceSpeed:1});
 const image=await putImageBlob(new Blob(['picture'],{type:'image/png'}));
 const refs=[];
 for(const role of ['user','assistant'] as const){const ref=await putImageBlob(audio);refs.push(ref);await DB.saveMessage({charId:'a',role,type:'audio',content:ref,metadata:{audioDescription:'识别文字',personalAudio:{transcript:'保留字幕',analysis:'轻声'}} as any});}
 const plan=await inspectAllVoices();expect(plan.recordings).toHaveLength(2);
 const result=await clearAllVoices(plan);expect(result.freedBytes).toBeGreaterThan(20);
 expect(await DB.getAssetRaw('tts_test')).toBeNull();expect(await DB.getAssetRaw('voice_favorite_audio_fav')).toBeNull();
 expect(await DB.getAssetRaw('voice_msg_1')).toEqual({originalText:'原文',spokenText:'口语',favorite:true});
 expect(await DB.getBlobAsset('companion-startup-voice:a:legacy')).toBeNull();
 expect(await DB.getAssetRaw('yueqi:audio:clip')).toBeNull();
 expect((await DB.getAssetRaw('yueqi:session:one')).clips).toEqual([{id:'clip',text:'故事文字'}]);
 expect((await DB.getAssetRaw('voice_favorites_index_v1')).items[0].originalText).toBe('收藏文字');
 expect(await DB.getAssetRaw('song-music')).toBeInstanceOf(Blob);expect(await DB.getAssetRaw('yueqi:bgm:music')).toBeInstanceOf(Blob);
 expect(await getBlobForRef(image)).not.toBeNull();for(const ref of refs)expect(await getBlobForRef(ref)).toBeNull();
 for(const msg of await DB.getMessagesByCharId('a',true)){expect(msg.metadata.audioCleared).toBe(true);expect(msg.metadata.audioDescription).toBe('识别文字');}
 expect(await DB.getAssetRaw('character_config')).toEqual({voiceId:'keep-model',voiceSpeed:1});
 expect((await inspectAllVoices()).estimatedBytes).toBe(0);
});
it('retains a recording file if an unrelated song still references the same blob',async()=>{
 const ref=await putImageBlob(new Blob(['voice'],{type:'audio/wav'}));await DB.saveMessage({charId:'a',role:'user',type:'audio',content:ref});
 const db=await openDB();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('songs','readwrite');tx.objectStore('songs').put({id:1,url:ref});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
 expect((await clearAllVoices(await inspectAllVoices())).retainedFiles).toBe(1);expect(await getBlobForRef(ref)).not.toBeNull();
});
it('clears legacy inline audio without deleting its transcript',async()=>{
 const id=await DB.saveMessage({charId:'a',role:'user',type:'audio',content:'data:audio/wav;base64,dm9pY2U=',metadata:{audioTranscript:'旧录音字幕'}});
 const plan=await inspectAllVoices();expect(plan.recordings).toHaveLength(1);
 await clearAllVoices(plan);const row=(await DB.getMessagesByCharId('a',true)).find(m=>m.id===id)!;
 expect(row.metadata.audioTranscript).toBe('旧录音字幕');expect(row.metadata.audioCleared).toBe(true);expect(row.content).not.toContain('data:');
});
it('reclaims abandoned recording blobs while keeping music referenced by another source',async()=>{
 const orphan=await putImageBlob(new Blob(['abandoned-voice'],{type:'audio/wav'}));
 const music=await putImageBlob(new Blob(['song'],{type:'audio/mpeg'}));
 await DB.saveAssetRaw('yueqi:bgm:local',{ref:music});
 await clearAllVoices(await inspectAllVoices());
 expect(await getBlobForRef(orphan)).toBeNull();expect(await getBlobForRef(music)).not.toBeNull();
});
