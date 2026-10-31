import { owned, transact } from './storage';
import { drainWorkroomOutbox } from './delivery';
import { assertCode, idbResult, stateId, validText, workroomId, type WorkroomShare, type WorkroomStoredEvent, type WorkroomVersion, type WorkroomWork } from './schema';

export async function proposeIdea(charId: string, title: string, summary: string, requestId: string) {
    if (!validText(title,300) || !validText(summary,2000) || !validText(requestId,200)) throw Error('灵感格式无效');
    const work = await transact(charId, 'readwrite', async tx => {
        const char = await idbResult(tx.objectStore('characters').get(charId));
        if (char.workroomLinkEnabled !== true) throw Error('造物间联动已关闭');
        const rows = await idbResult<WorkroomWork[]>(tx.objectStore('workroom_works').index('charId').getAll(charId));
        const previous = rows.find(w => w.idea?.invitationId === requestId); if (previous) { if(previous.title!==title || previous.summary!==summary)throw Error('灵感标识冲突');return previous; }
        const id = workroomId(), at = Date.now();
        const work: WorkroomWork = {id,charId,title,summary,createdAt:at,updatedAt:at,currentVersionId:null,idea:{status:'open',invitationId:requestId}};
        await idbResult(tx.objectStore('workroom_works').add(work));
        const eventId=workroomId();
        await idbResult(tx.objectStore('workroom_events').add({id:eventId,charId,workId:id,delivery:'pending',event:{version:1,eventId,charId,charName:char.name,kind:'inspiration',subjectId:id,title,summary,detail:`提出创作灵感：${summary}。尚未制作。`,timestamp:at}} satisfies WorkroomStoredEvent));
        return work;
    });
    await drainWorkroomOutbox(charId); return work;
}
export const setIdeaStatus = (charId:string,workId:string,status:'open'|'shelved') => transact(charId,'readwrite',async tx=>{
    const work=await owned(tx,charId,workId); if(!work.idea || !['open','shelved'].includes(status))throw Error('灵感不存在');
    await idbResult(tx.objectStore('workroom_works').put({...work,idea:{...work.idea,status}}));
});
export async function shareWork(owner:string,workId:string,recipient:string,requestId=workroomId()) {
    if(!validText(requestId,200))throw Error('分享标识无效');
    const share = await transact(owner,'readwrite',async tx=>{
        const work=await owned(tx,owner,workId);
        const char=await idbResult(tx.objectStore('characters').get(recipient)); if(!char)throw Error('接收角色不存在');
        const id=JSON.stringify([recipient,requestId]);if(id.length>200)throw Error('分享标识过长');
        const previous=await idbResult<WorkroomShare|undefined>(tx.objectStore('workroom_shares').get(id));
        if(previous){if(previous.snapshot.workId!==workId)throw Error('分享标识冲突');return previous;}
        if(!work.currentVersionId)throw Error('请先保存一个正式版本');
        const version=await idbResult<WorkroomVersion>(tx.objectStore('workroom_versions').get(work.currentVersionId));
        if(!version||version.workId!==work.id||version.charId!==owner)throw Error('作品版本无效');
        assertCode(version);
        const author=await idbResult(tx.objectStore('characters').get(owner)), at=Date.now();
        const snapshot:WorkroomShare['snapshot']={html:version.html,css:version.css,js:version.js,title:work.title,summary:work.summary,schemaVersion:version.schemaVersion,
            authorId:work.source?.authorId||owner,authorName:work.source?.authorName||author.name||'角色',workId,versionId:version.id};
        const row:WorkroomShare={id,charId:recipient,createdAt:at,snapshot};
        await idbResult(tx.objectStore('workroom_shares').add(row));
        const eventId=workroomId();
        await idbResult(tx.objectStore('workroom_events').add({id:eventId,charId:recipient,workId:id,delivery:'pending',event:{version:1,eventId,charId:recipient,charName:char.name,kind:'shared',subjectId:id,title:work.title,summary:work.summary,sourceAuthorName:snapshot.authorName,shareId:id,detail:`User 主动分享了作品，尚未加入 ${char.name} 的作品库。`,timestamp:at}} satisfies WorkroomStoredEvent));
        return row;
    });
    await drainWorkroomOutbox(recipient); return share;
}
export type WorkroomShareSummary = Omit<WorkroomShare,'snapshot'> & {snapshot: Omit<WorkroomShare['snapshot'],'html'|'css'|'js'>};
/** Chat and library lists never retain frozen code; only acceptance reads the full snapshot. */
export const listShares = (charId:string):Promise<WorkroomShareSummary[]> => transact(charId,'readonly',tx=>new Promise((resolve,reject)=>{
    const rows:WorkroomShareSummary[]=[];
    const request=tx.objectStore('workroom_shares').index('charId').openCursor(IDBKeyRange.only(charId));
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve(rows.sort((a,b)=>a.createdAt-b.createdAt));return;}
        const s=cursor.value as WorkroomShare,v=s.snapshot;
        rows.push({id:s.id,charId:s.charId,createdAt:s.createdAt,acceptedWorkId:s.acceptedWorkId,snapshot:{title:v.title,summary:v.summary,schemaVersion:v.schemaVersion,authorId:v.authorId,authorName:v.authorName,workId:v.workId,versionId:v.versionId}});
        cursor.continue();
    };
}));
export async function acceptShare(charId:string,shareId:string){
    const work=await transact(charId,'readwrite',async tx=>{
        const char=await idbResult(tx.objectStore('characters').get(charId)); if(!char)throw Error('角色已不存在');
        const share=await idbResult<WorkroomShare|undefined>(tx.objectStore('workroom_shares').get(shareId));
        if(!share||share.charId!==charId)throw Error('分享不存在或不属于当前角色');
        if(share.acceptedWorkId)return owned(tx,charId,share.acceptedWorkId);
        const s=share.snapshot;assertCode(s);const id=workroomId(),versionId=workroomId(),at=Date.now();
        const work:WorkroomWork={id,charId,title:s.title,summary:s.summary,currentVersionId:versionId,createdAt:at,updatedAt:at,source:{authorId:s.authorId,authorName:s.authorName,workId:s.workId,versionId:s.versionId,shareId}};
        await idbResult(tx.objectStore('workroom_works').add(work));
        await idbResult(tx.objectStore('workroom_versions').add({id:versionId,charId,workId:id,number:1,schemaVersion:s.schemaVersion,createdAt:at,html:s.html,css:s.css,js:s.js}));
        await idbResult(tx.objectStore('workroom_states').add({id:stateId(id,s.schemaVersion),charId,workId:id,schemaVersion:s.schemaVersion,revision:1,data:{}}));
        await idbResult(tx.objectStore('workroom_shares').put({...share,acceptedWorkId:id}));
        const eventId=workroomId();
        await idbResult(tx.objectStore('workroom_events').add({id:eventId,charId,workId:id,delivery:'pending',event:{version:1,eventId,charId,charName:char.name,kind:'accepted',subjectId:id,title:s.title,summary:s.summary,sourceAuthorName:s.authorName,shareId,detail:`${char.name} 明确选择收藏，已创建独立副本，进度重新初始化。`,timestamp:at}} satisfies WorkroomStoredEvent));
        return work;
    });
    await drainWorkroomOutbox(charId);return work;
}

export const readSharedWork = (charId:string,id:string):Promise<WorkroomShare> => transact(charId,'readonly',async tx=>{const row=await idbResult<WorkroomShare|undefined>(tx.objectStore('workroom_shares').get(id));if(!row||row.charId!==charId)throw Error('分享不存在或不属于当前角色');return row;});

/** Remove an incoming share from this character's inbox without removing its chat history or accepted copy. */
export async function deleteReceivedShare(charId:string,shareId:string){
    return transact(charId,'readwrite',async tx=>{
        const store=tx.objectStore('workroom_shares');
        const share=await idbResult<WorkroomShare|undefined>(store.get(shareId));
        if(!share||share.charId!==charId)throw Error('分享不存在或不属于当前角色');
        await idbResult(store.delete(shareId));
    });
}
