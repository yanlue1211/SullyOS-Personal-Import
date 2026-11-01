import { beforeEach, it, expect, vi } from "vitest";
import { DB, openDB } from "./db";
import {
  emptyConfig,
  participantDefaults,
  habitDefaults,
  MOMENTS_STORE,
  result,
  type Config,
  type Post,
  type Activity,
  type Call,
  type Snapshot,
  type Seen,
} from "../features/moments/schema";
import {
  areFriends,
  projectPost,
  canRead,
} from "../features/moments/permissions";
import {
  getConfig,
  saveConfig,
  setFriend,
  publish,
  interact,
  deletePost,
  rows,
  getRow,
  transaction,
  pending,
  feedPage,
  markSeen,
  refreshSnapshot,
  addCard,
} from "../features/moments/storage";
import {
  reserveActivity,
  markCallSent,
  applyActivity,
  activityPrompt,
  nextOpportunity,
} from "../features/moments/runtime";
import { threadReplies, mayReply } from "../features/moments/threads";
import {
  inQuietHours,
  quietNightKey,
  sleepOpportunity,
} from "../features/moments/sleep";
import {
  exportMoments,
  restoreMoments,
  validateMomentsBackup,
  streamMoments,
} from "../features/moments/backup";
import {
  chatMomentsContext,
  prepareMomentsQuery,
} from "../features/moments/bridge";
import {
  formatMessageForPrompt,
  formatMessageWithTime,
  isMessageSemanticallyRelevant,
} from "./messageFormat";
import { ChatPrompts } from "./chatPrompts";
import { getLocalDateKey } from "./localDate";
import type { CharacterProfile, Message } from "../types";
const char = (id: string) =>
  ({
    id,
    name: id,
    systemPrompt: "独立角色",
    worldview: "",
    memories: [],
    mountedWorldbooks: [],
  }) as unknown as CharacterProfile;
const input = (text = "午后散步", theme = "散步") => ({
  text,
  theme,
  media: [],
  visibility: { mode: "all" as const, ids: [] },
});
const ids = ["d", "e", "f", "g", "h", "i", "a", "b", "c"];
beforeEach(async () => {
  vi.restoreAllMocks();
  await DB.deleteDB();
  localStorage.clear();
  for (const id of ids) await DB.saveCharacter(char(id));
  await DB.saveUserProfile({ name: "user" } as any);
});
async function configure() {
  await saveConfig((c) => {
    c.enabled = true;
    for (const id of ids)
      c.participants[id] = { ...participantDefaults(), enabled: true };
    const clique = ids.slice(0, 6);
    for (const a of clique)
      for (const b of clique) if (a < b) c.friends.push([a, b]);
    for (const x of ["a", "b"]) for (const y of clique) c.friends.push([x, y]);
    c.friends.push(["c", "a"], ["c", "d"]);
  });
}
async function ready(owner = "a", postDue = 0) {
  await transaction(async (s) => {
    s.put({
      id: `activity:${owner}`,
      kind: "activity",
      owner,
      at: Date.now(),
      nextAt: 0,
      postDue,
      lastPost: 0,
    } satisfies Activity);
  }, true);
}
const response = (
  id: string,
  browsed: string[] = [],
  actions: any[] = [],
  post: any = null,
  important: any[] = [],
) => ({ requestId: id, browsed, actions, post, important });
it("defaults to disabled and never reserves a model request", async () => {
  expect((await getConfig()).enabled).toBe(false);
  expect(await reserveActivity("a", true)).toBeUndefined();
  expect(await rows("call")).toEqual([]);
});
it("implements the exact nine-character graph without assuming a and b are friends", async () => {
  await configure();
  const c = await getConfig();
  expect(areFriends(c, "a", "b")).toBe(false);
  expect(areFriends(c, "c", "a")).toBe(true);
  expect(areFriends(c, "c", "d")).toBe(true);
  for (const x of ["b", "e", "f", "g", "h", "i"])
    expect(areFriends(c, "c", x)).toBe(false);
  for (const id of ids) expect(areFriends(c, "user", id)).toBe(true);
});
it.each(["all", "include", "exclude", "self"] as const)(
  "enforces independent %s post visibility",
  async (mode) => {
    await configure();
    const p = await publish("user", "user", {
      ...input(),
      visibility: {
        mode,
        ids: mode === "include" || mode === "exclude" ? ["a"] : [],
      },
    });
    const c = await getConfig();
    expect(canRead(c, "user", p)).toBe(true);
    expect(canRead(c, "a", p)).toBe(mode === "all" || mode === "include");
    expect(canRead(c, "b", p)).toBe(mode === "all" || mode === "exclude");
  },
);
it("filters likes, hidden comments and third-party replies consistently", async () => {
  await configure();
  const p = await publish("user", "user", input());
  await interact("b", "b", p.id, { kind: "like" });
  await interact("b", "b", p.id, {
    kind: "comment",
    text: "B的秘密评论",
    id: "hidden",
  });
  await interact("d", "d", p.id, {
    kind: "comment",
    text: "回应B",
    replyTo: "hidden",
    id: "reply",
  });
  await interact("d", "d", p.id, {
    kind: "comment",
    text: "大家好",
    id: "visible",
  });
  const c = await getConfig(),
    raw = (await getRow<Post>(p.id))!;
  expect(projectPost(c, "a", raw)?.comments.map((x) => x.id)).toEqual([
    "visible",
  ]);
  expect(projectPost(c, "a", raw)?.likes).toEqual([]);
  expect(projectPost(c, "user", raw)?.comments).toHaveLength(3);
});
it("allows a third friend to reply to an existing visible comment", async () => {
  await configure();
  const p = await publish("d", "d", input());
  await interact("a", "a", p.id, {
    kind: "comment",
    text: "风景不错",
    id: "a-comment",
  });
  await interact("c", "c", p.id, {
    kind: "comment",
    text: "是的我也喜欢",
    replyTo: "a-comment",
  });
  expect((await getRow<Post>(p.id))?.comments[1].replyTo).toBe("a-comment");
});
it("counts the entire root thread across participants and stops at six replies", async () => {
  await configure();
  const p = await publish("d", "d", input());
  await interact("a", "a", p.id, {
    kind: "comment",
    text: "开个话题",
    id: "root",
  });
  for (let i = 0; i < 6; i++)
    await interact(i % 2 ? "a" : "c", i % 2 ? "a" : "c", p.id, {
      kind: "comment",
      text: "礼貌回应" + i,
      replyTo: "root",
      id: "r" + i,
    });
  const actual = (await getRow<Post>(p.id))!;
  expect(threadReplies(actual, "r5")).toBe(6);
  expect(mayReply(actual, "root")).toBe(false);
  await expect(
    interact("c", "c", p.id, { kind: "comment", text: "继续", replyTo: "r5" }),
  ).rejects.toThrow("收束");
  await interact("c", "c", p.id, { kind: "comment", text: "新的独立话题" });
});
it("does not dispatch model activity or immediate comments on publication", async () => {
  await configure();
  const p = await publish("user", "user", input());
  expect((await getRow<Post>(p.id))?.comments).toEqual([]);
  expect(await rows("call")).toHaveLength(0);
  expect(await transaction((s) => pending(s, "a"))).toHaveLength(1);
  expect(await rows("seen")).toHaveLength(0);
});
it("records browsing without interacting and keeps the same snapshot bytes across reads", async () => {
  await configure();
  const p = await publish("user", "user", input());
  await ready();
  const task = (await reserveActivity("a", false))!;
  await markCallSent(task.call.id);
  await applyActivity(task, response(task.call.id, [p.id]), char("a"));
  const first = (await chatMomentsContext("a")).dynamic;
  expect(first).toContain("午后散步");
  expect(await getRow<Seen>(`seen:a:${p.id}`)).toBeDefined();
  expect((await getRow<Post>(p.id))?.comments).toEqual([]);
  expect((await chatMomentsContext("a")).dynamic).toBe(first);
  expect((await chatMomentsContext("b")).dynamic).not.toContain("午后散步");
});
it("a new comment creates an incremental event without resetting the post to unread", async () => {
  await configure();
  const p = await publish("user", "user", input());
  await transaction(async (s) => {
    const c = await getConfig(s);
    await markSeen(s, c, "a", p);
    for (const e of await pending(s, "a")) s.put({ ...e, status: "done" });
  }, true);
  await interact("d", "d", p.id, {
    kind: "comment",
    text: "新变化",
    id: "new",
  });
  expect(await getRow(`seen:a:${p.id}`)).toBeDefined();
  const queue = await transaction((s) => pending(s, "a"));
  expect(queue.map((x) => x.eventType)).toEqual(["comment"]);
});
it("serializes leases across concurrent callers and refuses duplicate results", async () => {
  await configure();
  await publish("user", "user", input());
  await ready();
  const tasks = await Promise.all([
    reserveActivity("a", false),
    reserveActivity("b", false),
  ]);
  expect(tasks.filter(Boolean)).toHaveLength(1);
  const task = tasks.find(Boolean)!;
  await markCallSent(task.call.id);
  await applyActivity(
    task,
    response(
      task.call.id,
      task.posts.map((p) => p.id),
    ),
    char(task.call.owner),
  );
  await expect(
    applyActivity(task, response(task.call.id), char(task.call.owner)),
  ).rejects.toThrow();
});
it("rejects a stale privacy response without recording browsing or comments", async () => {
  await configure();
  const p = await publish("d", "d", input());
  await ready();
  const task = (await reserveActivity("a", false))!;
  await markCallSent(task.call.id);
  await setFriend("a", "d", false);
  await expect(
    applyActivity(
      task,
      response(
        task.call.id,
        [p.id],
        [{ kind: "comment", postId: p.id, text: "不该写入" }],
      ),
      char("a"),
    ),
  ).rejects.toThrow();
  expect(await getRow(`seen:a:${p.id}`)).toBeUndefined();
  expect((await getRow<Post>(p.id))?.comments).toEqual([]);
});
it("rolls back the entire response if a later action is invalid", async () => {
  await configure();
  const p = await publish("user", "user", input());
  await ready();
  const task = (await reserveActivity("a", false))!;
  await markCallSent(task.call.id);
  await expect(
    applyActivity(
      task,
      response(
        task.call.id,
        [p.id],
        [
          { kind: "like", postId: p.id },
          { kind: "comment", postId: "missing", text: "bad" },
        ],
      ),
      char("a"),
    ),
  ).rejects.toThrow();
  expect((await getRow<Post>(p.id))?.likes).toEqual([]);
  expect(await rows("seen")).toEqual([]);
});
it("counts sent failures against automatic budget but keeps manual calls independent", async () => {
  await configure();
  await saveConfig((c) => {
    c.target = 1;
    c.limit = 1;
  });
  await publish("user", "user", input());
  await ready();
  const task = (await reserveActivity("a", false))!;
  await transaction(async (s) => {
    const call = await getRow<Call>(task.call.id, s);
    s.put({ ...call, automatic: true });
  }, true);
  await markCallSent(task.call.id);
  await transaction(async (s) => {
    const call = await getRow<Call>(task.call.id, s);
    s.put({ ...call, phase: "failed", until: 0 });
    const c = await getConfig(s);
    s.put({ ...c, lease: undefined });
  }, true);
  await ready("b");
  expect(await reserveActivity("b", true)).toBeUndefined();
  expect(await reserveActivity("b", false)).toBeDefined();
});
it("removes restricted content from the persisted snapshot on friendship changes", async () => {
  await configure();
  const p = await publish("d", "d", input());
  await transaction(async (s) => {
    const c = await getConfig(s);
    await markSeen(s, c, "a", p);
    await refreshSnapshot(s, c, "a");
  }, true);
  expect((await chatMomentsContext("a")).dynamic).toContain("散步");
  await setFriend("a", "d", false);
  expect((await chatMomentsContext("a")).dynamic).not.toContain("散步");
});
it("reuses the chat request for explicit browsing and does not turn a mention into unseen knowledge", async () => {
  await configure();
  const p = await publish("d", "d", input());
  const mention = {
    id: 1,
    charId: "a",
    role: "user",
    type: "text",
    content: "d今天发朋友圈了吗",
    timestamp: Date.now(),
  } as Message;
  await prepareMomentsQuery("a", [mention]);
  expect(await getRow(`seen:a:${p.id}`)).toBeUndefined();
  await prepareMomentsQuery("a", [
    { ...mention, id: 2, content: "你去看看d的朋友圈" },
  ]);
  expect(await getRow(`seen:a:${p.id}`)).toBeDefined();
  expect((await chatMomentsContext("a", 2)).dynamic).toContain("午后散步");
  expect((await chatMomentsContext("a", 3)).dynamic).not.toContain(
    "本轮朋友圈查看结果",
  );
});
it("writes one idempotent important event with text readable by chat and both memory formatters", async () => {
  await configure();
  const p = await publish("user", "user", input());
  await transaction(async (s, tx) => {
    const c = await getConfig(s);
    await addCard(s, tx, c, "a", p, "用户分享散步的经历", "event");
    await addCard(s, tx, c, "a", p, "重复", "event");
  }, true);
  const messages = await DB.getRecentMessagesByCharId("a", 10);
  expect(messages).toHaveLength(1);
  const m = messages[0];
  expect(isMessageSemanticallyRelevant(m)).toBe(true);
  expect(formatMessageForPrompt(m, "a", "user")).toContain("用户分享散步");
  expect(formatMessageWithTime(m, "a", "user", () => "12:00")).toContain(
    "午后散步",
  );
  expect(
    ChatPrompts.buildMessageHistory(
      messages,
      10,
      char("a"),
      { name: "user" } as any,
      [],
    ).apiMessages[0].content,
  ).toContain("午后散步");
});
it("keeps real bytes out of the record and preserves relationships, seen state and budgets on backup", async () => {
  await configure();
  const p = await publish("user", "user", input());
  await transaction(async (s) => {
    const c = await getConfig(s);
    await markSeen(s, c, "a", p);
    await refreshSnapshot(s, c, "a");
  }, true);
  const db = await openDB(),
    backup = await exportMoments(db);
  validateMomentsBackup(backup);
  await saveConfig((c) => {
    c.enabled = false;
  });
  await restoreMoments(db, backup);
  expect((await getConfig()).enabled).toBe(true);
  expect(await getRow(`seen:a:${p.id}`)).toBeDefined();
  const files: Record<string, any> = {};
  const manifest = await streamMoments(db, {
    file: (name: string, data: any) => {
      files[name] = data;
    },
  } as any);
  expect(manifest.momentsRecords.count).toBe(backup.length);
  expect(Object.keys(files).some((x) => x.includes("momentsRecords"))).toBe(
    true,
  );
});
it("rejects corrupt backup data before replacing current records", async () => {
  await configure();
  const p = await publish("user", "user", input());
  const db = await openDB(),
    backup = await exportMoments(db);
  const broken = backup.map((x) =>
    x.kind === "post" ? { ...x, visibility: { mode: "everyone", ids: [] } } : x,
  );
  await expect(restoreMoments(db, broken as any)).rejects.toThrow();
  expect(await getRow(p.id)).toBeDefined();
});
it("uses a high polite response tendency independent from publishing level", () => {
  const h = habitDefaults("quiet", "active", "normal");
  expect(h.postsPerWeek).toBeLessThan(1);
  expect(h.browsesPerDay).toBe(3);
  expect(h.replyChance).toBe(0.95);
  expect(h.likeChance).toBe(0.55);
  expect(h.commentChance).toBe(0.28);
});
it("detects cross-midnight quiet hours and draws each nightly exception only once", () => {
  const h = {
      ...habitDefaults(),
      quietStart: 23,
      quietEnd: 7,
      lateNightChance: 0.03,
      lateChatChance: 0.35,
    },
    state: Activity = {
      id: "activity:a",
      kind: "activity",
      owner: "a",
      at: 0,
      nextAt: 0,
      postDue: 0,
      lastPost: 0,
    };
  const rng = vi.fn(() => 0.5),
    one = new Date(2026, 10, 2, 23, 30),
    two = new Date(2026, 10, 3, 2, 0);
  expect(inQuietHours(h, 23)).toBe(true);
  expect(inQuietHours(h, 12)).toBe(false);
  expect(quietNightKey(h, one)).toBe(quietNightKey(h, two));
  expect(sleepOpportunity(h, state, one, one.getTime(), false, rng)).toBe(
    false,
  );
  expect(sleepOpportunity(h, state, two, two.getTime(), false, rng)).toBe(
    false,
  );
  expect(rng).toHaveBeenCalledTimes(1);
  expect(sleepOpportunity(h, state, two, two.getTime(), true, () => 0.1)).toBe(
    true,
  );
  state.exceptionNight = quietNightKey(h, two);
  expect(sleepOpportunity(h, state, two, two.getTime(), true, () => 0)).toBe(
    false,
  );
});
it("schedules the next opportunity from now, without replaying offline intervals", () => {
  const p = {
    ...participantDefaults(),
    enabled: true,
    habits: habitDefaults("normal", "active"),
  };
  expect(nextOpportunity(p, 100000, () => 0.5)).toBe(100000 + 8 * 3600000);
});

it("paginates posts with identical timestamps without losing or duplicating any", async () => {
  await configure();
  vi.spyOn(Date, "now").mockReturnValue(1793635200000);
  for (let i = 0; i < 65; i++)
    await publish(
      "user",
      "user",
      input("同一时刻" + i, ""),
      "same-" + String(i).padStart(3, "0"),
    );
  const first = await feedPage(),
    second = await feedPage("user", first.cursor);
  expect(first.posts).toHaveLength(60);
  expect(second.posts).toHaveLength(5);
  expect(new Set([...first.posts, ...second.posts].map((p) => p.id)).size).toBe(
    65,
  );
});
