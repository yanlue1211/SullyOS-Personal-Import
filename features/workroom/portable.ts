import { owned, transact } from './storage';
import { assertCode, idbResult, stateId, validInteger, validText, workroomId, type WorkroomCode, type WorkroomVersion, type WorkroomWork } from './schema';

export interface PortableWork extends WorkroomCode {
    format: 'sully-workroom'; version: 1; title: string; summary: string; schemaVersion: number;
    authorName: string;
}
/** A portable work contains published code only, never private progress, credentials or discussion. */
export function parsePortableWork(text: string): PortableWork {
    if (text.length > 1_510_000) throw Error('组件文件过大');
    const value = JSON.parse(text);
    if (value?.format !== 'sully-workroom' || value.version !== 1 || !validText(value.title,300)
        || !validText(value.summary,2000) || !validText(value.authorName,200) || !validInteger(value.schemaVersion)) throw Error('不是有效的造物间组件文件');
    assertCode(value);
    return {format:'sully-workroom',version:1,title:value.title,summary:value.summary,authorName:value.authorName,schemaVersion:value.schemaVersion,html:value.html,css:value.css,js:value.js};
}
export const exportPortableWork = (charId:string,workId:string) => transact(charId,'readonly',async tx=>{
    const work=await owned(tx,charId,workId);
    if(!work.currentVersionId)throw Error('请先发布正式版本再导出');
    const version=await idbResult<WorkroomVersion>(tx.objectStore('workroom_versions').get(work.currentVersionId));
    if(!version||version.charId!==charId||version.workId!==workId)throw Error('作品版本不存在');
    const char=await idbResult(tx.objectStore('characters').get(charId));
    return parsePortableWork(JSON.stringify({...version,format:'sully-workroom',version:1,title:work.title,summary:work.summary,authorName:work.source?.authorName||char.name||'角色'}));
});
export async function importPortableWork(charId:string,text:string):Promise<WorkroomWork>{
    const file=parsePortableWork(text);
    return transact(charId,'readwrite',async tx=>{
        const at=Date.now(),id=workroomId(),versionId=workroomId();
        const work:WorkroomWork={id,charId,title:file.title,summary:file.summary,createdAt:at,updatedAt:at,currentVersionId:versionId,source:{authorId:'imported-file',authorName:file.authorName,workId:id,versionId,shareId:'local-file'}};
        const version:WorkroomVersion={id:versionId,charId,workId:id,number:1,createdAt:at,schemaVersion:file.schemaVersion,html:file.html,css:file.css,js:file.js};
        await idbResult(tx.objectStore('workroom_works').add(work));
        await idbResult(tx.objectStore('workroom_versions').add(version));
        await idbResult(tx.objectStore('workroom_states').add({id:stateId(id,file.schemaVersion),charId,workId:id,schemaVersion:file.schemaVersion,revision:1,data:{}}));
        return work;
    });
}
