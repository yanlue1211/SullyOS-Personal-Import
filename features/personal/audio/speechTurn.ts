export const TURN_PAUSE_MS = 2400;
export type CaptureProgress = { state: 'calibrating' | 'waiting' | 'speaking' | 'pausing' | 'complete'; remainingMs?: number };
export interface CaptureOptions { manual?: boolean; onStarted?: (stop: () => void) => void; onProgress?: (progress: CaptureProgress) => void; }
/** Calibrate the microphone floor, then use hysteresis and sustained activity, not single loud frames. */
export class SpeechTurnGate {
 private previous: number | undefined; private calibrationStart: number | undefined;
 private calibration: number[] = []; private noise = .002;
 private lastVoice = 0; private voicedMs = 0; private candidateMs = 0;
 private active = false; private peak = .02;
 remainingMs = TURN_PAUSE_MS;
 get hasSpeech() { return this.voicedMs >= 240; }
 update(rms: number, now: number): CaptureProgress['state'] {
  rms = Number.isFinite(rms) ? Math.max(0, rms) : 0;
  const delta = this.previous === undefined ? 0 : Math.min(150, Math.max(0, now - this.previous));
  this.previous = now;
  if (this.calibrationStart === undefined) this.calibrationStart = now;
  if (now - this.calibrationStart < 500) { this.calibration.push(rms); return 'calibrating'; }
  if (this.calibration.length) {
   const sorted = this.calibration.sort((a,b) => a-b);
   this.noise = Math.max(.0002, sorted[Math.floor((sorted.length - 1) * .2)]);
   this.calibration = [];
  }
  const threshold = this.active
   ? Math.max(.0035, this.noise * 1.8 + .001, this.peak * .1)
   : Math.max(.005, this.noise * 2.5 + .002);
  if (rms >= threshold) {
   this.candidateMs += delta;
   // Reject one-off clicks/breath spikes; a resuming voice must persist briefly.
   if (this.candidateMs >= 120) {
    this.active = true; this.voicedMs += delta; this.lastVoice = now;
    this.peak = Math.max(rms, this.peak * .99);
   }
  } else {
   this.candidateMs = 0;
   // Only learn from quiet frames; never raise the floor to a speaking voice.
   if (rms < threshold) this.noise = this.noise * .98 + rms * .02;
  }
  if (!this.active) return 'waiting';
  const silence = now - this.lastVoice;
  this.remainingMs = Math.max(0, TURN_PAUSE_MS - silence);
  if (this.hasSpeech && silence >= TURN_PAUSE_MS) return 'complete';
  if (!this.hasSpeech && silence >= TURN_PAUSE_MS) { this.active = false; this.voicedMs = 0; return 'waiting'; }
  return silence >= 300 ? 'pausing' : 'speaking';
 }
}

export function captureProgressLabel(progress: CaptureProgress): string {
 switch(progress.state) {
  case 'calibrating': return '先安静半秒，正在适应环境';
  case 'waiting': return '正在收音 · 等你开口';
  case 'speaking': return '听到你在说话';
  case 'pausing': return `停顿中 · ${Math.ceil((progress.remainingMs || 0) / 1000)} 秒后发送`;
  case 'complete': return '正在结束录音…';
 }
}

/** Emit only user-visible state changes, rather than rerendering an app at audio polling rate. */
export function captureProgressReporter(callback?: (progress: CaptureProgress) => void) {
 let previous = '';
 return (progress: CaptureProgress) => {
  const key = `${progress.state}:${Math.ceil((progress.remainingMs || 0) / 1000)}`;
  if (key === previous) return;
  previous = key; callback?.(progress);
 };
}
