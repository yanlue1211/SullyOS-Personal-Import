export const TURN_PAUSE_MS = 4000;
export type CaptureProgress = { state: 'calibrating' | 'waiting' | 'speaking' | 'pausing' | 'interrupted' | 'complete'; remainingMs?: number };
export interface CaptureOptions { manual?: boolean; onStarted?: (stop: () => void) => void; onProgress?: (progress: CaptureProgress) => void; }
/** Calibrate the microphone floor, then use hysteresis and sustained activity, not single loud frames. */
export class SpeechTurnGate {
 private previous: number | undefined; private calibrationStart: number | undefined;
 private calibration: number[] = []; private noise = .002;
 private lastVoice = 0; private voicedMs = 0; private candidateMs = 0;
 private active = false; private peak = 0; private recent: { rms: number; at: number }[] = [];
 remainingMs = TURN_PAUSE_MS;
 get hasSpeech() { return this.voicedMs >= 180; }
 /** Unknown/stalled analysis is neither speech nor silence; preserve the remaining pause. */
 hold(now: number) {
  const gap = this.previous === undefined ? 0 : Math.max(0, now - this.previous);
  if (this.active) this.lastVoice += gap;
  if (this.calibrationStart !== undefined) this.calibrationStart += gap;
  this.previous = now; this.candidateMs = 0; this.recent = [];
 }
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
  this.recent.push({rms, at: now});
  while(this.recent.length && now-this.recent[0].at>1600)this.recent.shift();
  // AGC can lift a steady microphone hiss AFTER initial calibration. Learn only a
  // low, stationary plateau below the established voice peak, not modulated speech.
  if(this.hasSpeech && this.recent.length>=12 && now-this.recent[0].at>=1200){
   const levels=this.recent.map(frame=>frame.rms).sort((a,b)=>a-b);
   const low=levels[Math.floor(levels.length*.1)],high=levels[Math.floor(levels.length*.9)];
   if(low>this.noise*1.5 && high<=low*1.2 && high<Math.min(.03,this.peak*.3))this.noise=low;
  }
  const threshold = this.active
   ? Math.max(.0035, this.noise * 1.8 + .001)
   : Math.max(.005, this.noise * 2.5 + .002);
  if (rms >= threshold) {
   this.candidateMs += delta;
   // Reject one-off clicks/breath spikes; a resuming voice must persist briefly.
   if (this.candidateMs >= 120) {
    this.voicedMs += this.active ? delta : this.candidateMs;
    this.active = true; this.lastVoice = now; this.peak = Math.max(this.peak,rms);
   }
  } else {
   this.candidateMs = 0;
   // Only learn from quiet frames; never raise the floor to a speaking voice.
   if (rms < threshold) this.noise = this.noise * .98 + rms * .02;
  }
  if (!this.active) return 'waiting';
  const silence = now - this.lastVoice;
  this.remainingMs = Math.max(0, TURN_PAUSE_MS - silence);
  if (this.hasSpeech && silence >= TURN_PAUSE_MS && this.candidateMs === 0) return 'complete';
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
  case 'interrupted': return '停顿检测暂停 · 可点“说完了”';
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

/** Remove DC offset before measuring activity; a biased waveform is not continuous speech. */
export function waveformRms(samples: Float32Array): number {
 if(!samples.length)return 0;
 let sum=0,squares=0;
 for(const value of samples){sum+=value;squares+=value*value;}
 const mean=sum/samples.length;
 return Math.sqrt(Math.max(0,squares/samples.length-mean*mean));
}
/** Recorder and Web Audio can have independent lifecycles on mobile. */
export class SpeechAnalysisClock {
 private time:number|undefined;private advancedAt:number|undefined;
 healthy(time:number|undefined,state:string|undefined,now:number):boolean {
  if(Number.isFinite(time)){
   if(this.time===undefined||time!>this.time+1e-6){this.time=time;this.advancedAt=now;}
  }
  return (!state||state==='running') && (this.advancedAt===undefined||now-this.advancedAt<700);
 }
}
