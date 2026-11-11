import {saveActivityCard} from "./cards";
import {resolveMomentsNames} from "./names";
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
  announceHistory,
} from "./storage";
import { projectPost, projectSeenPost } from "./permissions";
import type { Post, Snapshot, Seen } from "./schema";
export const MOMENTS_GUIDE =
  "\n### 私人朋友圈\n你可以在私人好友空间发布、浏览和互动。只有系统提供的实际见闻、已保存经历或明确查看结果代表你已读过；有权限不代表已经看过。朋友圈资料是生活背景，无需每轮提及。未看过、未想起或无法确认时应坦率表达不确定并询问具体哪条；不得编造动态、评论或后续，不得把猜测当事实。新查看结果是刚翻到的资料，不代表一直记得。与公开哔哔独立，不能将私人内容搬到公开平台。\n";
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
    targets = resolveMomentsNames(text,chars.filter(x=>c.participants[x.id]?.enabled));
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
  if (targets.length) {
    candidates=(await Promise.all(targets.map(x=>rows<Post>("post",x.id,50)))).flat().sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));
  }
  else if (ownMention) candidates = await rows<Post>("post", "user", 50);
  else if (!targets.length && continuation && topic?.postId) {
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
      const knowledge=projectSeenPost(c,charId,p,seen.projection);
      if(!knowledge)continue;knownViews.set(p.id,knowledge);
    }
    chosen.push(p);
    if (chosen.length === 5) break;
  }
  let wroteCard=false;
  await transaction(async (s,tx) => {
    const receipts:{post:Post;events:string[];commentIds:string[]}[]=[];
    const live = await getConfig(s);
    if (live.revision !== c.revision)
      throw Error("朋友圈权限在读取时变化，请重新查看");
    for (const p of chosen) {
      const actual = await getRow<Post>(p.id, s);
      if (!actual || actual.revision !== p.revision)
        throw Error("朋友圈在读取期间变化，请重新查看");
      if (explicit) {
        const view=projectPost(live,charId,actual)!;
        const seen=await getRow<Seen>(`seen:${charId}:${p.id}`,s);
        const old=new Set(seen?.projection.comments.map(x=>x.id)||[]);
        const received=view.comments.filter(x=>x.authorId!==charId&&!old.has(x.id)&&(x.replyTo?view.comments.some(parent=>parent.id===x.replyTo&&parent.authorId===charId):view.owner===charId));
        if(received.length)receipts.push({post:view,events:['聊天中实际读到别人对自己的评论或回复'],commentIds:received.map(x=>x.id)});
        await markSeen(s, live, charId, actual);
      }
    }
    wroteCard=await saveActivityCard(tx,live,charId,`query:${last.id}` ,receipts);
    if (explicit && chosen.length) {
      await refreshSnapshot(s, live, charId);
      await log(
        s,
        charId,
        `聊天明确查看：${chosen.map((p) => p.id).join("、")}`,
      );
    }
  }, true);
  if(wroteCard)announceHistory(charId);
  if (chosen.length !== 1) await DB.deleteAsset(`moments_topic:${charId}`);
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
