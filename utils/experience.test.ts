import {collectBlobRefs,writeBlobsToZip,readBlobsIndex,restoreBlobsFromZip} from './backupBlobs';
import {it,expect,beforeEach} from 'vitest';
import {DB,openDB} from './db';
import {emptyOracle,oracleMessage,oracleContext,oracleState,listOracleItems,saveOracleItems} from '../features/experience/oracle';
import {readRealMedia,realMediaContent,mediaText} from '../features/experience/format';
import {readGameActions} from '../features/workroom/actions';
import {normalizeMessageContent,isMessageSemanticallyRelevant} from './messageFormat';
import {ChatPrompts} from './chatPrompts';
import {putImageBlob,getBlobForRef,deleteBlobRef,restoreBlobRef} from './blobRef';
import JSZip from 'jszip';
import {writeV2Backup,assembleV2Backup} from './backupFormat';
const owner='experience-a';
beforeEach(async()=>{const db=await openDB();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['messages','assets'],'readwrite');tx.objectStore('messages').clear();tx.objectStore('assets').clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});await DB.saveCharacter({id:owner,name:'阿源'} as any);});
const item=()=>({...emptyOracle(),name:'桂花糖',effect:'虚构游戏中使人犯困',cognition:'不知道是什么，闻起来甜',buff:'讲话变短',amount:2});
async function give(value=item()){const m=oracleMessage(value);return DB.saveMessage({charId:owner,role:'user',type:'text',...m});}
it('keeps oracle effects scoped, counts real replies, and commits a readable end event once across concurrent checks',async()=>{
 await give();expect(await oracleContext(owner)).toContain('讲话变短');expect(await oracleContext('other')).toBe('');
 await DB.saveMessage({charId:owner,role:'assistant',type:'text',content:'第一条'});expect(await oracleContext(owner)).toContain('桂花糖');
 await DB.saveMessage({charId:owner,role:'assistant',type:'text',content:'第二条'});await Promise.all([oracleContext(owner),oracleContext(owner)]);
 const rows=await DB.getMessagesByCharId(owner,true),ends=rows.filter(m=>m.metadata?.oracleEndId);expect(ends).toHaveLength(1);expect(isMessageSemanticallyRelevant(ends[0])).toBe(true);expect(await oracleContext(owner)).toBe('');
});
it('conditional activation waits for a subsequent user keyword and time expiration is measured from activation',async()=>{
 const value={...item(),trigger:'keyword' as const,triggerKeyword:'吃糖',end:'minutes' as const,amount:1};await give(value);
 expect(await oracleContext(owner)).toBe('');await DB.saveMessage({charId:owner,role:'assistant',type:'text',content:'吃糖'});expect(await oracleContext(owner)).toBe('');
 await DB.saveMessage({charId:owner,role:'user',type:'text',content:'我把吃糖的动作写了'});expect(await oracleContext(owner)).toContain('桂花糖');
 const rows=await DB.getMessagesByCharId(owner,true);expect(oracleState(rows,Date.now()+61000)[0].phase).toBe('ended');
});
it('treats real video frames as bounded multimodal evidence, and memory receives readable text instead of binary',()=>{
 const media={kind:'video',name:'现场.webm',originalRef:'blobref:b_original',inPerson:true,frames:[{timeSeconds:1,image:'blobref:b_frame'}]};
 const row={id:1,charId:owner,role:'user',type:'text',content:mediaText(media as any),timestamp:1,metadata:{realMedia:media}} as any;
 const api=ChatPrompts.buildMessageHistory([row],20,{id:owner,name:'阿源'} as any,{name:'用户'} as any,[]).apiMessages;
 expect(JSON.stringify(api)).toContain('image_url');expect(normalizeMessageContent(row,'阿源','用户')).toContain('1.0秒');expect(normalizeMessageContent(row,'阿源','用户')).not.toContain('blobref:');
 expect(realMediaContent({...row,metadata:{...row.metadata,visionDescription:'红色的杯子'}},true)).toContain('红色的杯子');
 expect(readRealMedia({...media,frames:Array(7).fill(media.frames[0])})).toBeUndefined();
});
it('round trips item templates, active effects, frame refs and original video bytes through actual ZIP backup',async()=>{
 const original=await putImageBlob(new Blob(['video-bytes'],{type:'video/webm'})),image=await putImageBlob(new Blob(['frame-bytes'],{type:'image/jpeg'}));
 const value=item();await saveOracleItems(owner,[value]);await give(value);
 const media={kind:'video',name:'clip.webm',originalRef:original,inPerson:true,frames:[{timeSeconds:1,image}]};await DB.saveMessage({charId:owner,role:'user',type:'text',content:mediaText(media as any),metadata:{realMedia:media}});
 const data=await DB.exportFullData(),zip=new JSZip(),refs=new Set<string>();await writeV2Backup(zip as any,data,{onSerialized:text=>collectBlobRefs(text,refs)});expect(refs.has(original)).toBe(true);expect(refs.has(image)).toBe(true);await writeBlobsToZip(zip as any,refs,getBlobForRef);const reader=await JSZip.loadAsync(await zip.generateAsync({type:'uint8array'}));const restored=await assembleV2Backup(reader as any,JSON.parse(await reader.file('manifest.json')!.async('string')));
 await deleteBlobRef(original);await deleteBlobRef(image);expect(await getBlobForRef(original)).toBeNull();await restoreBlobsFromZip(reader as any,await readBlobsIndex(reader as any),restoreBlobRef);await DB.importFullData(restored as any);expect(await listOracleItems(owner)).toEqual([value]);expect(await oracleContext(owner)).toContain('桂花糖');
 const row=(await DB.getMessagesByCharId(owner,true)).find(m=>m.metadata?.realMedia)!;expect(row.metadata!.realMedia.frames[0].image).toBe(image);expect(await (await getBlobForRef(original))!.text()).toBe('video-bytes');
 await deleteBlobRef(original);await deleteBlobRef(image);
});
it('rejects duplicate and excessive action descriptors; no arbitrary code goes to the model',()=>{
 expect(readGameActions([{id:'feed',label:'喂食',run:'not forwarded'}])).toEqual([{id:'feed',label:'喂食'}]);
 expect(()=>readGameActions([{id:'feed',label:'喂食'},{id:'feed',label:'重复'}])).toThrow();expect(()=>readGameActions(Array(13).fill({id:'a',label:'b'}))).toThrow();
});
