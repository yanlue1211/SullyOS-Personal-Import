import type { FriendFeedState } from "./friendFeed";
import { friendAccountRef } from "./friendFeedGraph";
import { resolveFriendFeedSettings } from "./friendFeedSettings";
export const PUBLIC_FIGURE_RULES = `【公开平台与公众人物行为规范】
你正在使用公开社交平台「哔哔」。公众人物账号按职业环境和公开社交边界行动：可以发布工作、作品宣传、公开行程和适合公开的生活，也可以浏览公开内容、了解粉丝讨论。
主动互动仅面向身份已确认且用户明确允许公开互动的公众人物好友/同行账号。普通粉丝、未知身份账号不属于该范围；不得主动点赞、评论、回复、关注或私信他们。不得在哔哔主动与user公开互动，也不得公开双方私人关系、私聊或私人朋友圈内容。本人已知道对方身份不等于对方属于允许公开互动的同行。以上规则仅用于哔哔，私人朋友圈按独立好友和可见权限运行。`;
export function publicFigureMayInteract(
  feed: FriendFeedState,
  actorId: string,
  target: { authorId: string; accountId?: string } | string,
): boolean {
  const settings = resolveFriendFeedSettings(feed.settings);
  if (!settings.publicFigures[actorId]) return true;
  const ref =
    typeof target === "string"
      ? feed.accountGraph?.accounts.find((a) => a.id === target)
      : friendAccountRef(feed, target);
  if (!ref || ref.ownerId === "user") return false;
  if (ref.ownerId === actorId) return true;
  return (
    settings.publicPeers[ref.id] === true &&
    feed.accountGraph?.known[actorId]?.[ref.id] === true
  );
}
export function publicFigureActionAllowed(
  feed: FriendFeedState,
  actorId: string,
  row: Record<string, any>,
): boolean {
  if (!resolveFriendFeedSettings(feed.settings).publicFigures[actorId])
    return true;
  const post =
    typeof row.postId === "string"
      ? feed.posts.find((p) => p.id === row.postId)
      : undefined;
  if (["comment", "repost", "like"].includes(row.kind)) {
    if (!post || !publicFigureMayInteract(feed, actorId, post)) return false;
    if (row.replyToSourceCommentId !== undefined) return false; // external commenters have no verified local identity
    if (row.replyToCommentId) {
      const target = post.comments.find((c) => c.id === row.replyToCommentId);
      if (!target || !publicFigureMayInteract(feed, actorId, target))
        return false;
    }
  }
  const follow =
    row.kind === "follow"
      ? row.authorId
      : row.follow === false
        ? undefined
        : row.followAuthorId;
  if (follow !== undefined && !publicFigureMayInteract(feed, actorId, follow))
    return false;
  return true;
}
