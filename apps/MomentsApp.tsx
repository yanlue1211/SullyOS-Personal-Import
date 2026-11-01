import React, { useEffect, useRef, useState } from "react";
import { useOS } from "../context/OSContext";
import { useLocalBackHandler } from "../hooks/useLocalBackHandler";
import TokenImg from "../components/os/TokenImg";
import { useBlobRefUrl } from "../utils/blobRef";
import { putImageBlob } from "../utils/blobRef";
import { processImageToBlob } from "../utils/file";
import {
  getConfig,
  saveConfig,
  setFriend,
  feedPage,
  publish,
  interact,
  deletePost,
  deleteComment,
  rows,
} from "../features/moments/storage";
import {
  emptyConfig,
  participantDefaults,
  habitDefaults,
  MOMENTS_CHANGED,
  type Config,
  type Post,
  type Media,
  type Visibility,
  type Habits,
  type Level,
  type Log,
  type Seen,
  type Call,
} from "../features/moments/schema";
import { areFriends } from "../features/moments/permissions";
import { mayReply } from "../features/moments/threads";
import { runActivity, assessHabits } from "../features/moments/runtime";
import { prepareMomentsMedia } from "../features/moments/media";
import { getLocalDateKey } from "../utils/localDate";
import "./moments.css";
const levels: { id: Level; name: string }[] = [
  { id: "active", name: "积极" },
  { id: "normal", name: "普通" },
  { id: "quiet", name: "较少" },
];
function Avatar({ name, value }: { name: string; value?: string }) {
  return (
    <span className="mm-avatar">
      {value && /^(https?:|blobref:|data:image)/.test(value) ? (
        <TokenImg value={value} alt={name} />
      ) : (
        value || Array.from(name)[0] || "友"
      )}
    </span>
  );
}
function MediaTile({ media, onClick }: { media: Media; onClick: () => void }) {
  return (
    <button
      type="button"
      className={"mm-media " + (media.virtual ? "mm-virtual" : "")}
      onClick={onClick}
    >
      {media.virtual ? (
        <>
          <span>{media.kind === "video" ? "▷" : "▧"}</span>
          <small>{media.kind === "video" ? "一段视频" : "一张照片"}</small>
        </>
      ) : (
        <>
          <TokenImg
            value={media.frames?.[0]?.image || media.ref || ""}
            alt={media.description}
          />
          {media.kind === "video" && <span className="mm-play">▷</span>}
        </>
      )}
    </button>
  );
}
function Viewer({ media, onClose }: { media: Media; onClose: () => void }) {
  const url = useBlobRefUrl(media.ref);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  useLocalBackHandler(
    () => {
      onClose();
      return true;
    },
    60,
    true,
  );
  return (
    <dialog
      className="mm-viewer"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <button className="mm-close" onClick={onClose} aria-label="关闭媒体">
        ×
      </button>
      {!media.virtual &&
        (media.kind === "video" ? (
          <video src={url || undefined} controls playsInline />
        ) : (
          <TokenImg value={media.ref || ""} alt={media.description} />
        ))}
      <h3>
        {media.virtual
          ? media.kind === "video"
            ? "视频描述"
            : "照片描述"
          : "画面识别"}
      </h3>
      <p>{media.description}</p>
    </dialog>
  );
}
export default function MomentsApp() {
  const os = useOS(),
    [config, setConfig] = useState<Config>(emptyConfig),
    [page, setPage] = useState<
      "feed" | "settings" | "compose" | "friends" | "character" | "logs"
    >("feed");
  const [posts, setPosts] = useState<Post[]>([]),
    [cursor, setCursor] =
      useState<import("../features/moments/storage").PageCursor>(Infinity),
    [more, setMore] = useState(false),
    [owner, setOwner] = useState<string | undefined>(),
    [viewer, setViewer] = useState("user"),
    [charId, setCharId] = useState("");
  const [text, setText] = useState(""),
    [media, setMedia] = useState<Media[]>([]),
    [visibility, setVisibility] = useState<Visibility>({
      mode: "all",
      ids: [],
    }),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [menu, setMenu] = useState<string>(),
    [reply, setReply] = useState<{
      postId: string;
      id?: string;
      name?: string;
    }>(),
    [comment, setComment] = useState(""),
    [image, setImage] = useState<Media>(),
    [suggestion, setSuggestion] = useState<Habits>(),
    [logs, setLogs] = useState<Log[]>([]),
    [seen, setSeen] = useState<Seen[]>([]),
    [calls, setCalls] = useState<Call[]>([]);
  const [confirm, setConfirm] = useState<{
      text: string;
      run: () => Promise<unknown>;
    } | null>(null),
    [virtual, setVirtual] = useState<"image" | "video" | null>(null),
    [description, setDescription] = useState("");
  const [find, setFind] = useState(""),
    [friendActor, setFriendActor] = useState(""),
    [budget, setBudget] = useState({ target: 21, limit: 30 });
  const file = useRef<HTMLInputElement>(null),
    cover = useRef<HTMLInputElement>(null),
    request = useRef(crypto.randomUUID()),
    initialized = useRef(false),
    epoch = useRef(0),
    abort = useRef<AbortController>();
  const char = os.characters.find((x) => x.id === charId),
    participant = config.participants[charId] || participantDefaults();
  const name = (id: string) =>
    id === "user"
      ? os.userProfile.name
      : os.characters.find((c) => c.id === id)?.name || "已离开的好友";
  const avatar = (id: string) =>
    id === "user"
      ? os.userProfile.avatar
      : os.characters.find((c) => c.id === id)?.avatar;
  const operate = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const token = ++epoch.current;
    const c = await getConfig();
    if (token !== epoch.current) return;
    setConfig(c);
    if (!initialized.current) {
      initialized.current = true;
      if (!c.enabled) setPage("settings");
    }
    const f = await feedPage(viewer, Infinity, owner);
    if (token !== epoch.current) return;
    setPosts(f.posts);
    setCursor(f.cursor);
    setMore(f.more);
  };
  useEffect(() => {
    void refresh().catch((e) => setNotice(e.message));
    const update = () => void refresh().catch((e) => setNotice(e.message));
    window.addEventListener(MOMENTS_CHANGED, update);
    return () => {
      epoch.current++;
      window.removeEventListener(MOMENTS_CHANGED, update);
    };
  }, [viewer, owner]);
  useEffect(() => () => abort.current?.abort(), []);
  const back = () => {
    if (image) {
      setImage(undefined);
      return true;
    }
    if (confirm) {
      setConfirm(null);
      return true;
    }
    if (suggestion) {
      setSuggestion(undefined);
      return true;
    }
    if (virtual) {
      setVirtual(null);
      return true;
    }
    if (reply) {
      setReply(undefined);
      return true;
    }
    if (menu) {
      setMenu(undefined);
      return true;
    }
    if (page === "character" || page === "friends" || page === "logs") {
      setPage("settings");
      return true;
    }
    if (page !== "feed") {
      if (busy) return true;
      setPage("feed");
      return true;
    }
    if (owner) {
      setOwner(undefined);
      return true;
    }
    return false;
  };
  useLocalBackHandler(
    back,
    30,
    page !== "feed" ||
      !!owner ||
      !!image ||
      !!confirm ||
      !!suggestion ||
      !!reply ||
      !!menu ||
      !!virtual,
  );
  const updateParticipant = (
    fn: (p: ReturnType<typeof participantDefaults>) => void,
  ) =>
    operate(() =>
      saveConfig((c) => {
        const p = c.participants[charId] || participantDefaults();
        fn(p);
        c.participants[charId] = p;
      }),
    );
  const available = os.characters.filter((c) => c.name.includes(find));
  const startCompose = () => {
    setText("");
    setMedia([]);
    setVisibility({ mode: "all", ids: [] });
    request.current = crypto.randomUUID();
    setPage("compose");
  };
  const input = {
    api: os.apiConfig,
    user: os.userProfile,
    realtime: os.realtimeConfig,
  };
  const showLogs = () =>
    operate(async () => {
      setLogs(await rows<Log>("log", undefined, 100));
      setSeen(await rows<Seen>("seen", undefined, 100));
      setCalls(
        (await rows<Call>("call", undefined, 200)).filter(
          (c) => c.day === getLocalDateKey(),
        ),
      );
      setPage("logs");
    });
  return (
    <div className="moments-app">
      <header className="mm-header">
        <button
          aria-label="返回"
          onClick={() => {
            if (!back()) os.closeApp();
          }}
        >
          ‹
        </button>
        <h1>
          {page === "feed"
            ? owner
              ? name(owner) + "的朋友圈"
              : "朋友圈"
            : {
                settings: "朋友圈设置",
                compose: "分享生活",
                friends: "好友关系",
                character: char?.name || "角色设置",
                logs: "活动记录",
              }[page]}
        </h1>
        <div>
          {page === "feed" && (
            <>
              <button
                aria-label="发布朋友圈"
                disabled={!config.enabled || viewer !== "user"}
                onClick={startCompose}
              >
                ▣
              </button>
              <button
                aria-label="朋友圈设置"
                onClick={() => {
                  setBudget({ target: config.target, limit: config.limit });
                  setPage("settings");
                }}
              >
                ⚙
              </button>
            </>
          )}
        </div>
      </header>
      {notice && (
        <div className="mm-notice" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {busy && (
        <div className="mm-busy" role="status">
          正在处理…
        </div>
      )}
      <main>
        {page === "feed" &&
          (!config.enabled ? (
            <section className="mm-welcome">
              <div className="mm-flower">✿</div>
              <h2>把生活，留给熟悉的人。</h2>
              <p>在这里分享日常，与好友慢慢聊几句。</p>
              <button
                className="mm-primary"
                onClick={() => setPage("settings")}
              >
                设置朋友圈
              </button>
            </section>
          ) : (
            <>
              <section className="mm-cover">
                <button
                  className="mm-cover-image"
                  aria-label="更换朋友圈封面"
                  disabled={viewer !== "user"}
                  onClick={() => cover.current?.click()}
                >
                  {config.covers[owner || "user"] ? (
                    <TokenImg
                      value={config.covers[owner || "user"]}
                      alt="朋友圈封面"
                    />
                  ) : (
                    <div className="mm-landscape">
                      <span>日常之间</span>
                    </div>
                  )}
                </button>
                <div className="mm-cover-person">
                  <b>{name(owner || "user")}</b>
                  <button
                    aria-label="打开个人朋友圈"
                    onClick={() => setOwner(owner || "user")}
                  >
                    <Avatar
                      name={name(owner || "user")}
                      value={avatar(owner || "user")}
                    />
                  </button>
                </div>
              </section>
              {viewer !== "user" && (
                <p className="mm-hint">
                  以{name(viewer)}视角预览 · 不计为 TA 已浏览 · 只读
                </p>
              )}
              {!posts.length && (
                <p className="mm-empty">
                  这里还没有可见的动态。生活会慢慢发生。
                </p>
              )}
              {posts.map((p) => (
                <article className="mm-post" key={p.id}>
                  <button
                    className="mm-author-avatar"
                    onClick={() => setOwner(p.owner)}
                    aria-label={"查看" + p.name + "的朋友圈"}
                  >
                    <Avatar name={p.name} value={avatar(p.owner)} />
                  </button>
                  <div className="mm-post-body">
                    <button
                      className="mm-name"
                      onClick={() => setOwner(p.owner)}
                    >
                      {p.name}
                    </button>
                    {p.text && <p className="mm-body">{p.text}</p>}
                    {!!p.media.length && (
                      <div
                        className={
                          "mm-grid " + (p.media.length === 1 ? "mm-single" : "")
                        }
                      >
                        {p.media.map((m, i) => (
                          <MediaTile
                            key={i}
                            media={m}
                            onClick={() => setImage(m)}
                          />
                        ))}
                      </div>
                    )}
                    <div className="mm-meta">
                      <time>
                        {new Date(p.at).toLocaleString([], {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      {viewer === "user" && p.owner === "user" && (
                        <button
                          onClick={() =>
                            setConfirm({
                              text: "删除这条朋友圈？",
                              run: () => deletePost("user", p.id),
                            })
                          }
                        >
                          删除
                        </button>
                      )}
                      <span />
                      {viewer === "user" && (
                        <button
                          aria-label="点赞或评论"
                          onClick={() =>
                            setMenu(menu === p.id ? undefined : p.id)
                          }
                        >
                          ••
                        </button>
                      )}
                    </div>
                    {menu === p.id && (
                      <div className="mm-actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            operate(async () => {
                              await interact("user", name("user"), p.id, {
                                kind: p.likes.some((x) => x.authorId === "user")
                                  ? "unlike"
                                  : "like",
                              });
                              setMenu(undefined);
                            })
                          }
                        >
                          {p.likes.some((x) => x.authorId === "user")
                            ? "♡ 取消"
                            : "♡ 赞"}
                        </button>
                        <button
                          onClick={() => {
                            setReply({ postId: p.id });
                            setComment("");
                            setMenu(undefined);
                          }}
                        >
                          ▢ 评论
                        </button>
                      </div>
                    )}
                    {(!!p.likes.length || !!p.comments.length) && (
                      <div className="mm-interactions">
                        {!!p.likes.length && (
                          <div className="mm-likes">
                            ♡ {p.likes.map((x) => x.name).join("、")}
                          </div>
                        )}
                        {p.comments.map((c) => (
                          <div className="mm-comment" key={c.id}>
                            <button
                              disabled={viewer !== "user"}
                              onClick={() => {
                                setReply({
                                  postId: p.id,
                                  id: c.id,
                                  name: c.name,
                                });
                                setComment("");
                              }}
                            >
                              <b>{c.name}</b>
                              {c.replyTo && (
                                <>
                                  {" "}
                                  回复{" "}
                                  <b>
                                    {
                                      p.comments.find((x) => x.id === c.replyTo)
                                        ?.name
                                    }
                                  </b>
                                </>
                              )}
                              ：{c.text}
                            </button>
                            {viewer === "user" &&
                              (c.authorId === "user" || p.owner === "user") && (
                                <button
                                  className="mm-delete-comment"
                                  aria-label="删除评论"
                                  onClick={() =>
                                    setConfirm({
                                      text: "删除这条评论及其回复？",
                                      run: () =>
                                        deleteComment("user", p.id, c.id),
                                    })
                                  }
                                >
                                  ×
                                </button>
                              )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {more && (
                <button
                  className="mm-more"
                  disabled={busy}
                  onClick={() =>
                    operate(async () => {
                      const f = await feedPage(viewer, cursor, owner);
                      setPosts((old) => [
                        ...old,
                        ...f.posts.filter(
                          (p) => !old.some((x) => x.id === p.id),
                        ),
                      ]);
                      setCursor(f.cursor);
                      setMore(f.more);
                    })
                  }
                >
                  继续看更早的动态
                </button>
              )}
            </>
          ))}
        {page === "settings" && (
          <div className="mm-settings">
            <section>
              <label className="mm-setting-row">
                <span>
                  <b>开启朋友圈</b>
                  <small>私人好友空间 · 本地保存</small>
                </span>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.checked)
                      setConfirm({
                        text: "开启朋友圈？页面运行时，已启用角色可按设置自主活动并使用模型API。默认每日目标21次，上限30次。",
                        run: () =>
                          saveConfig((c) => {
                            c.enabled = true;
                          }),
                      });
                    else
                      void operate(() =>
                        saveConfig((c) => {
                          c.enabled = false;
                        }),
                      );
                  }}
                />
              </label>
            </section>
            {config.enabled && (
              <>
                <section>
                  <h2>好友与角色</h2>
                  <button
                    className="mm-setting-row"
                    onClick={() => {
                      setFriendActor(os.characters[0]?.id || "");
                      setPage("friends");
                    }}
                  >
                    <span>管理角色之间的好友关系</span>
                    <b>›</b>
                  </button>
                  <input
                    className="mm-search"
                    placeholder="搜索角色"
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                  />
                  {available.map((c) => (
                    <button
                      className="mm-setting-row"
                      key={c.id}
                      onClick={() => {
                        setCharId(c.id);
                        setSuggestion(undefined);
                        setPage("character");
                      }}
                    >
                      <span>
                        {c.name}
                        <small>
                          {config.participants[c.id]?.enabled
                            ? "已启用"
                            : "未启用"}
                        </small>
                      </span>
                      <b>›</b>
                    </button>
                  ))}
                </section>
                <section>
                  <h2>自动活动预算</h2>
                  <p className="mm-hint">
                    九人参考约21次/日。空闲时可低于目标，发帖和互动在同一轮处理。五分钟本地检查不调用模型。
                  </p>
                  <label className="mm-setting-row">
                    每日目标
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={budget.target}
                      onChange={(e) =>
                        setBudget({ ...budget, target: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="mm-setting-row">
                    每日上限
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={budget.limit}
                      onChange={(e) =>
                        setBudget({ ...budget, limit: Number(e.target.value) })
                      }
                    />
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      operate(() =>
                        saveConfig((c) => {
                          c.target = budget.target;
                          c.limit = budget.limit;
                        }),
                      )
                    }
                  >
                    保存预算
                  </button>
                </section>
                <section>
                  <button className="mm-setting-row" onClick={showLogs}>
                    <span>巡检状态与活动记录</span>
                    <b>›</b>
                  </button>
                  <label className="mm-setting-row">
                    权限视角预览
                    <select
                      value={viewer}
                      onChange={(e) => {
                        setViewer(e.target.value);
                        setOwner(undefined);
                      }}
                    >
                      <option value="user">我</option>
                      {os.characters
                        .filter((x) => config.participants[x.id]?.enabled)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="mm-hint">预览不产生浏览记录或模型请求。</p>
                </section>
              </>
            )}
          </div>
        )}
        {page === "friends" && (
          <div className="mm-settings">
            <p className="mm-hint">
              user 自动与所有已启用角色互为好友。以下关系仅用于私人朋友圈。
            </p>
            <select
              value={friendActor}
              onChange={(e) => setFriendActor(e.target.value)}
            >
              {os.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <section>
              {os.characters
                .filter((c) => c.id !== friendActor)
                .map((c) => (
                  <label className="mm-setting-row" key={c.id}>
                    <span>{c.name}</span>
                    <input
                      type="checkbox"
                      disabled={
                        busy ||
                        !config.participants[friendActor]?.enabled ||
                        !config.participants[c.id]?.enabled
                      }
                      checked={config.friends.some(
                        (pair) =>
                          pair.includes(friendActor) && pair.includes(c.id),
                      )}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        void operate(() => setFriend(friendActor, c.id, checked));
                      }}
                    />
                  </label>
                ))}
            </section>
            <p className="mm-hint">
              勾选即双向添加，不影响哔哔关注、联系人或关系网。
            </p>
          </div>
        )}
        {page === "character" && char && (
          <div className="mm-settings">
            <section>
              {(
                [
                  "enabled",
                  "post",
                  "browse",
                  "like",
                  "comment",
                  "reply",
                ] as const
              ).map((key, i) => (
                <label key={key} className="mm-setting-row">
                  <span>
                    {
                      [
                        "启用朋友圈",
                        "主动发布",
                        "主动浏览",
                        "主动点赞",
                        "主动评论",
                        "主动回复",
                      ][i]
                    }
                  </span>
                  <input
                    type="checkbox"
                    disabled={
                      busy || (key !== "enabled" && !participant.enabled)
                    }
                    checked={participant[key]}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      void updateParticipant((p) => {
                        p[key] = checked;
                      });
                    }}
                  />
                </label>
              ))}
            </section>
            {participant.enabled && (
              <>
                <section>
                  <h2>社交习惯</h2>
                  <button
                    disabled={busy}
                    onClick={() =>
                      operate(async () => {
                        abort.current = new AbortController();
                        setSuggestion(
                          await assessHabits(charId, {
                            ...input,
                            signal: abort.current.signal,
                          }),
                        );
                      })
                    }
                  >
                    由 TA 决定 ↻
                  </button>
                  <p className="mm-hint">
                    评估使用一次模型请求；展示建议，确认后应用。发布、浏览、互动分别保存。
                  </p>
                  {(["posting", "browsing", "interaction"] as const).map(
                    (key, i) => (
                      <label className="mm-setting-row" key={key}>
                        {["发布倾向", "浏览倾向", "互动倾向"][i]}
                        <select
                          value={participant.habits[key]}
                          disabled={busy}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            void updateParticipant((p) => {
                              const h = { ...p.habits, [key]: value };
                              const d = habitDefaults(
                                h.posting as Level,
                                h.browsing as Level,
                                h.interaction as Level,
                              );
                              p.habits = {
                                ...d,
                                hours: h.hours,
                                quietStart: h.quietStart,
                                quietEnd: h.quietEnd,
                                lateNightChance: h.lateNightChance,
                                lateChatChance: h.lateChatChance,
                                preferences: h.preferences,
                                reason: h.reason,
                              };
                            });
                          }}
                        >
                          {levels.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ),
                  )}
                  {(
                    [
                      "postsPerWeek",
                      "browsesPerDay",
                      "likeChance",
                      "commentChance",
                      "replyChance",
                    ] as const
                  ).map((key, i) => (
                    <label className="mm-setting-row" key={key}>
                      {
                        [
                          "平均每周发布",
                          "平均每日浏览机会",
                          "点赞倾向（0～1）",
                          "主动评论倾向（0～1）",
                          "回应倾向（0～1）",
                        ][i]
                      }
                      <input
                        type="number"
                        step={i > 1 ? 0.01 : 0.1}
                        min="0"
                        max={i === 0 ? 14 : i === 1 ? 8 : 1}
                        disabled={busy}
                        value={participant.habits[key]}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          void updateParticipant((p) => {
                            p.habits = { ...p.habits, [key]: value };
                          });
                        }}
                      />
                    </label>
                  ))}
                </section>
                <section>
                  <h2>通常不发布的休息时段</h2>
                  {(
                    [
                      "quietStart",
                      "quietEnd",
                      "lateNightChance",
                      "lateChatChance",
                    ] as const
                  ).map((key, i) => (
                    <label className="mm-setting-row" key={key}>
                      {
                        [
                          "休息开始（小时）",
                          "休息结束（小时）",
                          "每晚偶尔晚睡概率",
                          "深夜聊天后例外概率",
                        ][i]
                      }
                      <input
                        type="number"
                        min="0"
                        max={i < 2 ? 23 : 1}
                        step={i < 2 ? 1 : 0.01}
                        value={participant.habits[key]}
                        disabled={busy}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          void updateParticipant((p) => {
                            p.habits = { ...p.habits, [key]: n };
                          });
                        }}
                      />
                    </label>
                  ))}
                  <p className="mm-hint">
                    按角色时区，可跨午夜；开始与结束相同表示不设置。每晚最多一次例外，聊天后也由TA决定是否有感而发，不强制发布。
                  </p>
                  <h2>常见浏览时段</h2>
                  <div className="mm-hours">
                    {Array.from({ length: 24 }, (_, h) => (
                      <label key={h}>
                        <input
                          type="checkbox"
                          checked={participant.habits.hours.includes(h)}
                          disabled={busy}
                          onChange={(e) => {
                            const checked = e.currentTarget.checked;
                            void updateParticipant((p) => {
                              p.habits = {
                                ...p.habits,
                                hours: checked
                                  ? [...p.habits.hours, h].sort((a, b) => a - b)
                                  : p.habits.hours.filter((x) => x !== h),
                              };
                            });
                          }}
                        />
                        {h}时
                      </label>
                    ))}
                  </div>
                  <p className="mm-hint">
                    按角色所在地时间判断。至少保留一个时段。
                  </p>
                </section>
                <section>
                  <p>
                    {participant.habits.reason ||
                      "尚未评估，可手动调整或让TA决定。"}
                  </p>
                  <p>{participant.habits.preferences}</p>
                  <p className="mm-hint">
                    明确收到回复通常会礼貌回应。同一话题约4～6条回复后自然结束，最多6条；不额外调用模型补齐次数。
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      operate(async () => {
                        abort.current = new AbortController();
                        const ok = await runActivity(charId, {
                          ...input,
                          signal: abort.current.signal,
                        });
                        setNotice(
                          ok ? "这轮活动已完成" : "暂无待浏览内容或发布机会",
                        );
                      })
                    }
                  >
                    让 TA 活动一次（手动）
                  </button>
                </section>
              </>
            )}
          </div>
        )}
        {page === "compose" && (
          <div className="mm-compose">
            <textarea
              aria-label="朋友圈正文"
              value={text}
              maxLength={4000}
              onChange={(e) => setText(e.target.value)}
              placeholder="这一刻，想分享什么？"
            />
            <div className="mm-grid">
              {media.map((m, i) => (
                <div className="mm-draft-media" key={i}>
                  <MediaTile media={m} onClick={() => setImage(m)} />
                  <button
                    aria-label="移除媒体"
                    onClick={() => setMedia((v) => v.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mm-compose-tools">
              <button
                disabled={
                  busy ||
                  media.length >= 9 ||
                  media.some((m) => m.kind === "video")
                }
                onClick={() => file.current?.click()}
              >
                ＋ 图片 / 视频
              </button>
              <button
                disabled={
                  busy ||
                  media.length >= 9 ||
                  media.some((m) => m.kind === "video")
                }
                onClick={() => {
                  setVirtual("image");
                  setDescription("");
                }}
              >
                虚拟图片
              </button>
              <button
                disabled={busy || !!media.length}
                onClick={() => {
                  setVirtual("video");
                  setDescription("");
                }}
              >
                虚拟视频
              </button>
            </div>
            <p className="mm-hint">
              真实图片最多九张，或单个视频。上传后识别一次并缓存，多位好友复用；识别使用默认模型或独立识图API，属于手动请求。
            </p>
            <label className="mm-setting-row">
              谁可以看
              <select
                value={visibility.mode}
                onChange={(e) =>
                  setVisibility({
                    mode: e.target.value as Visibility["mode"],
                    ids: [],
                  })
                }
              >
                <option value="all">全部好友</option>
                <option value="include">部分好友</option>
                <option value="exclude">不给谁看</option>
                <option value="self">仅自己</option>
              </select>
            </label>
            {["include", "exclude"].includes(visibility.mode) &&
              os.characters
                .filter((c) => config.participants[c.id]?.enabled)
                .map((c) => (
                  <label className="mm-setting-row" key={c.id}>
                    {c.name}
                    <input
                      type="checkbox"
                      checked={visibility.ids.includes(c.id)}
                      onChange={(e) =>
                        setVisibility((v) => ({
                          ...v,
                          ids: e.target.checked
                            ? [...v.ids, c.id]
                            : v.ids.filter((id) => id !== c.id),
                        }))
                      }
                    />
                  </label>
                ))}
            <button
              className="mm-primary"
              disabled={busy || (!text.trim() && !media.length)}
              onClick={() =>
                operate(async () => {
                  await publish(
                    "user",
                    name("user"),
                    { text, media, visibility, theme: "" },
                    request.current,
                  );
                  setPage("feed");
                  setOwner(undefined);
                })
              }
            >
              发表
            </button>
          </div>
        )}
        {page === "logs" && (
          <div className="mm-settings">
            <section>
              <h2>巡检状态</h2>
              <p>
                {config.enabled
                  ? "已开启 · 页面可见运行时每五分钟本地检查"
                  : "已关闭"}
              </p>
              <p>
                今日自动尝试{" "}
                {
                  calls.filter((c) => c.automatic && c.phase !== "reserved")
                    .length
                }{" "}
                / 上限 {config.limit} · 参考目标 {config.target}
              </p>
              <p>
                今日手动社交请求{" "}
                {
                  calls.filter((c) => !c.automatic && c.phase !== "reserved")
                    .length
                }{" "}
                次
              </p>
              <p className="mm-hint">
                失败请求也可能产生提供方用量；媒体识别、习惯评估另见系统API日志。恢复页面不补发离线活动。
              </p>
            </section>
            <section>
              <h2>最近活动</h2>
              {logs.map((l) => (
                <p key={l.id}>
                  <small>
                    {new Date(l.at).toLocaleString()} · {name(l.owner)}
                  </small>
                  <br />
                  {l.text}
                </p>
              ))}
              {!logs.length && <p>还没有活动记录</p>}
            </section>
            <section>
              <h2>实际浏览记录</h2>
              {seen.map((x) => (
                <details key={x.id}>
                  <summary>
                    {name(x.owner)} · {new Date(x.at).toLocaleString()}
                  </summary>
                  <p>
                    {x.projection.name}：{x.projection.text}
                  </p>
                  <small>{x.postId}</small>
                </details>
              ))}
            </section>
          </div>
        )}
      </main>
      <input
        ref={file}
        type="file"
        hidden
        accept="image/*,video/*"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void operate(async () => {
            if (
              files.length + media.length > 9 ||
              (files.some((f) => f.type.startsWith("video/")) &&
                (files.length !== 1 || media.length))
            )
              throw Error("最多九张图片或一个视频");
            abort.current = new AbortController();
            const added: Media[] = [];
            for (const f of files)
              added.push(
                await prepareMomentsMedia(
                  f,
                  os.apiConfig,
                  abort.current.signal,
                ),
              );
            setMedia((old) => [...old, ...added]);
          });
        }}
      />
      <input
        ref={cover}
        type="file"
        hidden
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void operate(async () => {
            if (f.size > 10 * 1024 * 1024) throw Error("封面请小于10MB");
            const ref = await putImageBlob(
              await processImageToBlob(f, { maxWidth: 1600, quality: 0.85 }),
            );
            await saveConfig((c) => {
              c.covers[owner || "user"] = ref;
            });
          });
        }}
      />
      {reply && (
        <div className="mm-overlay">
          <section role="dialog" aria-modal="true" aria-label="评论朋友圈">
            <h3>{reply.id ? "回复 " + reply.name : "写评论"}</h3>
            <textarea
              autoFocus
              value={comment}
              maxLength={2000}
              onChange={(e) => setComment(e.target.value)}
              placeholder="说点什么…"
            />
            <div className="mm-dialog-actions">
              <button disabled={busy} onClick={() => setReply(undefined)}>
                取消
              </button>
              <button
                className="mm-primary"
                disabled={busy || !comment.trim()}
                onClick={() =>
                  operate(async () => {
                    await interact("user", name("user"), reply.postId, {
                      kind: "comment",
                      text: comment,
                      replyTo: reply.id,
                    });
                    setReply(undefined);
                  })
                }
              >
                发送
              </button>
            </div>
          </section>
        </div>
      )}
      {virtual && (
        <div className="mm-overlay">
          <section role="dialog" aria-modal="true" aria-label="虚拟媒体描述">
            <h3>{virtual === "image" ? "这张照片" : "这段视频"}</h3>
            <textarea
              value={description}
              maxLength={8000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述画面与内容，好友会将它理解为你真实发布的照片或视频。"
            />
            <div className="mm-dialog-actions">
              <button onClick={() => setVirtual(null)}>取消</button>
              <button
                disabled={!description.trim()}
                onClick={() => {
                  setMedia((old) => [
                    ...old,
                    { kind: virtual, virtual: true, description },
                  ]);
                  setVirtual(null);
                }}
              >
                添加
              </button>
            </div>
          </section>
        </div>
      )}
      {suggestion && (
        <div className="mm-overlay">
          <section role="dialog" aria-modal="true" aria-label="社交习惯建议">
            <h3>TA 的社交习惯建议</h3>
            <p>{suggestion.reason}</p>
            <p>
              每周约 {suggestion.postsPerWeek} 条动态 · 每日约{" "}
              {suggestion.browsesPerDay} 次浏览机会
            </p>
            <p>
              点赞 {Math.round(suggestion.likeChance * 100)}% · 评论{" "}
              {Math.round(suggestion.commentChance * 100)}% · 回应{" "}
              {Math.round(suggestion.replyChance * 100)}%
            </p>
            <p>
              休息时段：{suggestion.quietStart}～{suggestion.quietEnd}
              时；偶尔晚睡 {Math.round(suggestion.lateNightChance * 100)}
              %，深夜聊天例外 {Math.round(suggestion.lateChatChance * 100)}%
            </p>
            <p>浏览时段：{suggestion.hours.join("、")} 时</p>
            <p>{suggestion.preferences}</p>
            <div className="mm-dialog-actions">
              <button onClick={() => setSuggestion(undefined)}>
                保留原设置
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  updateParticipant((p) => {
                    p.habits = suggestion;
                    p.assessed = true;
                    setSuggestion(undefined);
                  })
                }
              >
                应用建议
              </button>
            </div>
          </section>
        </div>
      )}
      {confirm && (
        <div className="mm-overlay">
          <section role="dialog" aria-modal="true" aria-label="确认操作">
            <p>{confirm.text}</p>
            <div className="mm-dialog-actions">
              <button onClick={() => setConfirm(null)}>取消</button>
              <button
                disabled={busy}
                onClick={() =>
                  operate(async () => {
                    await confirm.run();
                    setConfirm(null);
                  })
                }
              >
                确认
              </button>
            </div>
          </section>
        </div>
      )}
      {image && <Viewer media={image} onClose={() => setImage(undefined)} />}
    </div>
  );
}
