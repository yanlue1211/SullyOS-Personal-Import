import type { Post } from "./schema";
import { mayReply, rootComment } from "./threads";

/** These bounds apply only to characters' automatic activity, not user actions. */
export const MAX_MOMENTS_AUTO_COMMENTS = 16;
export const MAX_MOMENTS_USER_REPLY_RESERVE = 4;
export const MAX_MOMENTS_REPLY_DEPTH = 3;
export const MAX_MOMENTS_REPLIES_PER_ACTOR_THREAD = 2;
/** Unprompted social chatter: at most two follow-ups to other characters' replies
 * across one post. Initial comments stay unlimited by participant count. */
export const MAX_MOMENTS_AUTO_FOLLOWUPS_PER_POST = 2;
export const MAX_MOMENTS_AUTO_REPLIES_PER_ROOT = 2;

export interface MomentsEngagement {
  allowRoot: boolean;
  replyableCommentIds: string[];
}

const liveComments = (post: Post) => post.comments.filter(c => !c.deletedAt);

export function momentsCommentDepth(post: Post, commentId: string): number {
  const byId = new Map(liveComments(post).map(c => [c.id, c]));
  let current = byId.get(commentId);
  let depth = 0;
  const visited = new Set<string>();
  while (current?.replyTo) {
    if (visited.has(current.id) || depth >= MAX_MOMENTS_REPLY_DEPTH)
      return MAX_MOMENTS_REPLY_DEPTH;
    visited.add(current.id);
    depth++;
    current = byId.get(current.replyTo);
    if (!current) return MAX_MOMENTS_REPLY_DEPTH;
  }
  return depth;
}

/** A user explicitly commenting on the actor's own post or replying to
 * the actor's comment. Mere mentions in text do not impersonate a reply. */
export function momentsUserAddressedActor(post: Post, actorId: string, commentId: string): boolean {
  const comments = liveComments(post);
  const comment = comments.find(c => c.id === commentId);
  if (!comment || comment.authorId !== "user") return false;
  if (!comment.replyTo) return post.owner === actorId;
  return comments.some(c => c.id === comment.replyTo && c.authorId === actorId);
}

/** Leave a small, bounded reserve for explicit user interactions after the
 * ordinary 16-comment budget is exhausted. No blanket extra model round. */
export function momentsAutoBudgetAllows(post: Post, actorId: string, replyTo?: string): boolean {
  const comments = liveComments(post);
  const own = comments.filter(c => c.authorId === actorId);
  if (own.length >= (post.owner === actorId ? 10 : 3)) return false;
  const autoCount = comments.filter(c => c.authorId !== "user").length;
  if (autoCount >= MAX_MOMENTS_AUTO_COMMENTS) {
    if (!replyTo || !momentsUserAddressedActor(post, actorId, replyTo)) return false;
    let autoIndex = 0;
    let reservedReplies = 0;
    for (const comment of comments) {
      if (comment.authorId === "user") continue;
      if (autoIndex >= MAX_MOMENTS_AUTO_COMMENTS && comment.replyTo &&
          comments.some(parent => parent.id === comment.replyTo && parent.authorId === "user"))
        reservedReplies++;
      autoIndex++;
    }
    if (reservedReplies >= MAX_MOMENTS_USER_REPLY_RESERVE) return false;
  }
  if (!replyTo) {
    return actorId !== post.owner && !own.some(c => !c.replyTo);
  }
  const target = comments.find(c => c.id === replyTo);
  if (!target || target.authorId === actorId || !mayReply(post, replyTo) ||
      momentsCommentDepth(post, replyTo) >= MAX_MOMENTS_REPLY_DEPTH ||
      own.some(c => c.replyTo === replyTo)) return false;

  const root = rootComment(post, replyTo);
  if (!root) return false;
  const userAddressed = momentsUserAddressedActor(post, actorId, replyTo);

  // A creator answering B's first comment is ordinary, valuable interaction.
  // The repeated B -> A -> B acknowledgement loop is what crowds the feed:
  // keep only two automatic replies per ordinary root, and at most two
  // secondary auto follow-ups across the entire post. User-directed new
  // messages have a separate, bounded reply budget and bypass these chatter caps.
  if (!userAddressed) {
    const automaticRootReplies = comments.filter(c => c.authorId !== "user" && c.replyTo &&
      rootComment(post, c.id)?.id === root.id).length;
    if (automaticRootReplies >= MAX_MOMENTS_AUTO_REPLIES_PER_ROOT) return false;
    if (target.replyTo && target.authorId !== "user") {
      const followups = comments.filter(c => {
        if (c.authorId === "user" || !c.replyTo) return false;
        const parent = comments.find(p => p.id === c.replyTo);
        return !!(parent?.replyTo && parent.authorId !== "user");
      }).length;
      if (followups >= MAX_MOMENTS_AUTO_FOLLOWUPS_PER_POST) return false;
    }
  }
  const ownThreadReplies = own.filter(c => c.replyTo && rootComment(post, c.id)?.id === root.id);
  return ownThreadReplies.length < MAX_MOMENTS_REPLIES_PER_ACTOR_THREAD;
}

/** This is an opportunity/safety filter, NOT a probability lottery.
 * A character that really cares about a song or another person's comment
 * can choose to join after seeing it; the model still may remain silent.
 * First views create one root-comment opportunity; later views can address
 * only newly visible comments, never replay already-seen conversations. */
export function momentsEngagement(
  post: Post, actorId: string, _habits: unknown, firstView: boolean, newIds: string[],
): MomentsEngagement {
  return {
    allowRoot: firstView && momentsAutoBudgetAllows(post, actorId),
    replyableCommentIds: [...new Set(newIds)].filter(id => momentsAutoBudgetAllows(post, actorId, id)),
  };
}
