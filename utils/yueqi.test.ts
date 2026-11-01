import {beforeEach,describe,it,expect,vi} from 'vitest';
import {newSession,sceneRules,sleepDay,splitSpeech,elapsed,nextInterval} from '../features/yueqi/model';
import {storage} from '../features/yueqi/storage';
import {DB,openDB} from './db';
import {deliver,addReply} from '../features/yueqi/generate';
import {formatMessageForPrompt} from './messageFormat';
import {ChatPrompts} from './chatPrompts';
import JSZip from 'jszip';
import {assembleV2Backup,writeV2Backup} from './backupFormat';
import {transactionDone} from '../features/workroom/schema';
beforeEach(async()=>{const db=await openDB();const tx=db.transaction(['assets','messages','characters'],'readwrite');const done=transactionDone(tx);for(const name of ['assets','messages','characters'])tx.objectStore(name).clear();await done;await DB.saveCharacter({id:'a',name:'阿源',memories:[]} as any);});
describe('月栖日期、文本和时钟',()=>{
 it('线上与线下场景独立，默认线上且不把扮演当现实',()=>{expect(newSession('a','story').scene).toBe('online');expect(sceneRules('online')).toContain('远程');expect(sceneRules('offline')).toContain('同一空间');expect(sceneRules('offline')).toContain('不证明现实世界');});
 it('按设备本地06点分界，正确跨月跨年且会话日期冻结',()=>{expect(sleepDay(new Date(2026,10,1,0,30))).toBe('2026-10-31');expect(sleepDay(new Date(2026,0,1,5,59))).toBe('2025-12-31');expect(sleepDay(new Date(2026,0,1,6))).toBe('2026-01-01');const s=newSession('a','story');const saved=s.sleepDay;elapsed(s,Date.now()+86400000);expect(s.sleepDay).toBe(saved);});
 it('按实际时戳计时，暂停后不继续增长',()=>{const s=newSession('a','night',{elapsedMs:5000,runningSince:1000});expect(elapsed(s,11000)).toBe(15000);expect(elapsed({...s,runningSince:undefined},11000)).toBe(5000);});
 it('拆分长句与自然段不丢字、不乱序',()=>{const text='甲'.repeat(1500)+'。\n乙。丙？';const parts=splitSpeech(text);expect(parts.every(x=>x.length<=600)).toBe(true);expect(parts.join('').replace(/\s/g,'')).toBe(text.replace(/\s/g,''));});
 it('逐渐安静只拉长后半程间隔',()=>{const s=newSession('a','night',{targetMinutes:60,intervalMinutes:5,elapsedMs:40*60000});expect(nextInterval(s)).toBe(600000);expect(nextInterval({...s,gradual:false})).toBe(300000);});
});
describe('月栖存储与聊天衔接',()=>{
 it('清理只影响月栖音频，保留文字、摘要与背景音乐',async()=>{await DB.saveAssetRaw('yueqi:playlist',[{audio:'music'}]);const s=addReply(newSession('a','story'),'虚构故事','story');s.summary='故事摘要';s.clips[0].audio='data:audio/wav;base64,AAAA';s.clips[0].seconds=1;await storage.save(s);const cleared=await storage.clearAudio(s);expect(cleared.turns).toEqual(s.turns);expect(cleared.summary).toBe(s.summary);expect(cleared.clips[0].audio).toBeUndefined();expect(await DB.getAssetRaw('yueqi:playlist')).toEqual([{audio:'music'}]);});
 it('并发重试只写一张卡；修改后上下文和记忆提取读新摘要',async()=>{const s=newSession('a','story',{status:'ended',summary:'虚构故事：海边的小羊'});await Promise.all([deliver(s),deliver(s)]);let rows=await DB.getMessagesByCharId('a',true);expect(rows).toHaveLength(1);const saved=(await storage.get(s.id))!;await deliver({...saved,summary:'修正摘要：用户实际谈到了明天旅行'});rows=await DB.getMessagesByCharId('a',true);expect(rows).toHaveLength(1);expect(formatMessageForPrompt(rows[0],'阿源','用户')).toContain('修正摘要');expect(formatMessageForPrompt(rows[0],'阿源','用户')).not.toContain('海边的小羊');const history=JSON.stringify(ChatPrompts.buildMessageHistory(rows,100,{id:'a',name:'阿源'} as any,{} as any,[]).apiMessages);expect(history).toContain('修正摘要');expect(history).toContain('故事为虚构');});
 it('无摘要不写空卡，原始记录仍在',async()=>{const s=addReply(newSession('a','night'),'原始内容','automatic');await storage.save(s);await expect(deliver(s)).rejects.toThrow('尚无摘要');expect((await storage.get(s.id))?.turns).toHaveLength(1);expect(await DB.getMessagesByCharId('a',true)).toHaveLength(0);});
 it('真实 ZIP 全量备份还原完整文字、音频与角色，不新增数据库版本',async()=>{const s=addReply(newSession('a','story'),'完整文字','story');s.clips[0].audio='data:audio/wav;base64,AAAA';await storage.save(s);await DB.saveAssetRaw('unrelated',{untouched:true});const beforeVersion=(await openDB()).version;const zip=new JSZip();await writeV2Backup(zip as any,await DB.exportFullData());const reader=await JSZip.loadAsync(await zip.generateAsync({type:'uint8array'}));const backup=await assembleV2Backup(reader as any,JSON.parse(await reader.file('manifest.json')!.async('string')));await storage.remove(s.id);await DB.importFullData(backup as any);const restored=await storage.get(s.id);expect(restored?.turns).toEqual(s.turns);expect(restored?.clips[0].audio).toBe(s.clips[0].audio);expect(await DB.getAssetRaw('unrelated')).toEqual({untouched:true});expect((await openDB()).version).toBe(beforeVersion);});
});
