import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** View only media that was actually parsed; no speculative extra pages. */
export default function ShareImageGallery({ images, title, onClose }: {
  images: string[]; title: string; onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const count = images.length;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
      if (event.key === 'ArrowRight') setIndex(i => Math.min(count - 1, i + 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [count, onClose]);
  useEffect(() => setFailed(false), [index]);
  if (!count) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title || '分享图片'} className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center"
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
      <div className="absolute top-4 left-4 right-4 flex justify-between items-center text-white text-sm z-10">
        <span className="truncate max-w-[75%]">{title || '分享图片'} · {index + 1}/{count}</span>
        <button type="button" aria-label="关闭图片浏览" className="px-3 py-2 rounded-full bg-white/20" onClick={onClose}>✕</button>
      </div>
      <div className="w-full h-[78vh] flex items-center justify-center px-12"
        onTouchStart={event => setTouchStart(event.touches[0]?.clientX ?? null)}
        onTouchEnd={event => {
          if (touchStart === null) return;
          const delta = (event.changedTouches[0]?.clientX ?? touchStart) - touchStart;
          if (delta > 45) setIndex(i => Math.max(0, i - 1));
          if (delta < -45) setIndex(i => Math.min(count - 1, i + 1));
          setTouchStart(null);
        }}>
        {failed ? <div className="text-white/70 text-sm">这张图片暂时无法加载</div> :
          <img key={images[index]} src={images[index]} alt={`第 ${index + 1} 张分享图片`}
            className="max-h-full max-w-full object-contain" referrerPolicy="no-referrer"
            onError={() => setFailed(true)} />}
      </div>
      {index > 0 && <button type="button" aria-label="上一张" className="absolute left-2 top-1/2 -translate-y-1/2 text-white bg-white/20 rounded-full w-9 h-9" onClick={() => setIndex(i => i - 1)}>‹</button>}
      {index < count - 1 && <button type="button" aria-label="下一张" className="absolute right-2 top-1/2 -translate-y-1/2 text-white bg-white/20 rounded-full w-9 h-9" onClick={() => setIndex(i => i + 1)}>›</button>}
      <span className="absolute bottom-5 text-white/70 text-xs">左右滑动切换 · {index + 1}/{count}</span>
    </div>, document.body,
  );
}
