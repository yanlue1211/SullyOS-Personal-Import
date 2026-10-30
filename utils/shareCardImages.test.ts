import { describe, it, expect } from 'vitest';
import { getShareCardImageUrls } from './shareCardImages';

describe('share card image sources', () => {
  it('extracts and deduplicates XHS note images and cover', () => {
    const urls = getShareCardImageUrls({ type: 'xhs_card', metadata: { xhsNote: {
      images: [{ url: 'https://cdn.example/a.jpg' }, { url: 'https://cdn.example/b.jpg' }],
      coverUrl: 'https://cdn.example/a.jpg',
    } } } as any);
    expect(urls).toEqual(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
  });
  it('does not send video URLs as image inputs', () => {
    const urls = getShareCardImageUrls({ type: 'webpage_card', metadata: { webpage: {
      url: 'https://example.com/video', video: { coverUrl: 'https://cdn.example/cover.jpg' },
    } } } as any);
    expect(urls).toEqual(['https://cdn.example/cover.jpg']);
  });
  it('passes real video frames before cover, not the video URL', () => {
    const urls = getShareCardImageUrls({ type: 'webpage_card', metadata: { webpage: {
      video: { contentType: 'video', videoUrl: 'https://example.com/movie.mp4',
        frames: [{ timeSeconds: 1, image: 'data:image/jpeg;base64,abc' }] },
      image: 'https://example.com/cover.jpg',
    } } } as any);
    expect(urls).toEqual(['data:image/jpeg;base64,abc', 'https://example.com/cover.jpg']);
  });
  it('ignores webpage and unsupported schemes', () => {
    expect(getShareCardImageUrls({ type: 'xhs_card', metadata: { xhsNote: {
      images: ['javascript:alert(1)', 'https://cdn.example/p.png'],
    } } } as any)).toEqual(['https://cdn.example/p.png']);
  });
});
