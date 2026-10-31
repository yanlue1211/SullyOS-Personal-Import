import { beforeEach, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DB, openDB } from './db';
import { WORKROOM_STORES, transactionDone } from '../features/workroom/schema';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { shareWork, acceptShare, listShares, proposeIdea, setIdeaStatus } from '../features/workroom/collaboration';
import { buildWorkroomGuide, consumeWorkroomActions } from '../features/workroom/bridge';
import { exportWorkroomBackup } from '../features/workroom/backup';
import { assembleV2Backup, writeV2Backup } from './backupFormat';
import { formatMessageForPrompt, isMessageSemanticallyRelevant } from './messageFormat';
beforeEach(async()=>{
    const db=await openDB(),tx=db.transaction(['characters','messages',...WORKROOM_STORES],'readwrite'),done=transactionDone(tx);
    for(const name of ['characters','messages',...WORKROOM_STORES])tx.objectStore(name).clear();
    tx.objectStore('characters').put({id:'a',name:'阿源',workroomLinkEnabled:true});
    tx.objectStore('characters').put({id:'c',name:'Claude',workroomLinkEnabled:true,systemPrompt:'私人设定不可复制'});
    await done;
});
async function original(){const work=await W.create('c','星空日历','记录特殊日期');await W.saveDraft('c',work.id,{html:'<h1>星空</h1>',css:'',js:'// original-code'},0,null);const version=await W.publish('c',work.id,1);await W.saveState('c',work.id,version.id,1,{privateName:'私人数据'});return {work,version};}
it('自然模型灵感不生成代码，重放不重复；灵感箱能搁置和继续',async()=>{
    const raw='想给你做个小狗。<造物间>{"action":"idea","title":"小狗屋","summary":"照顾小狗"}</造物间>';
    expect(await consumeWorkroomActions(raw,'a')).toBe('想给你做个小狗。');await consumeWorkroomActions(raw,'a');
    const works=await W.list('a');expect(works).toHaveLength(1);expect(works[0].idea?.status).toBe('open');
    expect((await W.get('a',works[0].id)).versions).toEqual([]);
    await setIdeaStatus('a',works[0].id,'shelved');expect((await W.get('a',works[0].id)).work.idea?.status).toBe('shelved');
    expect((await DB.getMessagesByCharId('a',true)).filter(m=>m.type==='workroom_card')).toHaveLength(1);
});
it('分享不是接收；明确接收后独立复制、保留来源且不复制进度/聊天/凭据',async()=>{
    const {work,version}=await original();
    await DB.saveMessage({charId:'c',role:'user',type:'text',content:'私人聊天不可复制'});
    const share=await shareWork('c',work.id,'a','user-click');
    expect(await W.list('a')).toEqual([]);expect(await shareWork('c',work.id,'a','user-click')).toEqual(share);
    const guide=await buildWorkroomGuide('a');expect(guide).toContain('星空日历');expect(guide).not.toContain('original-code');expect(guide).not.toContain('私人数据');
    const copy=await acceptShare('a',share.id);expect((await acceptShare('a',share.id)).id).toBe(copy.id);
    expect(copy.id).not.toBe(work.id);expect(copy.source?.authorName).toBe('Claude');
    expect((await W.loadState('a',copy.id,copy.currentVersionId!)).data).toEqual({});
    const own=await W.get('a',copy.id);await W.saveDraft('a',copy.id,{html:'我的新版本',css:'',js:''},0,copy.currentVersionId);
    expect((await W.get('c',work.id)).versions[0].html).toBe('<h1>星空</h1>');
    expect((await W.loadState('c',work.id,version.id)).data).toEqual({privateName:'私人数据'});
    expect(JSON.stringify(await DB.getMessagesByCharId('a',true))).not.toContain('私人聊天不可复制');
    const text=(await DB.getMessagesByCharId('a',true)).map(m=>formatMessageForPrompt(m,'阿源','User')).join('\n');expect(text).toContain('作品分享');expect(text).toContain('作品收藏');expect(text).toContain('Claude');
    expect(own.versions).toHaveLength(1);
});
it('联动关闭不注入新能力、不允许接收；历史分享仍保留语义',async()=>{
    const {work}=await original(),share=await shareWork('c',work.id,'a');
    await DB.saveCharacter({...await DB.getCharacter('a'),workroomLinkEnabled:false} as any);
    expect(await buildWorkroomGuide('a')).toBe('');await expect(acceptShare('a',share.id)).rejects.toThrow('关闭');
    await consumeWorkroomActions('<造物间>{"action":"idea","title":"不应创建","summary":"关闭"}</造物间>','a');
    expect(await W.list('a')).toEqual([]);expect((await DB.getMessagesByCharId('a',true)).every(isMessageSemanticallyRelevant)).toBe(true);
    await expect(acceptShare('c',share.id)).rejects.toThrow('不属于');
});
it('原作品删除后冻结分享仍能接收，完整 ZIP 保留灵感、来源、分享与接收消息',async()=>{
    const {work}=await original(),share=await shareWork('c',work.id,'a');await W.delete('c',work.id);
    const copy=await acceptShare('a',share.id);await proposeIdea('a','新想法','先讨论','idea-2');
    const before=await exportWorkroomBackup(await openDB()),messages=await DB.getMessagesByCharId('a',true),zip=new JSZip();
    await writeV2Backup(zip as any,{...before,messages});const reader=await JSZip.loadAsync(await zip.generateAsync({type:'uint8array'}));
    await DB.importFullData(await assembleV2Backup(reader as any,JSON.parse(await reader.file('manifest.json')!.async('string'))) as any);
    expect(await exportWorkroomBackup(await openDB())).toEqual(before);expect(await DB.getMessagesByCharId('a',true)).toEqual(messages);
    expect((await listShares('a'))[0].acceptedWorkId).toBe(copy.id);
});
