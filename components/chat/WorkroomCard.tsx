import React, {useState} from 'react';
import { DB } from '../../utils/db';
import { requestWorkroomCollection } from '../../features/workroom/launch';
import { setIdeaStatus } from '../../features/workroom/collaboration';
import type { Message } from '../../types';
import { readWorkroomEvent } from '../../utils/workroomEvent';
import { workroomLaunch } from '../../features/workroom/launch';
const labels = { inspiration: '💡 灵感邀请', completed: '🎁 作品完成', progress: '🎮 互动进度', shared: '📤 用户分享', accepted: '📥 作品收藏' };
export default function WorkroomCard({ message }: { message: Message }) {
    const [notice,setNotice]=useState('');
    const event = readWorkroomEvent(message.metadata?.workroomEvent, message.charId);
    if (!event) return <p>造物间记录暂不可用</p>;
    return <article className="w-64 max-w-full p-3 space-y-2 text-sm">
        <div className="text-xs opacity-60">🧸 造物间 · {event.charName}</div>
        <h3 className="font-semibold">{labels[event.kind]}</h3>
        <p className="font-medium">{event.title}</p><p>{event.summary}</p>
        {event.sourceAuthorName && <p className="text-xs opacity-70">原作者：{event.sourceAuthorName}</p>}
        <details><summary className="cursor-pointer text-xs">查看记录</summary><p className="whitespace-pre-wrap mt-2">{event.detail}</p></details>
        <button type="button" className="rounded-full px-4 py-2 border border-current/20 text-xs" onClick={() => {
            workroomLaunch.request({ charId: event.charId, workId: event.kind === 'shared' ? '' : event.subjectId, ...(event.kind === 'shared' ? {shareId:event.shareId}: {}) }); window.dispatchEvent(new Event('workroom-open-requested'));
        }}>去造物间看看 ↗</button>
        {event.kind === 'shared' && <button type="button" className="text-xs border rounded-full p-2" onClick={()=>void DB.getCharacter(event.charId).then(char=>{if(char?.workroomLinkEnabled)requestWorkroomCollection(event.charId,event.shareId!);else setNotice('先开启造物间联动，再询问 TA 是否收藏。');}).catch(error=>setNotice(String(error)))}>询问 TA 是否收藏</button>}
        {event.kind === 'inspiration' && <button type="button" className="text-xs border rounded-full p-2" onClick={()=>void setIdeaStatus(event.charId,event.subjectId,'shelved').then(()=>setNotice('灵感已搁置，随时可以继续。')).catch(error=>setNotice(String(error)))}>暂时搁置</button>}
        {notice && <p role="status" className="text-xs">{notice}</p>}
    </article>;
}
