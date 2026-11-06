import type { Comment, Post } from "./schema";
export const MAX_THREAD_REPLIES = 6;
export function rootComment(p: Post, id: string): Comment | undefined {
  let row = p.comments.find((c) => c.id === id);
  const seen = new Set<string>();
  while (row?.replyTo) {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    row = p.comments.find((c) => c.id === row!.replyTo);
  }
  return row;
}
export function threadReplies(p: Post, id: string): number {
  const root = rootComment(p, id);
  return root
    ? p.comments.filter(
        (c) => c.id !== root.id && rootComment(p, c.id)?.id === root.id,
      ).length
    : MAX_THREAD_REPLIES;
}
export function mayReply(p: Post, id: string): boolean {
  return threadReplies(p, id) < MAX_THREAD_REPLIES;
}
export function threadGuide(p: Post, id: string): string {
  const count = threadReplies(p, id);
  return count >= MAX_THREAD_REPLIES
    ? "本话题已自然结束，不再回复。"
    : count >= 3
      ? "本话题已有多轮交流，本次简短回应并自然收束，不再提出新问题或引入新话题。"
      : "可据关系与内容自然接话；第三位好友也可以回复当前可见的评论。";
}
