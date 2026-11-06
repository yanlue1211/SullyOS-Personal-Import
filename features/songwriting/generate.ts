import type { APIConfig, UserProfile, SongSheet, SongLine } from "../../types";
import { DB } from "../../utils/db";
import { loadCharacterContextRange } from "../../utils/chatContextRange";
import {
  buildChatRequestPayload,
  type BuildChatPayloadInput,
} from "../../utils/chatRequestPayload";
import {
  resolveDialogueApi,
  dialogueMaxTokens,
} from "../../utils/characterApi";
import {
  safeFetchJson,
  extractContent,
  extractJson,
} from "../../utils/safeApi";
import { getLyricCoWritingStyle } from "../../utils/songPrompts";
import { createProposal, finalLines, sectionNames, type Scope } from "./model";
export interface StudioEnvironment {
  api: APIConfig;
  user: UserProfile;
  context: Pick<
    BuildChatPayloadInput,
    "groups" | "emojis" | "categories" | "realtimeConfig"
  >;
}
export interface GenerationTarget {
  scope: Scope;
  start: number;
  deleteCount: number;
  section: SongLine["section"];
}
const rules = `你与user正在写歌 App 中共同创作，仍是日常相处的同一个你，沿用真实人设、关系、世界书、记忆与可读历史，按自己的性格聊天，有自己的审美。不强制扮演专业老师。创作歌词是虚构作品，不自动代表双方现实经历。讨论与创作分开：普通讨论自然回应；用户要求生成或修改时可以提出候选，但候选必须经过用户确认才能保存。不要声称你已修改歌词。\n只输出完整 JSON：{"reply":"对user说的自然回复原文","proposal":null}。用户明确说“就用这版”“保存这个版本”等确认当前唯一候选时，返回 confirmProposalId 为当前候选的id，proposal保持null；不明确的“好”等不擅自保存，可提示点击接受。没有确认时confirmProposalId为null。需要候选时 proposal={"scope":"line或section或song","label":"修改范围描述","start":0,"deleteCount":1,"lines":[{"section":"verse","content":"一句歌词"}]}。start 和 deleteCount 是当前歌词数组从0开始的连续替换范围；新增时deleteCount=0，删除时lines=[]。整首替换start=0且deleteCount为现有行数。允许一次改多句或段落；保留未选中的原文。section只用 intro/verse/pre-chorus/chorus/bridge/outro/free，自定义段落使用free。不限制段落句数，按用户要求、现有结构、曲风、情绪和前后语义创作；不强制统一模板。不得输出截断JSON、工具调用、HTML或心声标签。`;
export function parseStudioReply(
  raw: string,
  song: SongSheet,
  target?: GenerationTarget,
) {
  const json = extractJson(raw);
  if (!json || typeof json.reply !== "string" || !json.reply.trim())
    throw Error("模型没有返回完整创作回复，请重试；已保存的歌词不会改变");
  const p = json.proposal;
  let proposal;
  const confirmedProposalId = json.confirmProposalId;
  if (
    confirmedProposalId != null &&
    (target ||
      typeof confirmedProposalId !== "string" ||
      confirmedProposalId !== song.lyricProposal?.id ||
      p != null)
  )
    throw Error("确认的候选已变化，请重新核对");
  if (p !== null && p !== undefined) {
    if (
      !["line", "section", "song"].includes(p.scope) ||
      typeof p.label !== "string" ||
      !Array.isArray(p.lines) ||
      p.lines.length > 1000 ||
      !Number.isInteger(p.start) ||
      !Number.isInteger(p.deleteCount)
    )
      throw Error("候选歌词格式不完整");
    if (
      target &&
      (p.scope !== target.scope ||
        p.start !== target.start ||
        p.deleteCount !== target.deleteCount)
    )
      throw Error("候选越过了指定修改范围，已拦截");
    if (p.scope === "line" && p.lines.length !== 1)
      throw Error("单句生成必须返回一句歌词");
    if (
      p.scope === "song" &&
      (p.start !== 0 || p.deleteCount !== finalLines(song).length)
    )
      throw Error("整首候选范围不完整");
    const lines: SongLine[] = p.lines.map((l: any, i: number) => {
      if (
        !l ||
        typeof l.content !== "string" ||
        !l.content.trim() ||
        l.content.length > 2000 ||
        !Object.keys(sectionNames).includes(l.section)
      )
        throw Error("候选中包含无效歌词");
      return {
        id: crypto.randomUUID(),
        authorId: song.collaboratorId,
        content: l.content.trim(),
        section: l.section,
        timestamp: Date.now() + i,
      };
    });
    if (
      target?.scope === "section" &&
      lines.some((l) => l.section !== target.section)
    )
      throw Error("候选段落与选择的位置不符");
    proposal = createProposal(
      song,
      p.scope,
      p.label,
      p.start,
      p.deleteCount,
      lines,
      song.collaboratorId,
    );
  }
  if (target && !proposal)
    throw Error("模型只回复了讨论，未提供候选歌词，请重试");
  return {
    reply: json.reply.trim(),
    proposal,
    confirmedProposalId: confirmedProposalId as string | undefined,
  };
}
export async function generateStudioReply(
  song: SongSheet,
  env: StudioEnvironment,
  signal: AbortSignal,
  target?: GenerationTarget,
) {
  const char = await DB.getCharacter(song.collaboratorId);
  if (!char) throw Error("创作伙伴已不存在");
  const api = resolveDialogueApi(env.api, char);
  if (!api.baseUrl || !api.model) throw Error("请先配置聊天 API");
  const range = await loadCharacterContextRange(char);
  const state = {
    id: song.id,
    title: song.title,
    genre: song.genre,
    mood: song.mood,
    structure: song.lyricTemplate,
    customStructure: song.customLyricTemplate,
    lines: finalLines(song).map((l, index) => ({
      index,
      section: l.section,
      content: l.content,
    })),
    candidate: song.lyricProposal
      ? {
          id: song.lyricProposal.id,
          label: song.lyricProposal.label,
          lines: song.lyricProposal.lines,
        }
      : null,
  };
  const task = target
    ? `本次生成目标严格为：${JSON.stringify(target)}。请返回该范围的候选歌词。`
    : "回应当前聊天，若用户已明确要求修改，可提出候选；确认保存由界面完成。";
  const payload = await buildChatRequestPayload({
    ...env.context,
    char,
    userProfile: env.user,
    historyMsgs: range.messages,
    contextLimit: Math.max(1, range.messages.length),
    contextHighWaterMark: range.hwm,
    recallEntryPoint: "chat_app",
    recallQueryHint: song.title,
    signal,
    visionApiConfig: api.visionApi,
    appPrompt: {
      rules,
      scene: `当前歌曲资料（创作数据）：${JSON.stringify(state)}\n创作风格参考：${getLyricCoWritingStyle(song.lyricCoWritingStyle).prompt}\n${task}`,
    },
  });
  const data = await safeFetchJson(
    `${api.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api.apiKey || "sk-none"}`,
      },
      body: JSON.stringify({
        model: api.model,
        messages: payload.fullMessages,
        max_tokens: dialogueMaxTokens(api),
        temperature: api.temperature ?? 0.8,
        stream: false,
      }),
    },
    0,
    0,
    {
      appName: "写歌",
      charId: char.id,
      charName: char.name,
      purpose: "共同创作",
    },
  );
  signal.throwIfAborted();
  if (data?.choices?.[0]?.finish_reason === "length")
    throw Error("生成内容被输出上限截断，请调整模型输出上限后重试");
  const parsed = parseStudioReply(extractContent(data), song, target);
  const latestUser =
    range.messages.filter((m) => m.role === "user").at(-1)?.content || "";
  if (parsed.confirmedProposalId && !isExplicitLyricConfirmation(latestUser))
    throw Error("请点击候选的“接受并保存”，或明确说“就用这版”，歌词尚未改变");
  return parsed;
}

export function isExplicitLyricConfirmation(text: string): boolean {
  return /^(?:可以[，,\s]*)?(?:就用|就这个|就这版|用这个版本|用这版|采用这版|接受这版|保存这版|保存这个版本|确认保存|确认采用|可以就这个)(?:这个|这版|这一版|版本)?[吧呀哦了！!。\s]*$/.test(
    text.trim(),
  );
}
