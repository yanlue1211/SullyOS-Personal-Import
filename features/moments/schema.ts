/** Private social data. Never shares the public friend_feed_v1 migration. */
export const MOMENTS_STORE = "moments_records";
export const MOMENTS_CHANGED = "moments-changed";
export const MOMENTS_HISTORY = "moments-history-updated";
export type Level = "active" | "normal" | "quiet";
export interface Habits {
  posting: Level;
  browsing: Level;
  interaction: Level;
  postsPerWeek: number;
  browsesPerDay: number;
  likeChance: number;
  commentChance: number;
  replyChance: number;
  hours: number[];
  quietStart: number;
  quietEnd: number;
  lateNightChance: number;
  lateChatChance: number;
  preferences: string;
  reason: string;
}
export const habitDefaults = (
  posting: Level = "normal",
  browsing: Level = "normal",
  interaction: Level = "normal",
): Habits => ({
  posting,
  browsing,
  interaction,
  postsPerWeek: { active: 6, normal: 2.5, quiet: 0.7 }[posting],
  browsesPerDay: { active: 3, normal: 2, quiet: 1 }[browsing],
  likeChance: { active: 0.75, normal: 0.55, quiet: 0.3 }[interaction],
  commentChance: { active: 0.45, normal: 0.28, quiet: 0.15 }[interaction],
  replyChance: { active: 0.98, normal: 0.95, quiet: 0.9 }[interaction],
  hours: [8, 12, 18, 21],
  quietStart: 0,
  quietEnd: 8,
  lateNightChance: 0.03,
  lateChatChance: 0.35,
  preferences: "",
  reason: "",
});
export interface Participant {
  enabled: boolean;
  post: boolean;
  browse: boolean;
  like: boolean;
  comment: boolean;
  reply: boolean;
  habits: Habits;
  assessed?: boolean;
}
export const participantDefaults = (): Participant => ({
  enabled: false,
  post: true,
  browse: true,
  like: true,
  comment: true,
  reply: true,
  habits: habitDefaults(),
});
export interface Config {
  id: "config";
  kind: "config";
  owner: "";
  at: number;
  revision: number;
  enabled: boolean;
  participants: Record<string, Participant>;
  friends: [string, string][];
  covers: Record<string, string>;
  target: number;
  limit: number;
  lease?: { id: string; until: number };
}
export const emptyConfig = (): Config => ({
  id: "config",
  kind: "config",
  owner: "",
  at: 0,
  revision: 0,
  enabled: false,
  participants: {},
  friends: [],
  covers: {},
  target: 21,
  limit: 30,
});
export type Visibility = {
  mode: "all" | "include" | "exclude" | "self";
  ids: string[];
};
export interface Media {
  kind: "image" | "video";
  virtual: boolean;
  description: string;
  ref?: string;
  frames?: { image: string; timeSeconds: number }[];
  name?: string;
}
export interface Comment {
  id: string;
  authorId: string;
  name: string;
  text: string;
  at: number;
  replyTo?: string;
}
export interface Post {
  deletedAt?: number;
  editedAt?: number;
  id: string;
  kind: "post";
  owner: string;
  at: number;
  name: string;
  text: string;
  theme: string;
  visibility: Visibility;
  media: Media[];
  likes: { authorId: string; name: string }[];
  comments: Comment[];
  revision: number;
}
export interface Seen {
  id: string;
  kind: "seen";
  owner: string;
  at: number;
  postId: string;
  projection: Post;
  reaction: string;
}
export interface FeedEvent {
  id: string;
  kind: "event";
  owner: string;
  at: number;
  postId: string;
  status: "pending" | "done";
  eventType: "post" | "comment" | "like";
  interactionId?: string;
}
export interface Snapshot {
  id: string;
  kind: "snapshot";
  owner: string;
  at: number;
  text: string;
  revision: number;
  expires: number;
}
export interface Activity {
  id: string;
  kind: "activity";
  owner: string;
  at: number;
  nextAt: number;
  postDue: number;
  lastPost: number;
  quietNight?: string;
  quietAllowed?: boolean;
  lateChatNight?: string;
  lateChatAllowed?: boolean;
  exceptionNight?: string;
}
export interface Call {
  id: string;
  kind: "call";
  owner: string;
  at: number;
  day: string;
  automatic: boolean;
  phase: "reserved" | "sent" | "success" | "failed";
  revision: number;
  until: number;
  error?: string;
}
export interface Log {
  id: string;
  kind: "log";
  owner: string;
  at: number;
  text: string;
}
/** Legacy backup compatibility only. Never created or injected into model context. */
export interface Correction { id:string; kind:"correction"; owner:string; at:number; postId:string; text:string }
export type Row =
  | Correction
  | Config
  | Post
  | Seen
  | FeedEvent
  | Snapshot
  | Activity
  | Call
  | Log;
export function createMomentsStore(db: IDBDatabase, tx: IDBTransaction) {
  const store = db.objectStoreNames.contains(MOMENTS_STORE)
    ? tx.objectStore(MOMENTS_STORE)
    : db.createObjectStore(MOMENTS_STORE, { keyPath: "id" });
  for (const [name, path] of Object.entries({
    kind_at: ["kind", "at"],
    kind_owner_at: ["kind", "owner", "at"],
    pending: ["owner", "status", "at"],
    day: ["kind", "day"],
  }))
    if (!store.indexNames.contains(name)) store.createIndex(name, path);
}
export const result = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export const completed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || Error("朋友圈事务已取消"));
    tx.onerror = () => reject(tx.error || Error("朋友圈保存失败"));
  });
export const uid = (): string => crypto.randomUUID();
export function validHabits(h: any): h is Habits {
  return (
    !!h &&
    ["posting", "browsing", "interaction"].every((k) =>
      ["active", "normal", "quiet"].includes(h[k]),
    ) &&
    Number.isFinite(h.postsPerWeek) &&
    h.postsPerWeek >= 0 &&
    h.postsPerWeek <= 14 &&
    Number.isFinite(h.browsesPerDay) &&
    h.browsesPerDay >= 0 &&
    h.browsesPerDay <= 8 &&
    ["likeChance", "commentChance", "replyChance"].every(
      (k) => Number.isFinite(h[k]) && h[k] >= 0 && h[k] <= 1,
    ) &&
    ["quietStart", "quietEnd"].every(
      (k) => Number.isInteger(h[k]) && h[k] >= 0 && h[k] < 24,
    ) &&
    ["lateNightChance", "lateChatChance"].every(
      (k) => Number.isFinite(h[k]) && h[k] >= 0 && h[k] <= 1,
    ) &&
    Array.isArray(h.hours) &&
    h.hours.length > 0 &&
    h.hours.length <= 24 &&
    h.hours.every((n: any) => Number.isInteger(n) && n >= 0 && n < 24) &&
    typeof h.preferences === "string" &&
    h.preferences.length <= 1500 &&
    typeof h.reason === "string" &&
    h.reason.length <= 1500
  );
}
export function validMedia(media: any): media is Media[] {
  return (
    Array.isArray(media) &&
    media.length <= 9 &&
    (!media.some((m) => m.kind === "video") || media.length === 1) &&
    media.every(
      (m) =>
        m &&
        ["image", "video"].includes(m.kind) &&
        typeof m.virtual === "boolean" &&
        typeof m.description === "string" &&
        m.description.length <= 8000 &&
        (m.virtual
          ? !!m.description.trim() && !m.ref && !m.frames
          : typeof m.ref === "string" &&
            m.ref.startsWith("blobref:") &&
            Array.isArray(m.frames) &&
            m.frames.length > 0 &&
            m.frames.length <= 6 &&
            m.frames.every(
              (f: any) =>
                typeof f.image === "string" &&
                f.image.startsWith("blobref:") &&
                Number.isFinite(f.timeSeconds) &&
                f.timeSeconds >= 0,
            )),
    )
  );
}
