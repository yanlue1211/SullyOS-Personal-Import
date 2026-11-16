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
  changedMeasures?: number[];
  cardId?: number;
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
  bars: unknown, bpm: number, reply: string, sourceId?: string, changedMeasures?: number[],
): MelodyVersion {
  const v: MelodyVersion = {
    id: crypto.randomUUID(), createdAt: Date.now(), sourceId,
    key: 'C', meter: '4/4', bpm, bars: validateBars(bars), reply: reply.slice(0, 1200), changedMeasures,
  };
  return assertVersion(v);
}
const melodyRules = [
  '你正在糯米机的写歌 App 和 user 共同创作【人声主旋律】。你仍是同一个角色，保留原本人设、关系与音乐审美。普通聊天自然交流；是否谱写或修改由对话内容决定，不要把普通讨论强行转为谱曲。',
  '当前试用限定 C 大调、4/4 拍、每次8小节、50–160 BPM，音高 C3–B5。乐谱是人声旋律，不是钢琴伴奏。工具只按音符演奏，音频分析只客观描述听到的声音、不提供修改建议；由你自主决定。',
  '只输出可解析的完整 JSON。始终包含 reply：你对 user 说的自然口语回复。不要代码块、额外文字、工具调用或心声标签。回复要符合你的性格。',
  '普通聊天、谈想法、解释当前旋律、暂不谱曲时输出 {"reply":"你的回复","action":"discuss"}；不要产生新的乐谱或卡片。',
  '没有旧版且 user 明确要你谱曲时输出 {"reply":"你的回复","bpm":84,"bars":[{"notes":[{"pitch":"C4","beats":1,"lyric":"我"},{"pitch":"D4","beats":1},{"pitch":"E4","beats":2}]}]}，实际必须恰好8小节且每小节合计4拍。pitch 只允许 C4、F#4、Bb4 等音名与八度，休止符 R；beats 仅限0.5、1、1.5、2、2.5、3、3.5、4。',
  '有旧版且 user 明确让你修改时输出 {"reply":"你的回复","edits":[{"measure":3,"notes":[{"pitch":"C4","beats":1},...]}]}。measure 从1开始，只列真正需要改动的小节，其他小节绝不能重写；不想改则 edits:[]。',
  '谱曲应尽量照顾歌词汉字和音符的对应关系，lyric 可标出对应汉字；一个字可分配多个音符。音符、休止符、时值必须是实际可播放的精确数据，而不是文字描述。',
  '不得将客观听感描述当作强制修改命令。允许 user 和你就音乐反复讨论；不要求每次对话都产生新版本。'
].join('\n');
export async function askCharForMelody(
  song: SongSheet, env: StudioEnvironment, signal: AbortSignal, source?: MelodyVersion, userRequest = '',
): Promise<{ reply: string; version: MelodyVersion | null }> {
  const char = await DB.getCharacter(song.collaboratorId);
  if (!char) throw Error('创作伙伴已不存在');
  const api = resolveDialogueApi(env.api, char);
  if (!api.baseUrl || !api.model) throw Error('请先配置角色聊天 API');
  const range = await loadCharacterContextRange(char);
  const scene = {
    title: song.title,
    genre: song.genre === "free" ? "不限曲风，根据讨论自由发挥" : song.genre,
    mood: song.mood === "free" ? "根据讨论自由发挥，可随段落变化" : song.mood,
    vision: song.production?.vision || '',
    lyrics: lyricsText(song.lines),
    action: source ? '根据 user 的本轮表达决定聊天、保留当前曲谱或局部修订' : '根据 user 的本轮表达决定聊天还是开始八小节谱曲',
    userRequest: userRequest.slice(0, 5000),
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
  if (json.action === 'discuss') return { reply: json.reply.trim(), version: null };
  if (!source) {
    return { reply: json.reply.trim(), version: makeVersion(json.bars, json.bpm, json.reply) };
  }
  if (!Array.isArray(json.edits) || json.edits.length > 8)
    throw Error('模型未返回有效的局部修订清单，原曲未改动');
  if (json.edits.length === 0) return { reply: json.reply, version: null };
  const used = new Set<number>();
  const changed: number[] = [];
  const bars = source.bars.map(bar => ({ notes: bar.notes.map(note => ({ ...note })) }));
  for (const item of json.edits) {
    if (!item || !Number.isInteger(item.measure) || item.measure < 1 || item.measure > 8 || used.has(item.measure))
      throw Error('修订小节编号重复或超出范围，原曲未改动');
    used.add(item.measure);
    const patch = validateBars([{ notes: item.notes }, ...Array.from({ length: 7 }, (_, index) => source.bars[(item.measure + index) % 8])])[0];
    if (JSON.stringify(patch) === JSON.stringify(source.bars[item.measure - 1])) continue;
    bars[item.measure - 1] = patch;
    changed.push(item.measure);
  }
  if (!changed.length) return { reply: json.reply.trim(), version: null };
  return { reply: json.reply.trim(), version: makeVersion(bars, source.bpm, json.reply, source.id, changed) };
}
