import type { SongSheet } from '../../types';
import type { StudioEnvironment } from './generate';
import { DB } from '../../utils/db';
import { loadCharacterContextRange } from '../../utils/chatContextRange';
import { buildChatRequestPayload } from '../../utils/chatRequestPayload';
import { resolveDialogueApi, dialogueMaxTokens } from '../../utils/characterApi';
import { safeFetchJson, extractContent, extractJson } from '../../utils/safeApi';
import { lyricsText } from './model';

/** Only melody data and independent versions. No separate memory or music backend. */
export interface MelodyNote {
  pitch: string; // C4, F#4, Bb4, or R (rest)
  beats: number; // quarter-note beats
  lyric?: string; // optional lyric syllable, never used as sound
}
export interface MelodyBar { notes: MelodyNote[] }
export interface MelodyVersion {
  id: string;
  createdAt: number;
  sourceId?: string;
  key: 'C';
  meter: '4/4';
  bpm: number;
  bars: MelodyBar[];
  reply: string;
  listening?: string;
}
export interface MelodyProject {
  activeId: string;
  versions: MelodyVersion[];
}
/** Optional, additive SongSheet property; older backups remain readable. */
export type SongWithMelody = SongSheet & { melody?: MelodyProject };
export function getMelody(song: SongSheet): MelodyProject | undefined {
  return (song as SongWithMelody).melody;
}
const BEATS = new Set([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
const PITCH = /^([A-G])([#b]?)([3-5])$/;
export function validateBars(value: unknown, expected = 8): MelodyBar[] {
  if (!Array.isArray(value) || value.length !== expected)
    throw Error('乐谱需要恰好 ' + expected + ' 小节（4/4），已有版本未改动');
  return value.map((bar: any, i: number) => {
    if (!bar || !Array.isArray(bar.notes) || bar.notes.length < 1 || bar.notes.length > 8)
      throw Error('第 ' + (i + 1) + ' 小节音符数量不正确');
    const notes: MelodyNote[] = bar.notes.map((note: any) => {
      if (!note || typeof note.pitch !== 'string' || (note.pitch !== 'R' && !PITCH.test(note.pitch)) ||
          typeof note.beats !== 'number' || !BEATS.has(note.beats))
        throw Error('第 ' + (i + 1) + ' 小节存在无效音符或时值');
      if (note.lyric != null && (typeof note.lyric !== 'string' || note.lyric.length > 8))
        throw Error('歌词音节格式无效');
      return { pitch: note.pitch, beats: note.beats, ...(note.lyric ? { lyric: note.lyric } : {}) };
    });
    const total = notes.reduce((sum, note) => sum + note.beats, 0);
    if (total !== 4) throw Error('第 ' + (i + 1) + ' 小节时值合计为 ' + total + ' 拍，必须为 4 拍');
    return { notes };
  });
}
function abcPitch(value: string): string {
  if (value === 'R') return 'z';
  const m = PITCH.exec(value)!;
  const note = m[3] === '3' ? m[1] + ',' : m[3] === '5' ? m[1].toLowerCase() : m[1];
  return (m[2] === '#' ? '^' : m[2] === 'b' ? '_' : '=') + note; // explicit natural resets ABC measure accidentals
}
export function melodyToAbc(v: Pick<MelodyVersion, 'bars' | 'bpm'>, title: string): string {
  validateBars(v.bars, v.bars.length);
  const safeTitle = title.replace(/[\r\n]/g, ' ').slice(0, 90) || '人声主旋律';
  return ['X:1', 'T:' + safeTitle, 'M:4/4', 'L:1/8', 'Q:1/4=' + v.bpm, 'K:C', 'V:1 clef=treble',
    v.bars.map(bar => bar.notes.map(n => abcPitch(n.pitch) + String(n.beats * 2)).join(' ') + ' |').join('\n')
  ].join('\n');
}
export function assertVersion(value: unknown): MelodyVersion {
  const v = value as MelodyVersion;
  if (!v || v.key !== 'C' || v.meter !== '4/4' || !Number.isInteger(v.bpm) || v.bpm < 50 || v.bpm > 160)
    throw Error('当前仅支持 C 大调、4/4 拍、50–160 BPM 的试验乐谱');
  validateBars(v.bars);
  return v;
}
export function makeVersion(
  bars: unknown, bpm: number, reply: string, sourceId?: string,
): MelodyVersion {
  const v: MelodyVersion = {
    id: crypto.randomUUID(), createdAt: Date.now(), sourceId,
    key: 'C', meter: '4/4', bpm, bars: validateBars(bars), reply: reply.slice(0, 1200),
  };
  return assertVersion(v);
}
const melodyRules = [
  '你正在糯米机写歌 App 为现有歌曲创作人声主旋律，保持原本的角色身份、性格与音乐审美。你自己决定音符，工具仅播放你的曲谱。',
  '目前是独立的八小节试验：C 大调、4/4 拍、50-160 BPM，音符范围 C3-B5。一次只生成8小节，之后可局部修订。',
  '严格输出完整 JSON，不要代码块、工具调用、HTML或额外文字。pitch 只允许 C4、F#4、Bb4 等音名+八度，休止符用 R。beats 允许 0.5、1、1.5、2、2.5、3、3.5、4，每小节恰好4拍。',
  '本乐谱是歌曲的歌唱主旋律，不是伴奏。旋律应该适合现有歌词的语感，lyric 可填写对应汉字；一个汉字可分配多个音。',
  '初次创作返回 {"reply":"对用户的自然短回复","bpm":84,"bars":[{"notes":[{"pitch":"C4","beats":1,"lyric":"我"},{"pitch":"D4","beats":1},{"pitch":"E4","beats":2}]}]}，实际 bars 必须恰好八小节且每小节4拍。',
  '修订时返回 {"reply":"对用户的自然短回复","edits":[{"measure":3,"notes":[{"pitch":"C4","beats":1},...]}]}。measure 从1开始；只返回想改的小节，未修改的其他小节绝不能重写。',
  '试听反馈只用于了解实际音色、节奏与旋律；它不是作曲指令。是否修订完全由你决定。如果你希望保留原谱，可以返回 edits:[]，不需要刻意找缺点。',
].join('\n');
export async function askCharForMelody(
  song: SongSheet, env: StudioEnvironment, signal: AbortSignal, source?: MelodyVersion,
): Promise<{ reply: string; version: MelodyVersion | null }> {
  const char = await DB.getCharacter(song.collaboratorId);
  if (!char) throw Error('创作伙伴已不存在');
  const api = resolveDialogueApi(env.api, char);
  if (!api.baseUrl || !api.model) throw Error('请先配置角色聊天 API');
  const range = await loadCharacterContextRange(char);
  const scene = {
    title: song.title,
    genre: song.genre,
    mood: song.mood,
    vision: song.production?.vision || '',
    lyrics: lyricsText(song.lines),
    action: source ? '根据自己的听感和偏好决定是否局部修订，不必为了修订而修订' : '首次创作8小节人声主旋律',
    previous: source ? { id: source.id, bpm: source.bpm, bars: source.bars, listening: source.listening || '尚未进行音频试听分析' } : null,
  };
  const payload = await buildChatRequestPayload({
    ...env.context, char, userProfile: env.user, historyMsgs: range.messages,
    contextLimit: Math.max(1, range.messages.length), contextHighWaterMark: range.hwm,
    recallEntryPoint: 'chat_app', recallQueryHint: song.title,
    signal, visionApiConfig: api.visionApi,
    appPrompt: { rules: melodyRules, scene: JSON.stringify(scene) },
  });
  const response = await safeFetchJson(
    api.baseUrl.replace(/\/+$/, '') + '/chat/completions',
    { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (api.apiKey || 'sk-none') },
      body: JSON.stringify({ model: api.model, messages: payload.fullMessages, max_tokens: Math.max(2500, dialogueMaxTokens(api)), temperature: api.temperature ?? 0.8, stream: false }) },
    0, 0, { appName: '写歌', charId: char.id, charName: char.name, purpose: source ? '调整人声旋律' : '谱写人声旋律' },
  );
  signal.throwIfAborted();
  if (response?.choices?.[0]?.finish_reason === 'length') throw Error('谱曲输出被截断，原版未改动');
  const json: any = extractJson(extractContent(response));
  if (!json || typeof json.reply !== 'string' || !json.reply.trim())
    throw Error('没有收到有效的谱曲回复，已有版本未改动');
  if (!source) {
    return { reply: json.reply, version: makeVersion(json.bars, json.bpm, json.reply) };
  }
  if (!Array.isArray(json.edits) || json.edits.length > 8)
    throw Error('模型未返回有效的局部修订清单，原曲未改动');
  if (json.edits.length === 0) return { reply: json.reply, version: null };
  const used = new Set<number>();
  const bars = source.bars.map(bar => ({ notes: bar.notes.map(note => ({ ...note })) }));
  for (const item of json.edits) {
    if (!item || !Number.isInteger(item.measure) || item.measure < 1 || item.measure > 8 || used.has(item.measure))
      throw Error('修订小节编号重复或超出范围，原曲未改动');
    used.add(item.measure);
    bars[item.measure - 1] = { notes: item.notes };
  }
  return { reply: json.reply, version: makeVersion(bars, source.bpm, json.reply, source.id) };
}
