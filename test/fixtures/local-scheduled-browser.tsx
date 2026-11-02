import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../components/chat/chatRuntime.generated.css';
import LocalScheduledMessages from '../../components/chat/LocalScheduledMessages';
import { DB } from '../../utils/db';
const charId = 'local-queue-qa';
if (!(await DB.getScheduledMessages(charId)).length) {
    await DB.saveScheduledMessage({id:'qa-first',charId,content:'过一会儿再来找你，记得把被子盖好。',dueAt:Date.now()+3600000,createdAt:Date.now()});
    await DB.saveScheduledMessage({id:'qa-second',charId,content:'另一条待发送消息',dueAt:Date.now()+7200000,createdAt:Date.now()});
}
createRoot(document.getElementById('root')!).render(<main style={{padding:20}}><h1>扩展功能</h1><LocalScheduledMessages charId={charId}/></main>);
