import { openDB } from "../../utils/db";
import type { SongSheet } from "../../types";
import { cardText, lyricFingerprint, type SongwritingCard } from "./model";
import { getMelody, type MelodyVersion, type SongWithMelody } from "./melody";
import { notifySongwriting } from "./storage";

/**
 * Melody dialogue uses the EXACT existing songs + messages stores.
 * The reply, version, and character-facing card either commit together or none do.
 * This is not a second chat/history or memory pipeline.
 */
export async function commitMelodyTurn(
  songId: string,
  requestId: string,
  reply: string,
  version: MelodyVersion | null,
  expectedActiveId: string | undefined,
  expectedLyricFingerprint: string,
  author: string,
): Promise<SongSheet> {
  if (!reply.trim()) throw Error("不能保存空的谱曲回复");
  if (!requestId.trim()) throw Error("谱曲请求缺少唯一标识");
  const db = await openDB();
  let saved: SongSheet | undefined;
  let failure: unknown;
  const outcome = await new Promise<SongSheet>((resolve, reject) => {
    const tx = db.transaction(["songs", "messages"], "readwrite");
    const songs = tx.objectStore("songs");
    const messages = tx.objectStore("messages");
    const row = songs.get(songId);
    row.onsuccess = () => {
      try {
        const original = row.result as SongSheet | undefined;
        if (!original) throw Error("歌曲已不存在");
        saved = original;
        const deliveryId = `songwriting:${songId}:${requestId}:assistant`;
        const check = messages.index("charId_deliveryId").get(
          IDBKeyRange.only([original.collaboratorId, deliveryId]),
        );
        check.onsuccess = () => {
          try {
            // A retried network result must NEVER create a second version/card.
            if (check.result) return;
            const currentProject = getMelody(original);
            if (version) {
              if (lyricFingerprint(original.lines) !== expectedLyricFingerprint)
                throw Error("歌词已在其他地方修改，原曲未覆盖；请重新谱曲");
              if (currentProject?.activeId !== expectedActiveId)
                throw Error("乐谱已在其他地方更新，原曲未覆盖；请重新打开");
              if (currentProject?.versions.some(v => v.id === version.id))
                throw Error("旋律版本已存在，请刷新查看");
              if (version.sourceId !== expectedActiveId)
                throw Error("谱曲基线已变化，不能覆盖已有旋律");
            }
            const now = Date.now();
            messages.add({
              charId: original.collaboratorId,
              role: "assistant",
              type: "text",
              content: reply.trim(),
              timestamp: now,
              metadata: { source: "songwriting", songId, deliveryId },
            });
            if (!version) return;
            const nextIndex = (currentProject?.versions.length || 0) + 1;
            const changed = version.changedMeasures?.join("、");
            const card: SongwritingCard = {
              kind: "melody", songId, title: original.title,
              label: version.sourceId ? "旋律调整" : "谱曲完成",
              author, at: now + 1, version: nextIndex,
              after: `8小节 · C大调 · 4/4拍 · ${version.bpm} BPM${changed ? ` · 调整第${changed}小节` : ""}`,
              melodyVersionId: version.id,
            };
            const cardRow = messages.add({
              charId: original.collaboratorId,
              role: "assistant",
              type: "text",
              content: cardText(card),
              timestamp: card.at,
              metadata: { source: "songwriting", songId, songwritingCard: card },
            });
            cardRow.onsuccess = () => {
              saved = {
                ...original,
                lastActiveAt: now,
                melody: {
                  activeId: version.id,
                  versions: [...(currentProject?.versions || []), { ...version, cardId: Number(cardRow.result) }],
                },
              } as SongWithMelody;
              songs.put(saved);
            };
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
    tx.oncomplete = () => resolve(saved!);
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () => reject(failure || tx.error || Error("谱曲保存失败，原谱未改动"));
  });
  notifySongwriting(outcome.collaboratorId);
  return outcome;
}
