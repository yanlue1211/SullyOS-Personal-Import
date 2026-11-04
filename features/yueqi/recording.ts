import type { APIConfig, AudioApiConfig } from '../../types';
import { audioBlobToPayload, recognizeUserRecording } from '../../utils/audioApi';
import { resolveSttProvider, transcribeAudioWithProvider } from '../../utils/speechToText';
import { captureSpeechTurn } from '../personal/calls/handsFree';
import type { CaptureProgress } from '../personal/audio/speechTurn';
import type { CaptureCancel } from './listen';

type Callbacks = {
    text: (text: string, analysis?: string) => void;
    speech: (active: boolean) => void;
    error: (error: unknown) => void;
    end: () => void;
};
/** Both apps use the same recorder and endpointing; only recognition delivery differs. */
export async function recordVoice(api: APIConfig, cb: Callbacks, options: {
    audioApi?: AudioApiConfig; manual?: boolean; transcribing?: () => void;
    progress?: (progress: CaptureProgress) => void;
}): Promise<CaptureCancel> {
    const controller = new AbortController();
    let stop: (() => void) | undefined, finishRequested = false;
    const cancel: CaptureCancel = () => { controller.abort(); cb.speech(false); };
    cancel.finish = () => { finishRequested = true; stop?.(); };
    void (async () => {
        try {
            const result = await captureSpeechTurn(undefined, controller.signal, {
                manual: options.manual,
                onStarted: finish => { stop = finish; if (finishRequested) finish(); },
                onProgress: progress => {
                    if (controller.signal.aborted) return;
                    cb.speech(progress.state === 'speaking' || progress.state === 'pausing');
                    options.progress?.(progress);
                },
            });
            if (controller.signal.aborted || !result.audio) return;
            options.transcribing?.();
            const recognition = options.audioApi
                ? await recognizeUserRecording(await audioBlobToPayload(result.audio), options.audioApi)
                : { transcript: await transcribeAudioWithProvider(result.audio, resolveSttProvider(api) as 'minimax' | 'fishaudio' | 'elevenlabs', 'zh-CN', api), analysis: '' };
            if (controller.signal.aborted) return;
            if (/[\p{L}\p{N}]/u.test(recognition.transcript)) cb.text(recognition.transcript, recognition.analysis);
            else if (options.manual) cb.error(Error('没有识别到清楚的话语，请再说一次。'));
        } catch (error) {
            if (!controller.signal.aborted) cb.error(error instanceof Error ? Error(error.message.replace('录音已保留，请重试。', '请重新录音。')) : error);
        } finally { if (!controller.signal.aborted) cb.end(); }
    })();
    return cancel;
}
