import { beforeEach, expect, it } from 'vitest';
import { DB, openDB } from './db';
import { WORKROOM_STORES, transactionDone } from '../features/workroom/schema';
import { WorkroomStorage as W } from '../features/workroom/storage';
import { exportPortableWork, importPortableWork, parsePortableWork } from '../features/workroom/portable';
import { validateWorkroomBackup } from '../features/workroom/backup';
beforeEach(async()=>{const db=await openDB(),tx=db.transaction(['characters',...WORKROOM_STORES],'readwrite'),done=transactionDone(tx);for(const name of ['characters',...WORKROOM_STORES])tx.objectStore(name).clear();await done;for(const id of ['a','b'])await DB.saveCharacter({id,name:id} as any);});
it('单组件往返只复制正式代码，保留作者说明并重置私人进度，不覆盖原作',async()=>{
    const w=await W.create('a','花园','种一朵花'),d=await W.saveDraft('a',w.id,{html:'<button>花</button>',css:'button{color:red}',js:'console.log(1)'},0,null),v=await W.publish('a',w.id,d.revision);
    await W.saveState('a',w.id,v.id,1,{privateName:'秘密',level:9});
    const file=await exportPortableWork('a',w.id);expect(JSON.stringify(file)).not.toContain('秘密');expect(JSON.stringify(file)).not.toContain('charId');
    const copy=await importPortableWork('b',JSON.stringify({...file,apiKey:'do-not-copy',data:{secret:1}}));
    expect(copy.id).not.toBe(w.id);expect(copy.source?.authorName).toBe('a');
    const loaded=await W.get('b',copy.id);expect(loaded.versions[0].html).toBe(file.html);
    expect((await W.loadState('b',copy.id,copy.currentVersionId!)).data).toEqual({});
    expect((await W.loadState('a',w.id,v.id)).data).toEqual({privateName:'秘密',level:9});
    expect(JSON.stringify(loaded)).not.toContain('do-not-copy');
    expect(validateWorkroomBackup(await DB.exportFullData() as any)).toBeDefined();
});
it('坏文件、临时资源和跨角色读取被拒绝，导入不执行代码也不产生完成卡',async()=>{
    const file={format:'sully-workroom',version:1,title:'组件',summary:'说明',authorName:'作者',schemaVersion:1,html:'',css:'',js:'throw Error("never execute")'};
    expect(()=>parsePortableWork(JSON.stringify({...file,version:2}))).toThrow();
    expect(()=>parsePortableWork(JSON.stringify({...file,html:'blob:private'}))).toThrow();
    const copy=await importPortableWork('b',JSON.stringify(file));await expect(exportPortableWork('a',copy.id)).rejects.toThrow();
    expect((await DB.getRawStoreData('workroom_events'))).toHaveLength(0);
});
it('草稿测试记录绑定修订、供后续创作读取并可备份，旧测试不能覆盖新草稿',async()=>{
    const work=await W.create('a','测试','记录错误'),draft=await W.saveDraft('a',work.id,{html:'',css:'',js:''},0,null);
    await W.saveTestReport('a',work.id,draft.revision,['按钮报错'],'点击保存后出现错误');
    expect((await W.get('a',work.id)).work.testReport).toMatchObject({draftRevision:1,errors:['按钮报错'],notes:'点击保存后出现错误'});
    expect(validateWorkroomBackup(await DB.exportFullData() as any)?.workroomWorks[0].testReport?.errors).toEqual(['按钮报错']);
    await W.saveDraft('a',work.id,{html:'已改',css:'',js:''},1,null);
    await expect(W.saveTestReport('a',work.id,1,[],'旧反馈')).rejects.toThrow('草稿已变化');
});
