import type { Config, Post, Comment } from "./schema";
export function areFriends(c: Config, a: string, b: string): boolean {
  if (a === b) return true;
  if (a === "user" || b === "user")
    return c.participants[a === "user" ? b : a]?.enabled === true;
  return (
    c.participants[a]?.enabled === true &&
    c.participants[b]?.enabled === true &&
    c.friends.some((pair) => pair.includes(a) && pair.includes(b))
  );
}
export function canRead(c: Config, viewer: string, p: Post): boolean {
  if (p.deletedAt) return false;
  if (!c.enabled || (viewer !== "user" && !c.participants[viewer]?.enabled))
    return false;
  if (viewer === p.owner) return true;
  if (!areFriends(c, viewer, p.owner)) return false;
  return (
    p.visibility.mode === "all" ||
    (p.visibility.mode === "include" && p.visibility.ids.includes(viewer)) ||
    (p.visibility.mode === "exclude" && !p.visibility.ids.includes(viewer))
  );
}
export function projectPost(
  c: Config,
  viewer: string,
  p: Post,
): Post | undefined {
  if (!canRead(c, viewer, p)) return;
  const allowed = (id: string) =>
    viewer === p.owner || viewer === id || areFriends(c, viewer, id);
  const visible = new Set(
    p.comments.filter((x) => allowed(x.authorId)).map((x) => x.id),
  );
  // A reply cannot expose the name, quote or existence of a hidden parent.
  const memo = new Map<string, boolean>();
  const show = (x: Comment, path = new Set<string>()): boolean => {
    if (!visible.has(x.id) || path.has(x.id)) return false;
    if (memo.has(x.id)) return memo.get(x.id)!;
    const parent = x.replyTo && p.comments.find((y) => y.id === x.replyTo);
    const yes =
      !x.replyTo || (!!parent && show(parent, new Set([...path, x.id])));
    memo.set(x.id, yes);
    return yes;
  };
  return {
    ...p,
    visibility: { mode: "all", ids: [] },
    likes: p.likes.filter((x) => allowed(x.authorId)),
    comments: p.comments.filter((x) => show(x)),
  };
}
export const postText = (p: Post) =>
  `${p.name}：${p.text}${p.media.map((m) => `\n[${m.kind === "video" ? "视频" : "图片"}] ${m.description || "尚未识别画面"}`).join("")}`;
