/**
 * Extract bounded, ordered preview frames from a directly readable video URL.
 * This cannot bypass CORS, login walls, expiring URLs or DRM.
 * Call only on explicit share processing; never silently upload the video.
 */
export interface VideoFrame { timeSeconds: number; image: string }

export async function extractVideoFrames(videoUrl: string, options: {
  count?: number; width?: number; timeoutMs?: number;
} = {}): Promise<VideoFrame[]> {
  if (!/^https?:\/\//i.test(videoUrl)) return [];
  const count = Math.min(8, Math.max(1, Math.floor(options.count ?? 6)));
  const width = Math.min(640, Math.max(160, Math.floor(options.width ?? 480)));
  const timeoutMs = Math.min(30000, Math.max(1000, options.timeoutMs ?? 12000));
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = (eventName: string) => new Promise<void>((resolve, reject) => {
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error('视频无法读取')); };
    const timeout = () => { cleanup(); reject(new Error('视频读取超时')); };
    const cleanup = () => {
      video.removeEventListener(eventName, success);
      video.removeEventListener('error', failure);
      if (timer) clearTimeout(timer);
    };
    video.addEventListener(eventName, success, { once: true });
    video.addEventListener('error', failure, { once: true });
    timer = setTimeout(timeout, timeoutMs);
  });
  try {
    const loaded = wait('loadedmetadata');
    video.src = videoUrl;
    video.load();
    await loaded;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) return [];
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width, video.videoWidth);
    canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const frames: VideoFrame[] = [];
    for (let i = 0; i < count; i++) {
      try {
      const timeSeconds = Math.min(Math.max(0, video.duration - 0.1), (i + 0.5) * video.duration / count);
      const seeked = wait('seeked');
      video.currentTime = timeSeconds;
      await seeked;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Tainted canvas throws SecurityError; caller should fall back to cover.
      frames.push({ timeSeconds, image: canvas.toDataURL('image/jpeg', 0.62) });
      } catch (error) {
        console.warn('[share frames] Frame extraction stopped; keeping earlier frames', error);
        break;
      }
    }
    return frames;
  } catch (error) {
    console.warn('[share frames] Cannot extract video frames; keep original cover', error);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
