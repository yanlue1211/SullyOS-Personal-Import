// @vitest-environment jsdom
import React from 'react';
import {createRoot} from 'react-dom/client';
import {act} from 'react';
import {expect,it,vi} from 'vitest';
vi.mock('./blobRef',()=>({useBlobRefUrl:(value?:string)=>value}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
import MusicCover,{MUSIC_COVER_PLACEHOLDER} from '../components/os/MusicCover';
it('uses a local music icon for absent/empty covers and a failed URL, then accepts a new cover',async()=>{
 const el=document.createElement('div'),root=createRoot(el);let value:string|undefined;
 const render=async()=>{await act(async()=>root.render(<MusicCover value={value} className="w-10 h-10"/>));return el.querySelector('img')!;};
 let img=await render();expect(img.src).toBe(MUSIC_COVER_PLACEHOLDER);value=' ';img=await render();expect(img.src).toBe(MUSIC_COVER_PLACEHOLDER);
 value='https://cdn.test/cover.jpg';img=await render();expect(img.src).toBe(value);await act(async()=>{img.dispatchEvent(new Event('error'));});expect(img.src).toBe(MUSIC_COVER_PLACEHOLDER);expect(img.className).toBe('w-10 h-10');
 value='https://cdn.test/new-cover.jpg';img=await render();expect(img.src).toBe(value);await act(async()=>root.unmount());
});
