import type { Message } from '../types';

/** Shared-media candidates: only actual images, never a page URL or video URL. */
export function getShareCardImageUrls(message: Message): string[] {
  const meta: any = message.metadata || {};
  const note: any = meta.xhsNote || {};
  const page: any = meta.webpage || {};
  const video: any = page.video || {};
  const candidates: unknown[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string') candidates.push(value);
    else if (value && typeof value === 'object') {
      const item: any = value;
      candidates.push(item.url, item.urlDefault, item.urlPre, item.src, item.imageUrl);
      if (Array.isArray(item.urlList)) candidates.push(...item.urlList);
    }
  };
  if (message.type === 'xhs_card') {
    [note.images, note.imageList, note.imageUrls, note.image_urls].forEach(list => {
      if (Array.isArray(list)) list.forEach(add);
    });
    add(note.coverUrl);
  } else if (message.type === 'webpage_card') {
    if (video.contentType === 'image') {
      [video.images, video.imageUrls, video.imageList].forEach(list => {
        if (Array.isArray(list)) list.forEach(add);
      });
    }
    // Captured frames represent actual video content; do not pretend cover = video.
    if (video.contentType === 'video' && Array.isArray(video.frames)) {
      video.frames.forEach((frame: any) => add(frame?.image));
    }
    add(video.coverUrl);
    add(page.image);
    add(page.imageUrl);
    add(page.coverUrl);
  }
  return [...new Set(candidates.filter((value): value is string =>
    typeof value === 'string' && /^(https?:\/\/|data:image\/|blobref:)/i.test(value)
  ))].slice(0, 18);
}
