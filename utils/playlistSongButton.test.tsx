// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import PlaylistSongButton from '../apps/music/PlaylistSongButton';
it('long press opens remove, suppresses play, and removes only after explicit selection',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();const host=document.createElement('div');document.body.append(host);const root=createRoot(host),play=vi.fn(),remove=vi.fn();
 await act(async()=>root.render(<PlaylistSongButton song={{id:1,name:'测试歌',artists:'歌手'} as any} onPlay={play} onRemove={remove}/>));
 const button=host.querySelector('button')!;
 await act(async()=>{button.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));vi.advanceTimersByTime(650);});
 await act(async()=>{button.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));button.click();});
 expect(play).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();expect(host.querySelector('[role=dialog]')).not.toBeNull();
 await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='删除歌曲')!.click();});expect(remove).toHaveBeenCalledTimes(1);
 await act(async()=>root.unmount());host.remove();vi.useRealTimers();
});
