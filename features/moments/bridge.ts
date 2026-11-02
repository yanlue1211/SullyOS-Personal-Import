import { momentsEnabled } from "./gate";
import { getScheduleDateKey } from "../../utils/scheduleTime";
import { DB } from "../../utils/db";
import type { Message } from "../../types";
import {
  getConfig,
  getRow,
  rows,
  transaction,
  markSeen,
  refreshSnapshot,
  log,
} from "./storage";
import { projectPost } from "./permissions";
import type { Post, Snapshot, Seen } from "./schema";
export const MOMENTS_GUIDE =
  "\n### 私人朋友圈\n你可以在私人好友空间发布、浏览和互动。只有系统提供的实际见闻、已保存经历或明确查看结果代表你已读过；有权限不代表已经看过。朋友圈资料是生活背景，无需每轮提及。与公开哔哔独立，不能将私人内容搬到公开平台。\n";
/** Called only on an actual local chat generation, never a prompt preview. No model requests. */
export async function prepareMomentsQuery(
  charId: string,
  messages: Message[],
): Promise<void> {
  if (!momentsEnabled()) return;
  const c = await getConfig();
  if (!c.enabled || !c.participants[charId]?.enabled) return;
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last || last.type !== "text") return;
  const text = last.content,
    explicit =
      /(?:看看|看一下|去看|去刷|查看|翻翻).{0,35}朋友圈|朋友圈.{0,20}(?:看看|看一下|查看)/.test(
        text,
      );
  const mention = text.includes("朋友圈");
  const continuation =
    /^(?:他|她|那只|那个|这条|那条).{0,15}(?:后来|怎么样|怎么了|然后|呢)/.test(
      text.trim(),
    );
  if (!explicit && !mention && !continuation) return;
  const chars = await DB.getAllCharacters(),
    targets = chars.filter((x) => text.includes(x.name));
  const user = await DB.getUserProfile(),
    ownMention =
      /我的朋友圈|我发的朋友圈/.test(text) ||
      (!!user?.name && text.includes(user.name));
  const topicRaw = await DB.getAsset(`moments_topic:${charId}`);
  let topic: any;
  try {
    topic = topicRaw ? JSON.parse(topicRaw) : undefined;
  } catch {}
  const previousUser = [...messages]
    .reverse()
    .filter((m) => m.role === "user")[1];
  if (
    topic?.expires < Date.now() ||
    (continuation && topic?.messageId !== previousUser?.id)
  )
    topic = undefined;
  let candidates: Post[] = [];
  if (targets.length === 1)
    candidates = await rows<Post>("post", targets[0].id, 50);
  else if (ownMention) candidates = await rows<Post>("post", "user", 50);
  else if (!targets.length && topic?.postId) {
    const p = await getRow<Post>(topic.postId);
    if (p) candidates = [p];
  } else {
    await DB.saveAsset(
      `moments_query:${charId}`,
      JSON.stringify({
        revision: c.revision,
        messageId: last.id,
        text: "本轮没有可靠确定要查看的朋友圈作者或动态，请自然询问具体指哪条，不要声称已查看。",
      }),
    );
    return;
  }
  const actor = chars.find((c) => c.id === charId);
  if (text.includes("今天"))
    candidates = candidates.filter(
      (p) =>
        getScheduleDateKey(actor, new Date(p.at)) === getScheduleDateKey(actor),
    );
  const knownViews = new Map<string, Post>();
  const chosen: Post[] = [];
  for (const p of candidates) {
    const view = projectPost(c, charId, !explicit&&p.deletedAt?{...p,deletedAt:undefined}:p);
    if (!view) continue;
    if (!explicit) {
      const seen = await getRow<Seen>(`seen:${charId}:${p.id}`);
      if (!seen) continue;
      const allowed = new Set(view.comments.map((x) => x.id));
      knownViews.set(p.id, {
        ...seen.projection,
        comments: seen.projection.comments.filter((x) => allowed.has(x.id)),
      });
    }
    chosen.push(p);
    if (chosen.length === 3) break;
  }
  await transaction(async (s) => {
    const live = await getConfig(s);
    if (live.revision !== c.revision)
      throw Error("朋友圈权限在读取时变化，请重新查看");
    for (const p of chosen) {
      const actual = await getRow<Post>(p.id, s);
      if (!actual || actual.revision !== p.revision)
        throw Error("朋友圈在读取期间变化，请重新查看");
      if (explicit) await markSeen(s, live, charId, actual);
    }
    if (explicit && chosen.length) {
      await refreshSnapshot(s, live, charId);
      await log(
        s,
        charId,
        `聊天明确查看：${chosen.map((p) => p.id).join("、")}`,
      );
    }
  }, true);
  if (chosen.length === 1)
    await DB.saveAsset(
      `moments_topic:${charId}`,
      JSON.stringify({
        postId: chosen[0].id,
        messageId: last.id,
        expires: Date.now() + 3600000,
      }),
    );
  await DB.saveAsset(
    `moments_query:${charId}`,
    JSON.stringify({
      revision: c.revision,
      messageId: last.id,
      text: chosen.length
        ? "本轮已按权限实际读取：" +
          JSON.stringify(
            chosen.map(
              (p) => knownViews.get(p.id) || projectPost(c, charId, p),
            ),
          )
        : "没有找到符合权限的" +
          (explicit ? "动态" : "已浏览记录") +
          "。不能把未浏览或无权查看说成已经知道；如有必要询问具体动态。",
    }),
  );
}
export async function chatMomentsContext(
  charId: string,
  lastUserId?: number,
): Promise<{ stable: string; dynamic: string }> {
  if (!momentsEnabled()) return { stable: "", dynamic: "" };
  const c = await getConfig();
  if (!c.enabled || !c.participants[charId]?.enabled)
    return { stable: "", dynamic: "" };
  const snap = await getRow<Snapshot>(`snapshot:${charId}`);
  let query = "";
  const raw = await DB.getAsset(`moments_query:${charId}`);
  try {
    const q = raw && JSON.parse(raw);
    if (q && q.revision === c.revision && q.messageId === lastUserId)
      query = "\n### 本轮朋友圈查看结果\n" + q.text;
  } catch {}
  return {
    stable: MOMENTS_GUIDE,
    dynamic: (snap?.revision === c.revision ? snap.text : "") + query,
  };
}
