import { expect, it } from "vitest";
import { habitDefaults, type Post } from "../features/moments/schema";
import {
  momentsEngagement, momentsCommentDepth, momentsAutoBudgetAllows,
  momentsUserAddressedActor,
  MAX_MOMENTS_AUTO_COMMENTS, MAX_MOMENTS_USER_REPLY_RESERVE,
} from "../features/moments/engagement";

const habits = habitDefaults();
const post = (id = "moment", owner = "owner"): Post => ({
  id, kind: "post", owner, name: owner, at: 1, text: "日常", theme: "",
  visibility: { mode: "all", ids: [] }, media: [], likes: [], comments: [], revision: 0,
});
const add = (p: Post, id: string, authorId: string, replyTo?: string, text = "聊一句") => {
  p.comments.push({ id, authorId, name: authorId, text, at: p.comments.length + 2,
    ...(replyTo ? { replyTo } : {}) });
};

it("restores freedom: every first-time viewer can decide to comment, even a quiet one", () => {
  const p = post("nine", "user");
  const veryQuiet = { ...habits, commentChance: 0, joinChance: 0, replyChance: 0 };
  for (let i = 0; i < 9; i++) {
    const id = "friend-" + i;
    expect(momentsEngagement(p, id, veryQuiet, true, []).allowRoot).toBe(true);
    add(p, "root-" + i, id);
  }
  expect(p.comments).toHaveLength(9);
  expect(momentsEngagement(p, "friend-0", habits, true, []).allowRoot).toBe(false);
  expect(momentsEngagement(p, "friend-new", habits, false, []).allowRoot).toBe(false);
});

it("does not silence a relevant new comment, even if it does not name the singer", () => {
  const p = post("song-post", "user");
  add(p, "song", "user", undefined, "《穿帮》好好听！");
  const interest = momentsEngagement(p, "ma", { ...habits, joinChance: 0 }, false, ["song"]);
  expect(interest.replyableCommentIds).toEqual(["song"]);
  // The model knows if this is its own song; code only gates visibility,
  // not semantic interest. Reopening cannot reroll already-seen comments.
  expect(momentsEngagement(p, "ma", habits, false, []).replyableCommentIds).toEqual([]);
  expect(momentsEngagement(p, "ma", habits, false, ["song"]).replyableCommentIds).toEqual(["song"]);
});

it("prevents one actor continually echoing the same person in the same root thread", () => {
  const p = post();
  add(p, "root", "b");
  add(p, "a-first", "owner", "root");
  add(p, "c-first", "c", "root");
  add(p, "a-second", "owner", "c-first");
  add(p, "c-second", "c", "root");
  expect(momentsAutoBudgetAllows(p, "owner", "c-second")).toBe(false);
  expect(momentsEngagement(p, "owner", habits, false, ["c-second"]).replyableCommentIds).toEqual([]);
});

it("blocks deep automatic chains but still allows another new root topic", () => {
  const p = post();
  add(p, "b-root", "b");
  add(p, "a-one", "owner", "b-root");
  add(p, "b-two", "b", "a-one");
  add(p, "a-three", "owner", "b-two");
  add(p, "b-four", "b", "a-three");
  add(p, "fresh-root", "c");
  expect(momentsCommentDepth(p, "a-three")).toBe(3);
  expect(momentsAutoBudgetAllows(p, "owner", "a-three")).toBe(false);
  expect(momentsEngagement(p, "owner", habits, false, ["b-four", "fresh-root"]).replyableCommentIds).toEqual(["fresh-root"]);
});

it("stops ordinary automatic comments at 16 but reserves four user-addressed replies", () => {
  const p = post("priority", "owner");
  for (let i = 0; i < MAX_MOMENTS_AUTO_COMMENTS; i++)
    add(p, "auto-" + i, "other-" + i);
  expect(momentsEngagement(p, "other-new", habits, true, []).allowRoot).toBe(false);
  add(p, "me-0", "user");
  expect(momentsUserAddressedActor(p, "owner", "me-0")).toBe(true);
  expect(momentsAutoBudgetAllows(p, "owner", "me-0")).toBe(true);
  for (let i = 0; i < MAX_MOMENTS_USER_REPLY_RESERVE; i++) {
    const id = "me-" + i;
    if (i) add(p, id, "user");
    expect(momentsAutoBudgetAllows(p, "owner", id)).toBe(true);
    add(p, "owner-reply-" + i, "owner", id);
  }
  add(p, "me-last", "user");
  expect(momentsAutoBudgetAllows(p, "owner", "me-last")).toBe(false);
  expect(momentsAutoBudgetAllows(p, "other-new", "me-last")).toBe(false);
  // Manual comments remain unrestricted by automated quotas.
  add(p, "my-last-comment", "user");
  expect(p.comments.at(-1)?.authorId).toBe("user");
});
