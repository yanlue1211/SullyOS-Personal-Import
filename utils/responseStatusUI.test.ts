// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import MessageItem from '../components/chat/MessageItem';
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
const theme={id:'test',name:'test',user:{},ai:{}} as any;
const props={isFirstInGroup:true,isLastInGroup:true,activeTheme:theme,charAvatar:'',charName:'角色',userAvatar:'',onLongPress:vi.fn(),onReply:vi.fn(),selectionMode:false,isSelected:false,onToggleSelect:vi.fn()};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('updates recording text without changing its ID, content or remounting the chat',async()=>{
 const row={id:1,charId:'a',role:'user',type:'audio',content:'',timestamp:1,metadata:{audioCleared:true}} as any;
 await act(async()=>root.render(React.createElement(MessageItem,{...props,msg:row})));
 expect(host.textContent).not.toContain('识别出的原文');
 await act(async()=>root.render(React.createElement(MessageItem,{...props,msg:{...row,metadata:{...row.metadata,audioTranscript:'识别出的原文',audioAnalysis:'平静'}}})));
 expect(host.textContent).toContain('识别出的原文');expect(host.textContent).toContain('平静');
 await act(async()=>root.render(React.createElement(MessageItem,{...props,msg:{...row,metadata:{...row.metadata,audioTranscript:'手动修改的原文',audioAnalysis:'轻快'}}})));
 expect(host.textContent).toContain('手动修改的原文');expect(host.textContent).not.toContain('识别出的原文');
});
it('renders an assistant read card with native expandable reasons and no normal speech bubble',async()=>{
 const value={type:'response_status',kind:'read',reason:'他有点害羞。',footer:'缓一缓',eta:''};
 const row={id:2,charId:'a',role:'assistant',type:'score_card',content:JSON.stringify(value),timestamp:2} as any;
 await act(async()=>root.render(React.createElement(MessageItem,{...props,msg:row})));
 expect(host.querySelector('[aria-label="已读不回"]')).not.toBeNull();
 expect(host.querySelector('details')?.open).toBe(false);
 await act(async()=>host.querySelector('summary')!.click());
 expect(host.querySelector('details')?.open).toBe(true);
 expect(host.querySelector('.sully-bubble-ai')).toBeNull();
});
