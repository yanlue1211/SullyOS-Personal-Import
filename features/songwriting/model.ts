import type { SongLine, SongSheet } from "../../types";
export const SONGWRITING_UPDATED = "songwriting-history-updated";
export type StudioTheme = "moon-sheep" | "ocean-dog";
export type Scope = "line" | "section" | "song";
export interface LyricProposal {
  id: string;
  base: string;
  scope: Scope;
  label: string;
  start: number;
  deleteCount: number;
  lines: SongLine[];
  authorId: string;
  createdAt: number;
}
export interface LyricRevision {
  id: string;
  label: string;
  authorId: string;
  at: number;
  before: SongLine[];
  after: SongLine[];
  cardId: number;
}
export interface SongwritingCard {
  kind: "lyrics" | "completed";
  songId: string;
  title: string;
  label: string;
  author: string;
  before?: string;
  after?: string;
  version: number;
  at: number;
  audio?: string;
}
export const finalLines = (song: Pick<SongSheet, "lines">) =>
  song.lines.filter((l) => !l.isDraft);
export const lyricFingerprint = (lines: SongLine[]) =>
  JSON.stringify(
    lines.filter((l) => !l.isDraft).map((l) => [l.id, l.section, l.content]),
  );
export const sectionNames: Record<string, string> = {
  intro: "前奏",
  verse: "主歌",
  "pre-chorus": "预副歌",
  chorus: "副歌",
  bridge: "桥段",
  outro: "尾声",
  free: "自由段落",
};
export function lyricsText(lines: SongLine[]): string {
  let section = "";
  return lines
    .filter((l) => !l.isDraft)
    .map((l) => {
      const head = l.section === section ? "" : `[${l.section}]\n`;
      section = l.section;
      return head + l.content;
    })
    .join("\n");
}
export function parseLyrics(
  text: string,
  authorId: string,
  defaultSection: SongLine["section"] = "verse",
): SongLine[] {
  let section = defaultSection;
  const lines: SongLine[] = [];
  let at = Date.now();
  for (const raw of text.split(/\r?\n/)) {
    const content = raw.trim();
    if (!content) continue;
    const tag = content.match(/^\[([^\]]+)\]$/);
    if (tag) {
      const key = tag[1].trim().toLowerCase();
      section = (
        Object.keys(sectionNames).includes(key)
          ? key
          : Object.keys(sectionNames).find((k) => sectionNames[k] === key) ||
            "free"
      ) as SongLine["section"];
      continue;
    }
    if (content.length > 2000) throw Error("单句歌词过长，请分行后保存");
    lines.push({
      id: crypto.randomUUID(),
      authorId,
      section,
      content,
      timestamp: at++,
    });
  }
  return lines;
}
export function proposalLines(song: SongSheet, p: LyricProposal): SongLine[] {
  if (p.base !== lyricFingerprint(song.lines))
    throw Error("歌词已在别处更新，请保留候选并重新核对后生成");
  const active = finalLines(song);
  if (
    !Number.isInteger(p.start) ||
    !Number.isInteger(p.deleteCount) ||
    p.start < 0 ||
    p.deleteCount < 0 ||
    p.start + p.deleteCount > active.length
  )
    throw Error("修改范围无效");
  return [
    ...active.slice(0, p.start),
    ...p.lines,
    ...active.slice(p.start + p.deleteCount),
  ]
    .map<SongLine>((l, i) => ({ ...l, slotIndex: i }))
    .concat(song.lines.filter((l) => l.isDraft));
}
export function createProposal(
  song: SongSheet,
  scope: Scope,
  label: string,
  start: number,
  deleteCount: number,
  lines: SongLine[],
  authorId: string,
): LyricProposal {
  const p = {
    id: crypto.randomUUID(),
    base: lyricFingerprint(song.lines),
    scope,
    label,
    start,
    deleteCount,
    lines,
    authorId,
    createdAt: Date.now(),
  };
  proposalLines(song, p);
  return p;
}
export function cardText(card: SongwritingCard) {
  return `${card.kind === "lyrics" ? "🎼 歌词修改卡" : "🎵 歌曲完成卡"} · ${card.title}\n${card.label} · 第${card.version}版 · ${card.author}\n${card.kind === "lyrics" ? `修改前：\n${card.before || "（空）"}\n修改后：\n${card.after || "（空）"}` : `歌词已定稿，${card.audio ? "已有音频：" + card.audio : "音频尚未生成"}。\n${card.after || ""}`}\n歌曲引用：${card.songId}`;
}
