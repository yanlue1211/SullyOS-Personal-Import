import {it,expect} from 'vitest';
import {addProducedSong} from '../features/songwriting/musicLibrary';
import {readPersonalPlaylists} from './personalMusicLibrary';
import {DB} from './db';
import {externalizeVoiceMessageBlobs,restoreVoiceMessageBlobs,shouldIncludeVoiceRelatedAssetInBackup} from './voiceMessageBackup';
it('adds persistent audio once per task and preserves it through media backup',async()=>{
 const input={taskId:'unique-task',title:'test',artist:'c',charId:'c',lyrics:'line',blob:new Blob(['ID3audio'],{type:'audio/mpeg'})};
 const one=await addProducedSong(input);const two=await addProducedSong(input);expect(one.id).toBe(two.id);expect((await readPersonalPlaylists()).find(p=>p.id==='songwriting-produced')!.songs).toHaveLength(1);
 const entry=await DB.getAssetRaw(one.localAssetKey!);const assets=[{id:one.localAssetKey,data:entry}];const files=new Map<string,Uint8Array>();await externalizeVoiceMessageBlobs(assets,(p,b)=>{files.set(p,b)});const copy=JSON.parse(JSON.stringify(assets));await restoreVoiceMessageBlobs(copy,async p=>files.get(p)||null);expect(await copy[0].data.blob.text()).toBe('ID3audio');expect(shouldIncludeVoiceRelatedAssetInBackup(assets[0],false)).toBe(false);
});
