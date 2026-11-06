import React, { useState } from 'react';
import ShareImageGallery from './ShareImageGallery';

/** A separate component so the MessageItem conditional render never calls hooks. */
export default function ShareGalleryButton({ images, title }: { images: string[]; title: string }) {
  const [open, setOpen] = useState(false);
  if (images.length < 2) return null;
  return <>
    <button type="button" className="text-[10px] font-medium rounded-full bg-black/60 text-white px-2 py-1"
      onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}
      aria-label={`查看全部 ${images.length} 张图片`}>
      查看全部 · {images.length}张
    </button>
    {open && <ShareImageGallery images={images} title={title} onClose={() => setOpen(false)} />}
  </>;
}
