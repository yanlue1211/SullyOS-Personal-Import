import { prepareVoiceUpload } from './voiceAudio';
import { DB, openDB } from '../../utils/db';
import { haimianCall, type HaimianCredentials } from './production';
export const HAIMIAN_READING_TEXT = '今天天气很好，阳光从窗帘的缝隙里照进来，让整个房间都变得明亮。我准备收拾一下出门，沿着街边慢慢走到附近的咖啡馆，找一个靠窗的位置坐坐。想点一杯热拿铁，再选一块小蛋糕，一边看看路上的行人，一边整理最近的想法。';
export interface VoiceCloneRecord {
    id: string;
    state: 'submitting' | 'unknown' | 'processing' | 'ready' | 'failed';
    script: string;
    history?: Omit<VoiceCloneRecord, 'history'>[];
}
const key = (charId: string) => 'songwriting:haimian-voice:' + charId;
export const loadVoiceClone = (charId: string): Promise<VoiceCloneRecord | null> => DB.getAssetRaw(key(charId));
export async function mutateVoiceClone(charId: string, change: (record: VoiceCloneRecord | null) => VoiceCloneRecord): Promise<VoiceCloneRecord> {
    const db = await openDB();
    return new Promise((resolve, reject) => { const tx = db.transaction('assets', 'readwrite'), store = tx.objectStore('assets'); let result: VoiceCloneRecord; let failure: unknown; const r = store.get(key(charId)); r.onsuccess = () => { try {
        result = change(r.result?.data || null);
        store.put({ id: key(charId), data: result });
    }
    catch (e) {
        failure = e;
        tx.abort();
    } }; tx.oncomplete = () => resolve(result); tx.onerror = () => reject(failure || tx.error); tx.onabort = () => reject(failure || tx.error || Error('音色状态保存失败')); });
}
export async function createVoiceClone(charId: string, sample: Blob, script: string, credentials: HaimianCredentials) {
    if (!credentials.token.trim() || !credentials.cookie.trim())
        throw Error('请填写连接密钥与 Cookie');
    if (!script.trim() || sample.size < 1000 || sample.size > 8 * 1024 * 1024)
        throw Error('请选择 8MB 以内的完整朗读音频，并保留对应台词');
    const uploadCopy = await prepareVoiceUpload(sample);
    const bytes = new Uint8Array(await uploadCopy.arrayBuffer());
    let raw = '';
    for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const marker = crypto.randomUUID();
    await mutateVoiceClone(charId, old => { if (old && old.state !== 'failed')
        throw Error('已有音色或待核对任务，请先查询，勿重复创建'); const { history, ...previous } = old || {}; return { id: marker, state: 'submitting', script, history: [...(history || []), ...(old ? [previous as VoiceCloneRecord] : [])] }; });
    const update = (patch: Partial<VoiceCloneRecord>) => mutateVoiceClone(charId, old => { if (old?.id !== marker)
        throw Error('音色任务已变化'); return { ...old, ...patch }; });
    try {
        const d = await haimianCall('/music/voice-upload', credentials, { audioBase64: btoa(raw), lyrics: script, confirmUpload: true });
        if (!/^\d{1,24}$/.test(String(d.voiceId)))
            throw Error('未取得有效音色 ID，请到官网核对');
        return await update({ id: String(d.voiceId), state: 'processing' });
    }
    catch (e) {
        await update({ state: 'unknown' });
        throw e;
    }
}
export async function inspectVoiceClone(charId: string, id: string, credentials: HaimianCredentials) {
    if (!/^\d{1,24}$/.test(id))
        throw Error('请填写数字音色 ID');
    const previous = await loadVoiceClone(charId);
    const d = await haimianCall('/music/voice-status', credentials, { voiceId: id });
    if (!['ready', 'processing', 'failed'].includes(d.state))
        throw Error('音色状态无效');
    return mutateVoiceClone(charId, old => { if (old?.id !== previous?.id)
        throw Error('音色已在其他页面更新，请重新查询'); if (old?.id === id)
        return { ...old, state: d.state }; const { history, ...rest } = old || {}; return { id, state: d.state, script: '', history: [...(history || []), ...(old ? [rest as VoiceCloneRecord] : [])] }; });
}
