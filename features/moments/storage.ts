import { setMomentsEnabled } from "./gate";
import { mayReply } from "./threads";
import { openDB } from "../../utils/db";
import {
  MOMENTS_STORE as TABLE,
  MOMENTS_CHANGED,
  MOMENTS_HISTORY,
  emptyConfig,
  result,
  completed,
  uid,
  validHabits,
  validMedia,
  type Row,
  type Config,
  type Post,
  type Media,
  type Visibility,
  type Participant,
  type Seen,
  type Snapshot,
  type FeedEvent,
  type Log,
} from "./schema";
import { areFriends, canRead, projectPost, projectSeenPost, activeComments, postText } from "./permissions";
export async function transaction<T>(
  fn: (s: IDBObjectStore, tx: IDBTransaction) => Promise<T>,
  write = false,
): Promise<T> {
  const db = await openDB(),
    tx = db.transaction(
      write ? [TABLE, "characters", "messages", "assets"] : [TABLE],
      write ? "readwrite" : "readonly",
    );
  const done = completed(tx);
  void done.catch(() => {});
  try {
    const value = await fn(tx.objectStore(TABLE), tx);
    await done;
    if (write && typeof window !== "undefined")
      window.dispatchEvent(new Event(MOMENTS_CHANGED));
    return value;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    await done.catch(() => {});
    throw e;
  }
}
export async function getConfig(s?: IDBObjectStore): Promise<Config> {
  if (s) return (await result(s.get("config"))) || emptyConfig();
  const config = await transaction((store) => getConfig(store));
  setMomentsEnabled(config.enabled);
  return config;
}
export type PageCursor = number | { at: number; id: string };
export async function rows<T extends Row>(
  kind: T["kind"],
  owner?: string,
  limit = 30,
  before: PageCursor = Infinity,
  s?: IDBObjectStore,
): Promise<T[]> {
  const read = (store: IDBObjectStore) =>
    new Promise<T[]>((resolve, reject) => {
      const time = typeof before === "number" ? before : before.at;
      const index = store.index(
          owner === undefined ? "kind_at" : "kind_owner_at",
        ),
        low = owner === undefined ? [kind, 0] : [kind, owner, 0],
        high = owner === undefined ? [kind, time] : [kind, owner, time];
      const req = index.openCursor(
          IDBKeyRange.bound(low, high, false, typeof before === "number"),
          "prev",
        ),
        out: T[] = [];
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) {
          resolve(out);
          return;
        }
        if (
          typeof before !== "number" &&
          cursor.value.at === before.at &&
          String(cursor.primaryKey) >= before.id
        ) {
          cursor.continue();
          return;
        }
        out.push(cursor.value);
        cursor.continue();
      };
    });
  return s ? read(s) : transaction(read);
}
export async function getRow<T extends Row>(
  id: string,
  s?: IDBObjectStore,
): Promise<T | undefined> {
  return s ? result(s.get(id)) : transaction((store) => result(store.get(id)));
}
const requireEnabled = (c: Config) => {
  if (!c.enabled) throw Error("请先开启朋友圈");
};
async function requireActor(c: Config, id: string, tx: IDBTransaction) {
  requireEnabled(c);
  if (
    id !== "user" &&
    (!c.participants[id]?.enabled ||
      !(await result(tx.objectStore("characters").get(id))))
  )
    throw Error("角色已停用或不存在");
}
export async function saveConfig(change: (c: Config) => void) {
  const config = await transaction(async (s) => {
    const c = await getConfig(s);
    change(c);
    if (
      !Number.isInteger(c.target) ||
      c.target < 0 ||
      c.target > c.limit ||
      !Number.isInteger(c.limit) ||
      c.limit < 1 ||
      c.limit > 100
    )
      throw Error("预算目标须小于上限，上限为1～100");
    for (const p of Object.values(c.participants))
      if (
        !validHabits(p.habits) ||
        ["enabled", "post", "browse", "like", "comment", "reply"].some(
          (k) => typeof (p as any)[k] !== "boolean",
        )
      )
        throw Error("角色习惯或开关无效");
    c.friends = c.friends.filter(
      ([a, b]) => a !== b && a !== "user" && b !== "user",
    );
    c.revision++;
    c.at = Date.now();
    s.put(c);
    const snapshots = await rows<Snapshot>(
      "snapshot",
      undefined,
      10000,
      Infinity,
      s,
    );
    for (const snapshot of snapshots)
      await refreshSnapshot(s, c, snapshot.owner);
    return c;
  }, true);
  setMomentsEnabled(config.enabled);
  return config;
}
export async function setFriend(a: string, b: string, value: boolean) {
  if (a === b || a === "user" || b === "user")
    throw Error("请选择两位不同角色");
  return saveConfig((c) => {
    c.friends = c.friends.filter(
      (pair) => !(pair.includes(a) && pair.includes(b)),
    );
    if (value) c.friends.push([a, b]);
  });
}
function clean(text: unknown, max: number, allowEmpty = false): string {
  if (
    typeof text !== "string" ||
    text.length > max ||
    (!allowEmpty && !text.trim())
  )
    throw Error("文字为空或超过长度限制");
  return text.trim();
}
export function checkPost(value: {
  text: string;
  media: Media[];
  visibility: Visibility;
  theme: string;
}) {
  clean(value.text, 4000, true);
  if (!validMedia(value.media) || (!value.text.trim() && !value.media.length))
    throw Error("请填写正文或添加媒体");
  if (
    !value.visibility ||
    !["all", "include", "exclude", "self"].includes(value.visibility.mode) ||
    !Array.isArray(value.visibility.ids) ||
    value.visibility.ids.some((x) => typeof x !== "string")
  )
    throw Error("可见范围无效");
  clean(value.theme, 100, true);
}
export function isDuplicate(p: Post, history: Post[]): boolean {
  const norm = (x: string) =>
    x
      .normalize("NFKC")
      .replace(/[\s\p{P}\p{S}]/gu, "")
      .toLowerCase();
  const body = norm(p.text + p.media.map((m) => m.description).join(""));
  return (
    history.some(
      (x) => norm(x.text + x.media.map((m) => m.description).join("")) === body,
    ) ||
    (!!p.theme &&
      history
        .slice(0, 5)
        .some(
          (x) => x.theme.trim().toLowerCase() === p.theme.trim().toLowerCase(),
        ))
  );
}
export async function enqueue(
  s: IDBObjectStore,
  c: Config,
  p: Post,
  eventType: FeedEvent["eventType"],
  interactionId?: string,
  actorId?: string,
) {
  if (eventType === "like") return;
  const at = Date.now();
  for (const [id, part] of Object.entries(c.participants))
    if (
      part.enabled &&
      id !== actorId &&
      (id !== p.owner || eventType !== "post")
    ) {
      const projected = projectPost(c, id, p);
      if (
        !projected ||
        (interactionId &&
          !projected.comments.some((x) => x.id === interactionId))
      )
        continue;
      s.put({
        id: `event:${id}:${p.id}:${interactionId || p.revision}`,
        kind: "event",
        owner: id,
        at,
        postId: p.id,
        status: "pending",
        eventType,
        interactionId,
      } satisfies FeedEvent);
    }
}
export async function publishIn(
  s: IDBObjectStore,
  tx: IDBTransaction,
  c: Config,
  owner: string,
  name: string,
  input: {
    text: string;
    media: Media[];
    visibility: Visibility;
    theme: string;
  },
  id = uid(),
): Promise<Post> {
  await requireActor(c, owner, tx);
  checkPost(input);
  if (
    input.visibility.ids.some((id) => !areFriends(c, owner, id) || id === owner)
  )
    throw Error("可见范围包含非好友");
  const old = await getRow<Post>(id, s);
  if (old) {
    if (old.kind !== "post" || old.owner !== owner) throw Error("发布编号冲突");
    return old;
  }
  const post: Post = {
    ...input,
    id,
    kind: "post",
    owner,
    name: clean(name, 100),
    at: Date.now(),
    text: input.text.trim(),
    comments: [],
    likes: [],
    revision: 1,
  };
  if (owner !== "user") clean(input.theme, 100);
  if (
    owner !== "user" &&
    isDuplicate(post, await rows<Post>("post", owner, 10, Infinity, s))
  )
    throw Error("与近期主题或正文重复，本次没有发布");
  s.add(post);
  await enqueue(s, c, post, "post");
  return post;
}
export async function publish(
  owner: string,
  name: string,
  input: {
    text: string;
    media: Media[];
    visibility: Visibility;
    theme: string;
  },
  id = uid(),
) {
  return transaction(
    async (s, tx) =>
      publishIn(s, tx, await getConfig(s), owner, name, input, id),
    true,
  );
}
export async function interactIn(
  s: IDBObjectStore,
  tx: IDBTransaction,
  c: Config,
  actor: string,
  name: string,
  postId: string,
  action: {
    kind: "like" | "unlike" | "comment";
    text?: string;
    replyTo?: string;
    id?: string;
  },
) {
  await requireActor(c, actor, tx);
  const p = await getRow<Post>(postId, s),
    view = p && projectPost(c, actor, p);
  if (!p || p.kind !== "post" || !view) throw Error("动态已删除或无权查看");
  if (action.kind === "comment") {
    if (action.replyTo && !view.comments.some((x) => x.id === action.replyTo))
      throw Error("回复对象已删除或不可见");
    if (actor !== "user" && action.replyTo && !mayReply(p, action.replyTo))
      throw Error("这个话题已收束");
    const id = action.id || uid();
    if (p.comments.some((x) => x.id === id)) return p;
    p.comments.push({
      id,
      authorId: actor,
      name: clean(name, 100),
      text: clean(action.text, 2000),
      at: Date.now(),
      ...(action.replyTo ? { replyTo: action.replyTo } : {}),
    });
    p.revision++;
    s.put(p);
    await enqueue(s, c, p, "comment", id, actor);
  } else {
    const exists = p.likes.some((x) => x.authorId === actor);
    if (action.kind === "like" && !exists) {
      p.likes.push({ authorId: actor, name: clean(name, 100) });
      p.revision++;
      s.put(p);
      await enqueue(s,c,p,"like",undefined,actor);
    }
    if (action.kind === "unlike" && exists) {
      p.likes = p.likes.filter((x) => x.authorId !== actor);
      p.revision++;
      s.put(p);
    }
  }
  return p;
}
export async function interact(
  actor: string,
  name: string,
  id: string,
  action: Parameters<typeof interactIn>[6],
) {
  return transaction(
    async (s, tx) =>
      interactIn(s, tx, await getConfig(s), actor, name, id, action),
    true,
  );
}
export async function deletePost(actor: string, id: string) {
  const {revisePost}=await import('./revisions');
  return revisePost(actor,id,null);
}
export async function deleteComment(actor:string,postId:string,id:string){const {reviseComment}=await import('./comments');return reviseComment(actor,postId,id,null,actor==='user');}
export async function feedPage(
  viewer = "user",
  before: PageCursor = Infinity,
  author?: string,
): Promise<{ posts: Post[]; cursor: PageCursor; more: boolean }> {
  return transaction(async (s) => {
    const c = await getConfig(s);
    if (!c.enabled) return { posts: [], cursor: before, more: false };
    const all = await rows<Post>("post", author, 60, before, s);
    return {
      posts: all
        .map((p) => viewer === "user" ? (p.deletedAt ? undefined : {...p,comments:activeComments(p)}) : projectPost(c, viewer, p))
        .filter((p): p is Post => !!p),
      cursor: all.length
        ? { at: all[all.length - 1].at, id: all[all.length - 1].id }
        : 0,
      more: all.length === 60,
    };
  });
}
export async function pending(
  s: IDBObjectStore,
  owner: string,
  limit = 40,
): Promise<FeedEvent[]> {
  return result(
    s
      .index("pending")
      .getAll(
        IDBKeyRange.bound([owner, "pending", 0], [owner, "pending", Infinity]),
        limit,
      ),
  );
}
export async function markSeen(
  s: IDBObjectStore,
  c: Config,
  owner: string,
  p: Post,
  reaction = "",
) {
  const view = projectPost(c, owner, p);
  if (!view) throw Error("无权浏览");
  s.put({
    id: `seen:${owner}:${p.id}`,
    kind: "seen",
    owner,
    at: Date.now(),
    postId: p.id,
    projection: view,
    reaction: clean(reaction, 1000, true),
  } satisfies Seen);
}
export async function refreshSnapshot(
  s: IDBObjectStore,
  c: Config,
  owner: string,
): Promise<Snapshot> {
  const now = Date.now(),
    seen = await rows<Seen>("seen", owner, 30, Infinity, s);
  const lines: string[] = [];
  let chars = 0;
  for (const record of seen) {
    if (now - record.at > 3 * 86400000) continue;
    const p = await getRow<Post>(record.postId, s);
    if (!p) continue;
    const current=projectSeenPost(c,owner,p,record.projection);
    if(!current)continue;
    const known=current.comments;
    const text =
      `[${new Date(record.at).toISOString()} 已浏览 ${p.id}] ${postText({ ...record.projection, comments: [] })}\n${current.likes.length?"已看到的点赞："+current.likes.map(x=>x.name).join("、"):""}\n${known.map((x) => x.name + "：" + x.text).join("\n")}${record.reaction ? "\n你的反应：" + record.reaction : ""}`.slice(
        0,
        1800,
      );
    if (chars + text.length > 4500) continue;
    lines.push(text);
    chars += text.length;
  }
  const snap: Snapshot = {
    id: `snapshot:${owner}`,
    kind: "snapshot",
    owner,
    at: now,
    revision: c.revision,
    expires: now + 3600000,
    text: lines.length
      ? "\n### 私人朋友圈 · 实际见闻\n" + lines.join("\n\n")
      : "",
  };
  s.put(snap);
  return snap;
}
export async function log(s: IDBObjectStore, owner: string, text: string) {
  s.add({
    id: uid(),
    kind: "log",
    owner,
    at: Date.now(),
    text: text.slice(0, 1500),
  } satisfies Log);
  const old = await rows<Log>("log", undefined, 400, Infinity, s);
  for (const row of old.slice(200)) s.delete(row.id);
}
export async function addCard(
  s: IDBObjectStore,
  tx: IDBTransaction,
  c: Config,
  owner: string,
  p: Post,
  summary: string,
  eventId: string,
) {
  const view = projectPost(c, owner, p);
  if (!view) return;
  const deliveryId = `moments:${owner}:${eventId}`,
    messages = tx.objectStore("messages");
  if (
    await result(messages.index("charId_deliveryId").get([owner, deliveryId]))
  )
    return;
  const content = `[私人朋友圈重要事件 · ${new Date().toISOString()}]\n${clean(summary, 1200)}\n${postText(view)}\n${view.comments.map((x) => x.name + "：" + x.text).join("\n")}\n动态ID：${p.id}`;
  messages.add({
    charId: owner,
    role: "system",
    type: "moments_card",
    timestamp: Date.now(),
    content,
    metadata: { source: "moments", deliveryId, momentsPostId: p.id },
  });
}
export function announceHistory(owner: string) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(MOMENTS_HISTORY, { detail: { charId: owner } }),
    );
}
