import { DB } from '../../utils/db';
import { WorkroomStorage } from './storage';
import { acceptShare, listShares, proposeIdea } from './collaboration';
/** Only own catalog + user-shared material. No code, other catalogs or extra model request. */
export async function buildWorkroomGuide(charId: string): Promise<string> {
    if ((await DB.getCharacter(charId))?.workroomLinkEnabled !== true) return '';
    const [works,shares]=await Promise.all([WorkroomStorage.list(charId),listShares(charId)]);
    return '\n【造物间轻量联动】你有自己的造物间，可以在那里创作、修改前端小组件。正常聊天只谈灵感、介绍自己的作品、决定是否收藏用户分享；不编写或读取源码，不执行测试。无需每轮提及。\n'
        +'自己的作品（只列前40项）：'+JSON.stringify(works.filter(w=>!w.idea||w.idea.status==='done').slice(0,40).map(w=>({id:w.id,title:w.title,summary:w.summary})))
        +'\n用户发给你的未收藏作品（只列最近20项；只是分享，不是已收藏）：'+JSON.stringify(shares.filter(s=>!s.acceptedWorkId).slice(-20).map(s=>({shareId:s.id,title:s.snapshot.title,summary:s.snapshot.summary,author:s.snapshot.authorName})))
        +'\n只有自然产生创作想法时，可在正常回复后附一条 <造物间>{"action":"idea","title":"名称","summary":"一句功能/创作想法"}</造物间>，先保存灵感而不生成代码。'
        +'明确决定收藏一个已分享作品时附 <造物间>{"action":"accept","shareId":"本轮可见分享ID"}</造物间>；“好看”“以后看看”不等于收藏。不感兴趣就正常聊天，不输出动作。一轮最多一个造物间动作。系统成功复制后才算已收藏，独立副本不影响原作。\n';
}
const stableKey=async(text:string)=>'idea-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
export async function consumeWorkroomActions(raw:string,charId:string,onFailure?:(message:string)=>void,signal?:AbortSignal):Promise<string>{
    const bodies:string[]=[];
    const text=raw.replace(/<造物间\s*>([\s\S]*?)(?:<\/造物间\s*>|$)/g,(_whole,body)=>{bodies.push(body);return '';}).trim();
    if(!bodies.length)return text;
    signal?.throwIfAborted();
    if((await DB.getCharacter(charId))?.workroomLinkEnabled!==true)return text;
    try {
        if(bodies.length!==1||bodies[0].length>5000)throw Error('一轮只处理一个有效造物间动作');
        const value=JSON.parse(bodies[0]);signal?.throwIfAborted();
        if(value?.action==='idea')await proposeIdea(charId,value.title,value.summary,await stableKey(value.title+'\n'+value.summary));
        else if(value?.action==='accept')await acceptShare(charId,value.shareId);
        else throw Error('未识别的造物间动作');
    } catch(error){signal?.throwIfAborted();onFailure?.(error instanceof Error?error.message:String(error));}
    return text;
}
