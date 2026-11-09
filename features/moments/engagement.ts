import type { Habits, Post } from "./schema";
import { effectiveJoinChance } from "./schema";

export const MAX_MOMENTS_AUTO_COMMENTS = 16;
export const MAX_MOMENTS_REPLY_DEPTH = 3;

export interface MomentsEngagement {
  allowRoot: boolean;
  replyableCommentIds: string[];
}

/** A single, stable opportunity per person + post / new comment.
 * Never reroll because the page was reopened or another character posted.
 * No extra API call or persistent RNG state is needed. */
export function momentsOpportunityRoll(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // FNV alone clusters sequential names/IDs; avalanche before using as a chance.
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

export function momentsCommentDepth(post: Post, commentId: string): number {
  const byId = new Map(post.comments.filter(c => !c.deletedAt).map(c => [c.id, c]));
  let current = byId.get(commentId);
  let depth = 0;
  const visited = new Set<string>();
  while (current?.replyTo) {
    if (visited.has(current.id) || depth >= MAX_MOMENTS_REPLY_DEPTH) return MAX_MOMENTS_REPLY_DEPTH;
    visited.add(current.id);
    depth++;
    current = byId.get(current.replyTo);
    if (!current) return MAX_MOMENTS_REPLY_DEPTH;
  }
  return depth;
}

/** Private Moments only: all probabilities are eligibility gates, not obligations.
 * Character personalities still decide WHAT to say or whether to stay silent.
 * User-authored comments are not constrained by the automatic activity budget. */
export function momentsEngagement(
  post: Post, actorId: string, habits: Habits, firstView: boolean, newIds: string[],
): MomentsEngagement {
  const active = post.comments.filter(c => !c.deletedAt);
  const own = active.filter(c => c.authorId === actorId);
  const autoCount = active.filter(c => c.authorId !== "user").length;
  if (autoCount >= MAX_MOMENTS_AUTO_COMMENTS ||
      own.length >= (actorId === post.owner ? 10 : 3)) {
    return {allowRoot: false, replyableCommentIds: []};
  }

  // Do not cap distinct commenters: even nine friends may comment when their own chances allow it.
  const allowRoot = firstView && actorId !== post.owner &&
      !active.some(c => c.authorId === actorId && !c.replyTo) &&
      momentsOpportunityRoll(`root|${post.id}|${actorId}`) < habits.commentChance;

  const byId = new Map(active.map(c => [c.id, c]));
  const replyableCommentIds: string[] = [];
  for (const id of newIds) {
    const comment = byId.get(id);
    if (!comment || comment.authorId === actorId ||
        active.some(c => c.authorId === actorId && c.replyTo === id)) continue;
    const depth = momentsCommentDepth(post, id);
    if (depth >= MAX_MOMENTS_REPLY_DEPTH) continue;

    const parent = comment.replyTo ? byId.get(comment.replyTo) : undefined;
    const addressed = parent?.authorId === actorId ||
        (!comment.replyTo && post.owner === actorId);
    let chance: number;
    // Preserve each character's stored reply habit without turning all replies into obligations.
    const affinity = Math.max(.7, Math.min(1.05, habits.replyChance / .95));
    if (addressed) {
      if (!comment.replyTo) chance = Math.min(.99, (comment.authorId === "user" ? .97 : .90) * affinity);
      else if (actorId === post.owner) chance = .12 * affinity;
      else chance = (comment.authorId === "user" ? .90 : depth === 1 ? .25 : .12) * affinity;
    } else {
      // B can answer C on A's post, but this is deliberately uncommon.
      chance = Math.min(.10, effectiveJoinChance(habits)) * (depth >= 2 ? .5 : 1);
    }
    if (momentsOpportunityRoll(`reply|${post.id}|${actorId}|${id}`) < chance)
      replyableCommentIds.push(id);
  }
  return {allowRoot, replyableCommentIds};
}
