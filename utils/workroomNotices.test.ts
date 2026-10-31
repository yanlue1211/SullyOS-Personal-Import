import {beforeEach,expect,it} from 'vitest';
import {DB,openDB} from './db';
import {WORKROOM_STORES,transactionDone} from '../features/workroom/schema';
import {WorkroomStorage as W} from '../features/workroom/storage';
import {drainWorkroomOutbox} from '../features/workroom/delivery';
import {dismissWorkroomNotice,listWorkroomNotices} from '../features/workroom/notices';
beforeEach(async()=>{const db=await openDB(),names=['characters','messages',...WORKROOM_STORES],tx=db.transaction(names,'readwrite'),done=transactionDone(tx);for(const name of names)tx.objectStore(name).clear();await done;await DB.saveCharacter({id:'a',name:'阿源'} as any);});
it('完成通知独立于聊天投递，关闭及备份恢复均不删除或重发聊天完成事件',async()=>{
    const w=await W.create('a','花园','种花'),draft=await W.saveDraft('a',w.id,{html:'花',css:'',js:''},0,null);await W.publish('a',w.id,draft.revision);await drainWorkroomOutbox('a');
    const notices=await listWorkroomNotices();expect(notices).toHaveLength(1);expect(await DB.getMessagesByCharId('a',true)).toHaveLength(1);
    await dismissWorkroomNotice(notices[0].id);expect(await listWorkroomNotices()).toHaveLength(0);expect(await DB.getMessagesByCharId('a',true)).toHaveLength(1);
    const backup=await DB.exportFullData();await DB.importFullData(backup as any);await drainWorkroomOutbox('a');expect(await listWorkroomNotices()).toHaveLength(0);expect(await DB.getMessagesByCharId('a',true)).toHaveLength(1);
});
