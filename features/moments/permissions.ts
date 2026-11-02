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
    if (x.deletedAt || !visible.has(x.id) || path.has(x.id)) return false;
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

/** Previously witnessed ordinary-deleted material remains known, still subject to current friendship/privacy. */
export function projectSeenPost(c:Config,viewer:string,current:Post,known:Post):Post|undefined{
 const scope=projectPost(c,viewer,{...current,deletedAt:undefined,comments:current.comments.map(({deletedAt,...x})=>x)});if(!scope)return;
 const allowed=new Set(scope.comments.map(x=>x.id));
 return {...known,comments:known.comments.filter(x=>allowed.has(x.id)),likes:known.likes.filter(x=>viewer===current.owner||viewer===x.authorId||areFriends(c,viewer,x.authorId))};
}
export function activeComments(p:Post){const hidden=new Set(p.comments.filter(x=>x.deletedAt).map(x=>x.id));let changed=true;while(changed){changed=false;for(const x of p.comments)if(x.replyTo&&hidden.has(x.replyTo)&&!hidden.has(x.id)){hidden.add(x.id);changed=true;}}return p.comments.filter(x=>!hidden.has(x.id));}
