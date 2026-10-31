import { beforeEach, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { DB, openDB } from './db';
import { transactionDone } from '../features/workroom/schema';
import { claimDailySchedule } from '../features/personal/innerVoice/scheduleOnce';
import { exportActivityTextAsset } from './activityBackup';
import { streamBackupArrayStore } from './backupStoreStreaming';
import { assembleV2Backup, writeV2Backup, type ZipFileReader, type ZipFileWriter } from './backupFormat';
import { collectBlobRefs, readBlobsIndex, restoreBlobsFromZip, writeBlobsToZip } from './backupBlobs';
import { putImageBlob, getBlobForRef, restoreBlobRef, deleteBlobRef } from './blobRef';
import { readCommerce } from './personalCommerce';
import { SOUND_ARCHIVE_PREFIX, getSongSoundRecord } from '../features/personal/songArchive/storage';
import { normalizeApiConfig, normalizeApiPreset } from './apiConfigNormalize';
import { getShareCardImageUrls } from './shareCardImages';
import { stripBackupImages } from './backupExport';

const commerce={products:[{id:'food',kind:'meituan',title:'热汤面',price:18,shop:'面馆',detail:'不要葱'}],shops:[{id:'shop',kind:'meituan',name:'面馆',category:'面食',description:'热乎的'}],
    orders:[{id:'order',charId:'a',charName:'阿源',userName:'User',product:{id:'book',kind:'taobao',title:'书',price:30,shop:'书店',detail:'原装'},buyer:'char',recipient:'user',createdAt:100,eta:9999999999999,createdNotified:true,deliveredNotified:false,requestId:'once'}],
    members:{taobao:['a'],meituan:['a']},preferences:{taobao:'日常文具',meituan:'清淡，少辣'}};
beforeEach(async()=>{
    localStorage.clear();const db=await openDB(),names=['assets','characters','messages','diaries','daily_schedule'];
    const tx=db.transaction(names,'readwrite'),done=transactionDone(tx);for(const name of names)tx.objectStore(name).clear();await done;
    await DB.saveCharacter({id:'a',name:'阿源',realSongListeningEnabled:true,workroomLinkEnabled:true,musicProfile:{reviews:[{id:'listen-together',targetType:'song',content:'节奏明亮'}]},emotionConfig:{enabled:true}} as any);
    await DB.saveAsset('personal_commerce_v1',JSON.stringify(commerce));
    await claimDailySchedule('a','2026-10-31');
    await DB.saveAsset(SOUND_ARCHIVE_PREFIX+'42',JSON.stringify({songId:42,songName:'歌曲',artists:'歌手',description:'改过的音乐理解',originalDescription:'旧分析',updatedBy:'user',updatedAt:123,isTrial:false}));
    await DB.saveDiary({id:'diary',charId:'a',kind:'character',date:'2026-10-31',charText:'个人日记全文'} as any);
    await DB.saveDailySchedule({id:'a_2026-10-31',charId:'a',date:'2026-10-31',slots:[{startTime:'09:00',activity:'上班'}]} as any);
});
async function unpack(zip:JSZip){const loaded=await JSZip.loadAsync(await zip.generateAsync({type:'uint8array'}));return {zip:loaded,data:await assembleV2Backup(loaded as unknown as ZipFileReader,JSON.parse(await loaded.file('manifest.json')!.async('string')))};}
it('完整 ZIP 保存商城目录、权限、订单快照、通知状态、日记、日程及真实录音/分享图像字节',async()=>{
    const audio=await putImageBlob(new Blob([new Uint8Array([82,73,70,70,1,2,3])],{type:'audio/wav'}));
    const picture=await putImageBlob(new Blob([new Uint8Array([7,8,9])],{type:'image/png'}));
    await DB.saveMessage({charId:'a',role:'user',type:'audio',content:audio,metadata:{audioTranscript:'编辑后的转写',audioAnalysis:'轻声而认真',audioDescription:'编辑后的转写；轻声而认真'}});
    await DB.saveMessage({charId:'a',role:'assistant',type:'text',content:'我听见了',metadata:{innerVoice:{state:'坐在窗边',thoughts:'有点担心',undercurrent:''}}});
    await DB.saveMessage({charId:'a',role:'user',type:'xhs_card',content:'分享',metadata:{xhsNote:{title:'真实笔记',desc:'正文',images:[picture],videoFrames:[{image:picture,timeSeconds:2}]},visionDescription:'保留的识图文字'}});
    const messages=await DB.getMessagesByCharId('a',true),zip=new JSZip(),refs=new Set<string>();
    await writeV2Backup(zip as unknown as ZipFileWriter,await DB.exportFullData(),{onSerialized:s=>collectBlobRefs(s,refs)});
    await writeBlobsToZip(zip as any,refs,getBlobForRef);const restored=await unpack(zip);
    await deleteBlobRef(audio);await deleteBlobRef(picture);await DB.deleteAsset('personal_commerce_v1');
    await restoreBlobsFromZip(restored.zip as any,await readBlobsIndex(restored.zip as any),restoreBlobRef);
    await DB.importFullData(restored.data as any);
    expect(await readCommerce()).toEqual(commerce);
    expect(await DB.getMessagesByCharId('a',true)).toEqual(messages);
    expect(getShareCardImageUrls(messages.find(m=>m.type==='xhs_card')!)).toEqual([picture]);
    expect(await DB.getCharacter('a')).toMatchObject({realSongListeningEnabled:true,workroomLinkEnabled:true,musicProfile:{reviews:[{content:'节奏明亮'}]}});
    expect([...new Uint8Array(await (await getBlobForRef(audio))!.arrayBuffer())]).toEqual([82,73,70,70,1,2,3]);
    expect((await getBlobForRef(audio))!.type).toBe('audio/wav');
    expect([...new Uint8Array(await (await getBlobForRef(picture))!.arrayBuffer())]).toEqual([7,8,9]);
    expect((await DB.getRawStoreData('diaries'))[0].kind).toBe('character');
    expect((await DB.getRawStoreData('daily_schedule'))[0].slots[0].activity).toBe('上班');
    expect(await claimDailySchedule('a','2026-10-31')).toBe(false);
    expect((await getSongSoundRecord(42))!.description).toBe('改过的音乐理解');
});
it('纯文字 ZIP 也保存淘宝/外卖和日程一次性标识，媒体补丁不回滚订单',async()=>{
    const zip=new JSZip();
    const assets=await streamBackupArrayStore(zip as any,'assets','activityTextAssets',{transform:exportActivityTextAsset});
    const full=await DB.exportFullData();
    await writeV2Backup(zip as any,{messages:stripBackupImages(full.messages),characters:full.characters,diaries:full.diaries,dailySchedules:full.dailySchedules,songSoundArchive:full.songSoundArchive}, {mode:'text_only',prewrittenStores:{activityTextAssets:assets}});
    const restored=await unpack(zip);await DB.deleteAsset('personal_commerce_v1');
    await DB.importFullData(restored.data as any);
    expect(await readCommerce()).toEqual(commerce);
    expect(await claimDailySchedule('a','2026-10-31')).toBe(false);
    await DB.importFullData({collaborationBackupMode:'media_only',assets:[{id:'personal_commerce_v1',data:JSON.stringify({...commerce,orders:[]})}]} as any);
    expect(await readCommerce()).toEqual(commerce);
});
it('未打开过音迹的旧 localStorage 歌曲也在导出前完成无 API 迁移',async()=>{
    localStorage.setItem('sully_song_sound_v1_43',JSON.stringify({description:'旧版理解',songName:'旧歌',artists:'歌手',updatedAt:1}));
    const backup=await DB.exportFullData();expect(backup.songSoundArchive?.some(a=>a.id===SOUND_ARCHIVE_PREFIX+'43')).toBe(true);
});
it('全局音频 API/预设随原 apiConfig 字段导出并由统一恢复入口写回，商城偏好不进入角色常驻设定',()=>{
    const source=readFileSync('context/OSContext.tsx','utf8');
    expect(source).toContain("apiConfig: (mode === 'text_only' || mode === 'full') ? apiConfig");
    expect(source).toContain('if (data.apiConfig) updateApiConfig(data.apiConfig)');
    expect(source).toContain('listSongSoundRecords');
});

it('旧纯文字备份未包含新增商城和日程标识时，不清空当前设备的新数据',async()=>{
    await DB.importFullData({activityTextAssets:[]} as any);
    expect(await readCommerce()).toEqual(commerce);expect(await claimDailySchedule('a','2026-10-31')).toBe(false);
});
it('音频/识图配置、音质和音频预设经过真实 ZIP 与现有归一化流程保持不变',async()=>{
    const api=normalizeApiConfig({baseUrl:'https://chat.invalid/v1',apiKey:'test',model:'chat',audioApi:{enabled:true,baseUrl:'https://audio.invalid/v1',apiKey:'audio-test',model:'listen',songQuality:'lossless'},visionApi:{enabled:true,baseUrl:'https://vision.invalid/v1',apiKey:'vision-test',model:'vision'}} as any);
    const preset={id:'audio-preset',name:'音频预设',config:api};const zip=new JSZip();
    await writeV2Backup(zip as any,{apiConfig:api,apiPresets:[preset]});const restored=await unpack(zip);
    expect(normalizeApiConfig(restored.data.apiConfig)).toEqual(api);expect(normalizeApiPreset(restored.data.apiPresets[0])).toEqual(preset);
});
