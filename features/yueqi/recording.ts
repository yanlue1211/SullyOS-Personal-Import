import type { APIConfig, AudioApiConfig } from '../../types';
import { audioBlobToPayload, recognizeUserRecording } from '../../utils/audioApi';
import { recordingToWav } from '../personal/chatMedia/recording';
import { resolveSttProvider, transcribeAudioWithProvider } from '../../utils/speechToText';
import type { CaptureCancel } from './listen';

type Callbacks = {
    text: (text: string, analysis?: string) => void;
    speech: (active: boolean) => void;
    error: (error: unknown) => void;
    end: () => void;
};
/** Capture on the browser's recorder thread. VAD only observes; it never builds audio. */
export async function recordVoice(api: APIConfig, cb: Callbacks, options: {
    audioApi?: AudioApiConfig; manual?: boolean; transcribing?: () => void;
}): Promise<CaptureCancel> {
    // Match the working chat voice recorder: let the browser choose its input processing.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let recorder!: MediaRecorder;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false, finished = false, released = false;
    let parts: Blob[] = [];
    const release = () => {
        if (released) return;
        released = true;
        clearInterval(timer);
        source?.disconnect();
        stream.getTracks().forEach(track => track.stop());
        void context?.close().catch(() => {});
    };
    const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        if (recorder?.state === 'recording') recorder.stop();
        release(); parts = [];
        if (!cancelled) { cb.error(error); cb.end(); }
    };
    try {
        const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
            .find(type => MediaRecorder.isTypeSupported(type));
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = event => { if (!cancelled && event.data.size) parts.push(event.data); };
        recorder.onerror = () => fail(Error('录音中断，请重新录音。'));
        recorder.onstop = async () => {
            release();
            if (cancelled || finished) return;
            finished = true;
            cb.speech(true); options.transcribing?.();
            try {
                const blob = new Blob(parts, { type: recorder.mimeType }); parts = [];
                if (!blob.size) throw Error('录音太短，请再说一次。');
                // Same decoding/downsampling path as chat recordings, after capture stops.
                const wav = await recordingToWav(blob);
                if (cancelled) return;
                const result = options.audioApi
                    ? await recognizeUserRecording(await audioBlobToPayload(wav), options.audioApi)
                    : { transcript: await transcribeAudioWithProvider(wav, resolveSttProvider(api) as 'minimax' | 'fishaudio' | 'elevenlabs', 'zh-CN', api), analysis: '' };
                if (!cancelled) {
                    if (/[\p{L}\p{N}]/u.test(result.transcript)) cb.text(result.transcript, result.analysis);
                    else if (options.manual) cb.error(Error('没有识别到清楚的话语，请再说一次。'));
                }
            } catch (error) {
                if (!cancelled) cb.error(error instanceof Error ? Error(error.message.replace('录音已保留，请重试。', '请重新录音。')) : error);
            } finally { if (!cancelled) cb.end(); }
        };
        const finish = () => { if (!finished && recorder.state === 'recording') recorder.stop(); };
        let analyser: AnalyserNode | undefined;
        let samples: Float32Array | undefined;
        if (!options.manual) {
            context = new AudioContext(); await context.resume();
            source = context.createMediaStreamSource(stream);
            analyser = context.createAnalyser(); analyser.fftSize = 2048;
            source.connect(analyser); samples = new Float32Array(analyser.fftSize);
        }
        recorder.start();
        const start = performance.now();
        let lastTick = start, lastVoice = 0, voiced = 0;
        timer = setInterval(() => {
            if (finished || recorder.state !== 'recording') return;
            const now = performance.now();
            if (analyser && samples) {
                analyser.getFloatTimeDomainData(samples);
                let energy = 0; for (const sample of samples) energy += sample * sample;
                if (Math.sqrt(energy / samples.length) > .018) {
                    voiced += Math.min(now - lastTick, 150) / 1000;
                    lastVoice = now; cb.speech(true);
                }
                if (lastVoice && now - lastVoice > 1500) {
                    if (voiced >= (options.audioApi ? .2 : .65)) finish();
                    else { finished = true; recorder.stop(); release(); parts = []; cb.speech(false); cb.end(); }
                }
            }
            lastTick = now;
            // Also cap silence: avoid an indefinitely growing recording in automatic mode.
            if (now - start >= 30000) {
                if (options.manual || lastVoice) finish();
                else { finished = true; recorder.stop(); release(); parts = []; cb.speech(false); cb.end(); }
            }
        }, 100);
        const cancel: CaptureCancel = () => {
            cancelled = true;
            if (recorder.state === 'recording') recorder.stop();
            release(); parts = []; cb.speech(false);
        };
        cancel.finish = finish;
        return cancel;
    } catch (error) {
        cancelled = true;
        if (recorder?.state === 'recording') recorder.stop();
        release(); throw error;
    }
}
