import { setMomentsEnabled } from "./gate";
import {
  MOMENTS_STORE,
  result,
  completed,
  validHabits,
  validMedia,
  type Row,
  type Post,
  type Config,
} from "./schema";
import {
  createV2ArrayFieldWriter,
  type ZipFileWriter,
  type BackupManifest,
} from "../../utils/backupFormat";
export function validateMomentsBackup(value: unknown): Row[] {
  if (!Array.isArray(value)) throw Error("朋友圈备份不是数据表");
  const ids = new Set<string>();
  for (const r of value) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id ||
      ids.has(r.id) ||
      typeof r.owner !== "string" ||
      !Number.isFinite(r.at) ||
      r.at < 0 ||
      ![
        "correction",
        "config",
        "post",
        "seen",
        "event",
        "snapshot",
        "activity",
        "call",
        "log",
      ].includes(r.kind)
    )
      throw Error("朋友圈记录格式无效");
    ids.add(r.id);
    if(r.kind === "correction" && (typeof r.postId!=="string"||typeof r.text!=="string"||r.text.length>16000))throw Error("现实修订记录无效");
    if (r.kind === "config") {
      if (
        r.id !== "config" ||
        typeof r.enabled !== "boolean" ||
        !Number.isSafeInteger(r.revision) ||
        r.revision < 0 ||
        !r.participants ||
        Array.isArray(r.participants) ||
        !r.covers ||
        !Array.isArray(r.friends) ||
        r.friends.some(
          (p: any) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            p.some((id: any) => typeof id !== "string") ||
            p[0] === p[1],
        ) ||
        !Number.isInteger(r.target) ||
        !Number.isInteger(r.limit) ||
        r.target < 0 ||
        r.limit < 1 ||
        r.limit > 100 ||
        r.target > r.limit
      )
        throw Error("朋友圈设置无效");
      for (const p of Object.values(r.participants) as any[])
        if (
          !validHabits(p.habits) ||
          ["enabled", "post", "browse", "like", "comment", "reply"].some(
            (k) => typeof p[k] !== "boolean",
          )
        )
          throw Error("朋友圈习惯无效");
      if (
        Object.values(r.covers).some(
          (v) => typeof v !== "string" || !v.startsWith("blobref:"),
        )
      )
        throw Error("朋友圈封面无效");
    }
    if (r.kind === "post" || r.kind === "seen")
      validatePost(r.kind === "post" ? r : r.projection);
    if (
      r.kind === "seen" &&
      (r.id !== `seen:${r.owner}:${r.postId}` ||
        r.projection.id !== r.postId ||
        typeof r.reaction !== "string" ||
        r.reaction.length > 1000)
    )
      throw Error("浏览档案无效");
    if (
      r.kind === "snapshot" &&
      (r.id !== `snapshot:${r.owner}` ||
        typeof r.text !== "string" ||
        r.text.length > 15000 ||
        !Number.isFinite(r.expires))
    )
      throw Error("见闻快照无效");
    if (
      r.kind === "event" &&
      (typeof r.postId !== "string" ||
        !["pending", "done"].includes(r.status) ||
        !["post", "like", "comment"].includes(r.eventType))
    )
      throw Error("朋友圈事件无效");
    if (
      r.kind === "activity" &&
      ["nextAt", "postDue", "lastPost"].some(
        (k) => !Number.isFinite(r[k]) || r[k] < 0,
      )
    )
      throw Error("活动时间无效");
    if (
      r.kind === "call" &&
      (!["reserved", "sent", "success", "failed"].includes(r.phase) ||
        typeof r.day !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ||
        typeof r.automatic !== "boolean" ||
        !Number.isFinite(r.until) ||
        !Number.isInteger(r.revision))
    )
      throw Error("调用记录无效");
    if (
      r.kind === "log" &&
      (typeof r.text !== "string" || r.text.length > 1500)
    )
      throw Error("日志无效");
  }
  if (value.length && !value.some((r) => r.id === "config"))
    throw Error("朋友圈备份缺少配置");
  return value;
}
function validatePost(p: any): asserts p is Post {
  if (
    !p ||
    typeof p.id !== "string" ||
    (p.deletedAt!==undefined&&(!Number.isFinite(p.deletedAt)||p.deletedAt<0)) ||
    (p.editedAt!==undefined&&(!Number.isFinite(p.editedAt)||p.editedAt<0)) ||
    p.kind !== "post" ||
    typeof p.owner !== "string" ||
    typeof p.name !== "string" ||
    typeof p.text !== "string" ||
    p.text.length > 4000 ||
    typeof p.theme !== "string" ||
    !validMedia(p.media) ||
    !Number.isFinite(p.at) ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1 ||
    !p.visibility ||
    !["all", "include", "exclude", "self"].includes(p.visibility.mode) ||
    !Array.isArray(p.visibility.ids) ||
    p.visibility.ids.some((id: any) => typeof id !== "string") ||
    !Array.isArray(p.likes) ||
    p.likes.some(
      (x: any) => typeof x.authorId !== "string" || typeof x.name !== "string",
    ) ||
    new Set(p.likes.map((x: any) => x.authorId)).size !== p.likes.length ||
    !Array.isArray(p.comments) ||
    p.comments.some(
      (x: any) =>
        !x ||
        typeof x.id !== "string" ||
        typeof x.authorId !== "string" ||
        typeof x.name !== "string" ||
        typeof x.text !== "string" ||
        x.text.length > 2000 ||
        !Number.isFinite(x.at) ||
        (x.replyTo !== undefined && typeof x.replyTo !== "string"),
    ) ||
    new Set(p.comments.map((x: any) => x.id)).size !== p.comments.length
  )
    throw Error("朋友圈动态无效");
  const comments = new Map(p.comments.map((x: any) => [x.id, x]));
  for (const c of p.comments) {
    const path = new Set<string>();
    let current: any = c;
    while (current?.replyTo) {
      if (path.has(current.id) || !comments.has(current.replyTo))
        throw Error("评论引用无效");
      path.add(current.id);
      current = comments.get(current.replyTo);
    }
  }
}
export async function exportMoments(db: IDBDatabase): Promise<Row[]> {
  const tx = db.transaction(MOMENTS_STORE),
    done = completed(tx);
  const rows = await result<Row[]>(tx.objectStore(MOMENTS_STORE).getAll());
  await done;
  return rows;
}
export async function restoreMoments(db: IDBDatabase, rows: Row[]) {
  validateMomentsBackup(rows);
  const tx = db.transaction(MOMENTS_STORE, "readwrite"),
    done = completed(tx),
    s = tx.objectStore(MOMENTS_STORE);
  s.clear();
  for (const row of rows)
    s.put(
      row.kind === "config"
        ? { ...row, lease: undefined }
        : row.kind === "call" &&
            (row.phase === "reserved" || row.phase === "sent")
          ? {
              ...row,
              phase: "failed",
              until: 0,
              error: "备份恢复后结束旧请求，不自动重试",
            }
          : row,
    );
  await done;
  setMomentsEnabled(rows.some((row) => row.kind === "config" && row.enabled));
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("moments-changed"));
}
export async function streamMoments(
  db: IDBDatabase,
  zip: ZipFileWriter,
  onSerialized?: (s: string) => void,
): Promise<BackupManifest["stores"]> {
  const writer = createV2ArrayFieldWriter(zip, "momentsRecords", {
      onSerialized,
    }),
    tx = db.transaction(MOMENTS_STORE),
    done = completed(tx),
    r = tx.objectStore(MOMENTS_STORE).openCursor();
  let error: unknown;
  r.onsuccess = () => {
    const cursor = r.result;
    if (!cursor) return;
    try {
      writer.appendSync([cursor.value]);
      cursor.continue();
    } catch (e) {
      error = e;
      tx.abort();
    }
  };
  try {
    await done;
  } catch (e) {
    throw error || e;
  }
  return { momentsRecords: await writer.finish() };
}
