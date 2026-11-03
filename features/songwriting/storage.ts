import { DB, openDB } from "../../utils/db";
import type { SongSheet, Message } from "../../types";
import {
  SONGWRITING_UPDATED,
  cardText,
  lyricsText,
  proposalLines,
  lyricFingerprint,
  type LyricProposal,
  type LyricRevision,
  type SongwritingCard,
} from "./model";
export function notifySongwriting(charId: string) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(SONGWRITING_UPDATED, { detail: { charId } }),
    );
}
export async function getSong(id: string): Promise<SongSheet> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction("songs", "readonly").objectStore("songs").get(id);
    r.onsuccess = () =>
      r.result ? resolve(r.result) : reject(Error("歌曲已不存在"));
    r.onerror = () => reject(r.error);
  });
}
export async function writeTurn(
  song: SongSheet,
  role: "user" | "assistant",
  content: string,
  id: string,
): Promise<number> {
  if (!content.trim()) throw Error("不能保存空消息");
  const key = await DB.saveMessageOnce(`songwriting:${song.id}:${id}`, {
    charId: song.collaboratorId,
    role,
    type: "text",
    content,
    metadata: { source: "songwriting", songId: song.id },
  });
  notifySongwriting(song.collaboratorId);
  return key;
}
/** Existing stores, one transaction: lyrics, revision and chat card either all commit or none do. */
export async function mutateSong(
  id: string,
  change: (song: SongSheet) => {
    song: SongSheet;
    card?: SongwritingCard;
    revision?: Omit<LyricRevision, "cardId">;
  },
): Promise<SongSheet> {
  const db = await openDB();
  let result: SongSheet;
  let failure: unknown;
  const saved = await new Promise<SongSheet>((resolve, reject) => {
    const tx = db.transaction(["songs", "messages"], "readwrite");
    const songs = tx.objectStore("songs");
    const request = songs.get(id);
    request.onsuccess = () => {
      try {
        if (!request.result) throw Error("歌曲已不存在");
        const update = change(request.result);
        result = update.song;
        if (update.card) {
          const add = tx.objectStore("messages").add({
            charId: result.collaboratorId,
            role: "assistant",
            type: "text",
            content: cardText(update.card),
            timestamp: update.card.at,
            metadata: {
              source: "songwriting",
              songId: id,
              songwritingCard: update.card,
            },
          });
          add.onsuccess = () => {
            if (update.revision)
              result = {
                ...result,
                lyricRevisions: [
                  ...(result.lyricRevisions || []),
                  { ...update.revision, cardId: Number(add.result) },
                ],
              };
            else result = { ...result, completionCardId: Number(add.result) };
            songs.put(result);
          };
        } else songs.put(result);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () =>
      reject(failure || tx.error || Error("保存失败，原数据已保留"));
  });
  notifySongwriting(saved.collaboratorId);
  return saved;
}
export const saveProposal = (id: string, proposal: LyricProposal | undefined) =>
  mutateSong(id, (song) => {
    if (proposal && proposal.base !== lyricFingerprint(song.lines))
      throw Error("生成期间歌词已更新，候选未覆盖当前版本");
    return { song: { ...song, lyricProposal: proposal } };
  });
export function acceptProposal(
  id: string,
  p: LyricProposal,
  author: string,
): Promise<SongSheet> {
  return mutateSong(id, (song) => {
    if (song.lyricRevisions?.some((r) => r.id === p.id)) return { song };
    if (song.lyricProposal && song.lyricProposal.id !== p.id)
      throw Error("当前候选已变化，请重新核对");
    const lines = proposalLines(song, p);
    const before = lyricsText(song.lines),
      after = lyricsText(lines);
    if (before === after)
      return { song: { ...song, lyricProposal: undefined } };
    const at = Date.now();
    const next = {
      ...song,
      lines,
      lyricProposal: undefined,
      status: "draft" as const,
      lastActiveAt: at,
    };
    return {
      song: next,
      revision: {
        id: p.id,
        label: p.label,
        authorId: p.authorId,
        at,
        before: song.lines,
        after: lines,
      },
      card: {
        kind: "lyrics",
        songId: id,
        title: song.title,
        label: p.label,
        author,
        before,
        after,
        version: (song.lyricRevisions?.length || 0) + 1,
        at,
      },
    };
  });
}
export function completeSong(id: string, author: string): Promise<SongSheet> {
  return mutateSong(id, (song) => {
    if (!song.lines.some((l) => !l.isDraft)) throw Error("请先保存歌词");
    if (
      song.status === "completed" &&
      song.completedLyricFingerprint === lyricFingerprint(song.lines)
    )
      return { song };
    const at = Date.now();
    return {
      song: {
        ...song,
        status: "completed",
        completedAt: at,
        completedLyricFingerprint: lyricFingerprint(song.lines),
      },
      card: {
        kind: "completed",
        songId: id,
        title: song.title,
        label: "歌词正式完成",
        author,
        version: song.lyricRevisions?.length || 1,
        after: lyricsText(song.lines),
        at,
        audio: song.audio?.provider,
      },
    };
  });
}
export async function studioMessages(
  song: SongSheet,
  all = false,
  limit = 200,
): Promise<Message[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db
      .transaction("messages", "readonly")
      .objectStore("messages");
    const sourceIndex = !all && store.indexNames.contains("charId_source");
    const request = store
      .index(sourceIndex ? "charId_source" : "charId")
      .openCursor(
        IDBKeyRange.only(
          sourceIndex
            ? [song.collaboratorId, "songwriting"]
            : song.collaboratorId,
        ),
        "prev",
      );
    const rows: Message[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length >= limit) {
        resolve(rows.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id));
        return;
      }
      const message = cursor.value as Message;
      if (
        !message.groupId &&
        (all ||
          (message.metadata?.source === "songwriting" &&
            message.metadata?.songId === song.id))
      )
        rows.push(message);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

/** Reply and its candidate share a commit so a failed save can be retried without mismatched text. */
export async function commitStudioReply(
  songId: string,
  requestId: string,
  text: string,
  proposal?: LyricProposal,
): Promise<SongSheet> {
  if (!text.trim()) throw Error("不能保存空回复");
  const db = await openDB();
  let result: SongSheet;
  let failure: unknown;
  const saved = await new Promise<SongSheet>((resolve, reject) => {
    const tx = db.transaction(["songs", "messages"], "readwrite"),
      songs = tx.objectStore("songs"),
      messages = tx.objectStore("messages");
    const row = songs.get(songId);
    row.onsuccess = () => {
      try {
        if (!row.result) throw Error("歌曲已不存在");
        result = row.result;
        const deliveryId = `songwriting:${songId}:${requestId}:assistant`;
        const existing = messages
          .index("charId_deliveryId")
          .get(IDBKeyRange.only([result.collaboratorId, deliveryId]));
        existing.onsuccess = () => {
          try {
            if (existing.result) return;
            if (proposal && proposal.base !== lyricFingerprint(result.lines))
              throw Error("生成期间歌词已更新，请重新生成候选");
            if (proposal) {
              result = { ...result, lyricProposal: proposal };
              songs.put(result);
            }
            messages.add({
              charId: result.collaboratorId,
              role: "assistant",
              type: "text",
              content: text,
              timestamp: Date.now(),
              metadata: { source: "songwriting", songId, deliveryId },
            });
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () =>
      reject(failure || tx.error || Error("回复未能保存，请重试"));
  });
  notifySongwriting(saved.collaboratorId);
  return saved;
}
