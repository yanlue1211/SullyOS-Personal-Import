import { beforeEach, it, expect } from "vitest";
import { DB } from "./db";
import {
  ensurePublicFriendFeed,
  readFriendFeed,
  saveFriendFeedSettings,
  savePublicFigureSettings,
  mutateFriendFeed,
  commentOnFriendPost,
} from "./friendFeed";
import { defaultFriendFeedSettings } from "./friendFeedSettings";
import { friendAccountRef } from "./friendFeedGraph";
import {
  publicFigureMayInteract,
  publicFigureActionAllowed,
} from "./friendFeedPublicFigure";
import {
  prepareFriendFeedEmotionTask,
  landFriendFeedEmotionAction,
} from "./friendFeedEmotion";
const chars = [
  { id: "star", name: "演员" },
  { id: "peer", name: "同行" },
  { id: "fan", name: "观众" },
].map((c) => ({ ...c, memories: [], mountedWorldbooks: [] }) as any);
beforeEach(async () => {
  await DB.deleteDB();
  localStorage.clear();
  for (const c of chars) await DB.saveCharacter(c);
  await DB.saveUserProfile({ name: "用户" } as any);
  await ensurePublicFriendFeed();
});
async function configure() {
  const feed = await readFriendFeed(),
    peer = friendAccountRef(feed, { authorId: "peer" })!;
  await savePublicFigureSettings({ star: true }, { [peer.id]: true });
  await mutateFriendFeed((f) => {
    f.accountGraph!.known.star = { [peer.id]: true };
    f.posts.push(
      {
        id: "user-post",
        circleId: "public",
        authorId: "user",
        authorName: "user",
        text: "我的生活",
        createdAt: Date.now(),
        audienceIds: chars.map((x) => x.id),
        comments: [],
      },
      {
        id: "peer-post",
        circleId: "public",
        authorId: "peer",
        authorName: "同行",
        text: "新作品上线",
        createdAt: Date.now(),
        audienceIds: chars.map((x) => x.id),
        comments: [
          {
            id: "fan-comment",
            authorId: "fan",
            authorName: "观众",
            text: "期待",
            createdAt: Date.now(),
          },
        ],
      },
    );
  });
  return peer;
}
it("requires both known identity and explicit public-peer permission, never user", async () => {
  const peer = await configure();
  let f = await readFriendFeed();
  expect(publicFigureMayInteract(f, "star", { authorId: "peer" })).toBe(true);
  expect(publicFigureMayInteract(f, "star", { authorId: "user" })).toBe(false);
  expect(publicFigureMayInteract(f, "star", { authorId: "fan" })).toBe(false);
  await mutateFriendFeed((f) => {
    f.accountGraph!.known.star[peer.id] = false;
  });
  f = await readFriendFeed();
  expect(publicFigureMayInteract(f, "star", peer.id)).toBe(false);
});
it("blocks reply targets independently of a permitted post author and checks attached follows", async () => {
  await configure();
  const f = await readFriendFeed(),
    fan = friendAccountRef(f, { authorId: "fan" })!;
  expect(
    publicFigureActionAllowed(f, "star", {
      kind: "comment",
      postId: "peer-post",
      replyToCommentId: "fan-comment",
    }),
  ).toBe(false);
  expect(
    publicFigureActionAllowed(f, "star", {
      kind: "post",
      followAuthorId: fan.id,
    }),
  ).toBe(false);
  expect(
    publicFigureActionAllowed(f, "star", {
      kind: "comment",
      postId: "peer-post",
    }),
  ).toBe(true);
});
it("rejects a disallowed actual generated comment in the shared landing transaction", async () => {
  await configure();
  const task = await prepareFriendFeedEmotionTask("star", () => 0);
  expect(task).toBeDefined();
  expect(
    await landFriendFeedEmotionAction("star", {
      requestId: task!.id,
      kind: "comment",
      postId: "user-post",
      comment: "公开回应私人用户",
    }),
  ).toBe(false);
  expect(
    (await readFriendFeed()).posts.find((p) => p.id === "user-post")?.comments,
  ).toEqual([]);
});
it("keeps non-public accounts on existing behavior and preserves mode in parsing", async () => {
  await configure();
  const f = await readFriendFeed();
  expect(publicFigureMayInteract(f, "peer", { authorId: "user" })).toBe(true);
  expect(f.settings?.publicFigures.star).toBe(true);
});
it("mode changes invalidate outstanding replies", async () => {
  const task = (await prepareFriendFeedEmotionTask("star", () => 0))!;
  await configure();
  expect(
    await landFriendFeedEmotionAction("star", {
      requestId: task.id,
      kind: "post",
      text: "旧任务",
    }),
  ).toBe(false);
});

it("appearance drafts do not erase newer public-figure settings", async () => {
  const stale = defaultFriendFeedSettings();
  await configure();
  await saveFriendFeedSettings({ ...stale, fontSize: 18 });
  expect((await readFriendFeed()).settings?.publicFigures.star).toBe(true);
});

it("blocks implicit immediate replies to user comments on the public figure own post", async () => {
  await configure();
  const f = await readFriendFeed();
  await saveFriendFeedSettings({
    ...f.settings!,
    characterWeights: { star: 10, peer: 0, fan: 0 },
    npcEnabled: false,
  });
  await mutateFriendFeed((f) => {
    f.posts.push({
      id: "star-post",
      circleId: "public",
      authorId: "star",
      authorName: "演员",
      text: "公开作品信息",
      createdAt: Date.now(),
      audienceIds: chars.map((c) => c.id),
      comments: [],
    });
  });
  await commentOnFriendPost(
    "star-post",
    "用户",
    "你好",
    "user-trigger",
    () => 0,
  );
  const job = (await readFriendFeed()).replyJobs!.find(
    (j) => j.charId === "star",
  )!;
  expect(job).toBeDefined();
  const task = (await prepareFriendFeedEmotionTask(
    "star",
    () => 0,
    job.id,
    "immediate",
  ))!;
  expect(task).toBeDefined();
  expect(
    await landFriendFeedEmotionAction(
      "star",
      {
        requestId: task.id,
        kind: "comment",
        postId: "star-post",
        comment: "谢谢你的支持",
      },
      "immediate",
    ),
  ).toBe(false);
  expect(
    (await readFriendFeed()).posts.find((p) => p.id === "star-post")!.comments,
  ).toHaveLength(1);
});
