import SingingLab from "./SingingLab";
import { useLocalBackHandler } from "../../hooks/useLocalBackHandler";
import { LYRIC_CO_WRITING_STYLES } from "../../utils/songPrompts";
import { mutateSong } from "../../features/songwriting/storage";
import React, { useEffect, useRef, useState } from "react";
import { useOS } from "../../context/OSContext";
import type { SongSheet, SongLine, Message } from "../../types";
import { DB } from "../../utils/db";
import { formatMessageForPrompt } from "../../utils/messageFormat";
import {
  generateStudioReply,
  type GenerationTarget,
} from "../../features/songwriting/generate";
import {
  getSong,
  writeTurn,
  saveProposal,
  acceptProposal,
  completeSong,
  studioMessages,
  commitStudioReply,
} from "../../features/songwriting/storage";
import {
  SONGWRITING_UPDATED,
  finalLines,
  lyricsText,
  parseLyrics,
  createProposal,
  lyricFingerprint,
  sectionNames,
  type Scope,
  type StudioTheme,
  type LyricProposal,
} from "../../features/songwriting/model";
import SongwritingCard from "./SongwritingCard";
import { StudioMascot, ThemeSwitch } from "./StudioTheme";
import "./SongwritingStudio.css";
interface Props {
  song: SongSheet;
  theme: StudioTheme;
  onTheme: (t: StudioTheme) => void;
  onBack: () => void;
  onPreview: (song: SongSheet) => void;
}
export default function SongwritingStudio({
  song: initial,
  theme,
  onTheme,
  onBack,
  onPreview,
}: Props) {
  const {
    characters,
    apiConfig,
    userProfile,
    groups,
    realtimeConfig,
    addToast,
    lastMsgTimestamp,
  } = useOS();
  const [song, setSong] = useState(initial),
    [tab, setTab] = useState<"lyrics" | "chat" | "history" | "voice">("lyrics"),
    [rows, setRows] = useState<Message[]>([]),
    [all, setAll] = useState(false);
  const [visibleCount, setVisibleCount] = useState(200);
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [scope, setScope] = useState<Scope>("section"),
    [position, setPosition] = useState(0),
    [section, setSection] = useState<SongLine["section"]>("verse"),
    [instruction, setInstruction] = useState("");
  const [editorBase, setEditorBase] = useState(""),
    [lastRequest, setLastRequest] = useState<{
      text: string;
      target?: GenerationTarget;
      id: string;
    } | null>(null);
  const [editor, setEditor] = useState<string | null>(null),
    [candidateText, setCandidateText] = useState(""),
    [showCandidate, setShowCandidate] = useState(false),
    [retry, setRetry] = useState<{
      text: string;
      target?: GenerationTarget;
      id: string;
    } | null>(null);
  const controller = useRef<AbortController | null>(null),
    locked = useRef(false),
    mounted = useRef(true),
    bottom = useRef<HTMLDivElement>(null);
  const char = characters.find((c) => c.id === song.collaboratorId),
    lines = finalLines(song),
    p = song.lyricProposal;
  const refresh = async () => {
    const current = await getSong(initial.id);
    const messages = await studioMessages(current, all, visibleCount);
    if (mounted.current) {
      setSong(current);
      setRows(messages);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const update = (e?: Event) => {
      const owner = (e as CustomEvent | undefined)?.detail?.charId;
      if (owner && owner !== initial.collaboratorId) return;
      void getSong(initial.id)
        .then(async (current) => {
          const messages = await studioMessages(current, all, visibleCount);
          if (active) {
            setSong(current);
            setRows(messages);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    };
    update();
    window.addEventListener(SONGWRITING_UPDATED, update);
    window.addEventListener("focus", update);
    return () => {
      active = false;
      window.removeEventListener(SONGWRITING_UPDATED, update);
      window.removeEventListener("focus", update);
    };
  }, [initial.id, initial.collaboratorId, all, lastMsgTimestamp, visibleCount]);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [rows.length, tab]);
  useEffect(() => {
    if (p) setCandidateText(lyricsText(p.lines));
  }, [p?.id]);
  useLocalBackHandler(() => {
    if (showCandidate) {
      setShowCandidate(false);
      return true;
    }
    if (editor !== null) {
      setEditor(null);
      return true;
    }
    onBack();
    return true;
  }, 30);
  const run = async (label: string, fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      if (e.name !== "AbortError" && mounted.current)
        setError(e.message || String(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy("");
    }
  };
  const generate = async (
    request: { text: string; target?: GenerationTarget; id: string },
    isRetry = false,
  ) =>
    run("正在和灵感碰面", async () => {
      controller.current = new AbortController();
      const signal = controller.current.signal;
      const current = await getSong(initial.id);
      if (!isRetry)
        await writeTurn(current, "user", request.text, request.id + ":user");
      setRetry(request);
      setLastRequest(request);
      const reply = await generateStudioReply(
        current,
        {
          api: apiConfig,
          user: userProfile,
          context: {
            groups: groups || [],
            emojis: [],
            categories: [],
            realtimeConfig,
          },
        },
        signal,
        request.target,
      );
      // One assistant reply per request even if a save needs a retry. Proposal is never applied here.
      await commitStudioReply(
        current.id,
        request.id,
        reply.reply,
        reply.proposal,
      );
      if (reply.confirmedProposalId && current.lyricProposal) {
        await acceptProposal(
          current.id,
          current.lyricProposal,
          current.lyricProposal.authorId === "user"
            ? userProfile.name
            : char?.name || "创作伙伴",
        );
      }
      if (reply.proposal) {
        setCandidateText(lyricsText(reply.proposal.lines));
        setShowCandidate(true);
      }
      setRetry(null);
      await refresh();
    });
  const send = () => {
    if (!text.trim() || busy) return;
    const value = text.trim();
    setText("");
    setTab("chat");
    void generate({ text: value, id: crypto.randomUUID() });
  };
  const generateRange = () => {
    if (p) {
      setShowCandidate(true);
      addToast("先接受或取消当前候选，再生成新的版本", "info");
      return;
    }
    const start = Math.min(position, lines.length);
    let count =
      scope === "song"
        ? lines.length
        : scope === "line"
          ? Number(start < lines.length)
          : 0;
    const targetSection = lines[start]?.section || section;
    if (scope === "section")
      for (
        let i = start;
        i < lines.length && lines[i].section === targetSection;
        i++
      )
        count++;
    const target: GenerationTarget = {
      scope,
      start: scope === "song" ? 0 : start,
      deleteCount: count,
      section: targetSection,
    };
    const request = `请${count ? "修改" : "创作"}${scope === "line" ? "一句歌词" : scope === "section" ? `${sectionNames[targetSection]}段落` : "整首歌词"}${scope === "song" ? "" : `，从第${start + 1}句开始`}。${instruction.trim() || "按我们的讨论和当前歌曲自然创作，句数不固定。"}`;
    void generate({ text: request, target, id: crypto.randomUUID() });
  };
  const apply = () => {
    if (!p) return;
    void run("正在保存这一版", async () => {
      const edited = {
        ...p,
        lines: parseLyrics(
          candidateText,
          p.authorId,
          p.lines[0]?.section || section,
        ),
      };
      const current = await acceptProposal(
        song.id,
        edited,
        p.authorId === "user" ? userProfile.name : char?.name || "创作伙伴",
      );
      setSong(current);
      setShowCandidate(false);
      await refresh();
    });
  };
  const saveManual = () => {
    if (editor === null) return;
    void run("正在收好歌词", async () => {
      const current = await getSong(song.id);
      if (editorBase !== lyricFingerprint(current.lines))
        throw Error("歌词已在别处更新，请复制你的编辑内容，重新打开编辑器核对");
      const proposal = createProposal(
        current,
        "song",
        "手动编辑歌词",
        0,
        finalLines(current).length,
        parseLyrics(editor, "user"),
        "user",
      );
      const saved = await acceptProposal(song.id, proposal, userProfile.name);
      setSong(saved);
      setEditor(null);
      await refresh();
    });
  };
  const restore = (
    revision: NonNullable<SongSheet["lyricRevisions"]>[number],
  ) => {
    if (p) {
      setShowCandidate(true);
      return;
    }
    const proposal = createProposal(
      song,
      "song",
      `恢复版本 · ${revision.label}`,
      0,
      lines.length,
      revision.after
        .filter((l) => !l.isDraft)
        .map((l) => ({ ...l, id: crypto.randomUUID(), timestamp: Date.now() })),
      "user",
    );
    void run("准备历史版本", async () => {
      setSong(await saveProposal(song.id, proposal));
      setShowCandidate(true);
    });
  };
  return (
    <div className={`sw-studio sw-${theme}`}>
      <header className="sw-header">
        <button className="sw-icon" onClick={onBack} aria-label="返回歌曲书架">
          ‹
        </button>
        <div>
          <small>LET THE UNSAID SING</small>
          <h1>{song.title}</h1>
        </div>
        <ThemeSwitch theme={theme} onChange={onTheme} />
      </header>
      <div className="sw-hero">
        <div>
          <span className="sw-eyebrow">
            {theme === "moon-sheep"
              ? "MOONWOOL / 月光织词"
              : "TIDELINES / 潮汐来信"}
          </span>
          <h2>
            {theme === "moon-sheep"
              ? "把心事，织进月光里"
              : "海浪替我们，留住旋律"}
          </h2>
          <p>与 {char?.name || "创作伙伴"} · 写一首属于我们的歌</p>
        </div>
        <StudioMascot theme={theme} />
      </div>
      <nav className="sw-tabs">
        {(
          [
            ["lyrics", "歌词本"],
            ["chat", "创作对话"],
            ["history", "修改历史"],
            ["voice", "专属歌声"],
          ] as const
        ).map(([id, title]) => (
          <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}>
            {title}
            {id === "history" && !!song.lyricRevisions?.length && (
              <sup>{song.lyricRevisions.length}</sup>
            )}
          </button>
        ))}
      </nav>
      <main className="sw-scroll">
        {error && (
          <div className="sw-error" role="alert">
            {error}
            {retry && (
              <button
                disabled={!!busy}
                onClick={() => void generate(retry, true)}
              >
                重试本轮回复
              </button>
            )}
          </div>
        )}
        {p && (
          <button
            className="sw-candidate-banner"
            onClick={() => setShowCandidate(true)}
          >
            ✧ 有一版「{p.label}」等你听听看 <span>预览 →</span>
          </button>
        )}
        {tab === "lyrics" && (
          <>
            <div className="sw-sheet">
              <div className="sw-sheet-title">
                <small>A PAGE FOR OUR SONG</small>
                <h2>{song.title}</h2>
                <p>{song.subtitle || "还没说出口的话，也可以唱出来"}</p>
                <button
                  disabled={!!busy || !!p}
                  onClick={() => {
                    setEditorBase(lyricFingerprint(song.lines));
                    setEditor(lyricsText(song.lines));
                  }}
                >
                  手动编辑 / 保存
                </button>
              </div>
              {lines.length ? (
                lines.map((line, index) => (
                  <div key={line.id} className="sw-lyric-row">
                    {(index === 0 ||
                      lines[index - 1].section !== line.section) && (
                      <h3>{sectionNames[line.section]}</h3>
                    )}
                    <button
                      aria-label={`选择第${index + 1}句`}
                      className={position === index ? "selected" : ""}
                      onClick={() => {
                        setPosition(index);
                        setSection(line.section);
                      }}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{line.content}</p>
                    </button>
                  </div>
                ))
              ) : (
                <div className="sw-empty">
                  先聊聊灵感，或让 ta 写下第一段
                  <br />
                  <small>这一页空白，正在等你们相遇</small>
                </div>
              )}
              <div className="sw-sheet-footer">
                <span>
                  {lines.length} 句 ·{" "}
                  {song.status === "completed" ? "歌词已完成" : "创作中"}
                </span>
                <span>you & {char?.name}</span>
              </div>
            </div>
            <section className="sw-panel">
              <div className="sw-panel-heading">
                <h3>让灵感长成一首歌</h3>
                <small>MAKE ROOM FOR A LITTLE MAGIC</small>
              </div>
              <label className="sw-style-label">
                共创方式
                <select
                  aria-label="共创方式"
                  value={song.lyricCoWritingStyle || "adaptive"}
                  disabled={!!busy}
                  onChange={(e) => {
                    const style = e.target
                      .value as SongSheet["lyricCoWritingStyle"];
                    void run("保存共创方式", async () => {
                      setSong(
                        await mutateSong(song.id, (current) => ({
                          song: { ...current, lyricCoWritingStyle: style },
                        })),
                      );
                    });
                  }}
                >
                  {LYRIC_CO_WRITING_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sw-segment">
                {(
                  [
                    ["line", "单句"],
                    ["section", "段落"],
                    ["song", "整首"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={scope === id}
                    onClick={() => setScope(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {scope !== "song" && (
                <div className="sw-form-row">
                  <label>
                    开始位置
                    <select
                      aria-label="开始位置"
                      value={Math.min(position, lines.length)}
                      onChange={(e) => setPosition(Number(e.target.value))}
                    >
                      {lines.map((l, i) => (
                        <option key={l.id} value={i}>
                          第 {i + 1} 句 · {sectionNames[l.section]}
                        </option>
                      ))}
                      <option value={lines.length}>末尾新增</option>
                    </select>
                  </label>
                  {position >= lines.length && (
                    <label>
                      段落
                      <select
                        aria-label="新增段落"
                        value={section}
                        onChange={(e) =>
                          setSection(e.target.value as SongLine["section"])
                        }
                      >
                        {Object.entries(sectionNames).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
              <textarea
                aria-label="创作要求"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="比如：写六句主歌，温柔一点；或整首重写，保留原副歌"
                rows={3}
              />
              <button
                className="sw-primary"
                disabled={!!busy || !char}
                onClick={generateRange}
              >
                ✧ 生成候选歌词
              </button>
              <p className="sw-note">先预览，再决定。你的原稿会一直在。</p>
            </section>
            <div className="sw-actions">
              <button
                disabled={!!busy || !lines.length}
                onClick={() =>
                  void run("正在保存完成作品", async () => {
                    const saved = await completeSong(
                      song.id,
                      `${userProfile.name} & ${char?.name || "创作伙伴"}`,
                    );
                    setSong(saved);
                    await refresh();
                    addToast("歌词已完成，可以继续试听出歌", "success");
                  })
                }
              >
                ✓ 歌词定稿
              </button>
              <button
                className="sw-primary"
                disabled={!!busy || !lines.length}
                onClick={() => onPreview(song)}
              >
                试听 / 生成歌曲 →
              </button>
            </div>
          </>
        )}
        {tab === "chat" && (
          <>
            <div className="sw-chat-filter">
              <span>每一句都留在我们的日常里</span>
              <button
                onClick={() => {
                  setAll(!all);
                  setVisibleCount(200);
                }}
              >
                {all ? "只看这首歌" : "查看完整聊天"}
              </button>
            </div>
            <div className="sw-messages">
              {rows.length >= visibleCount && (
                <button
                  className="sw-text-button"
                  onClick={() => setVisibleCount((n) => n + 200)}
                >
                  查看更早的记录
                </button>
              )}
              {!rows.length && (
                <div className="sw-empty">
                  今天想把什么唱成歌？
                  <br />
                  <small>从一句话开始，就很好。</small>
                </div>
              )}
              {rows.map((m) => (
                <article key={m.id} className={`sw-message sw-role-${m.role}`}>
                  <small>
                    {m.role === "user"
                      ? userProfile.name
                      : m.role === "assistant"
                        ? char?.name
                        : "记录"}{" "}
                    ·{" "}
                    {new Date(m.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                  {m.metadata?.songwritingCard ? (
                    <SongwritingCard card={m.metadata.songwritingCard} />
                  ) : (
                    <div className="sw-bubble">
                      {m.type === "text"
                        ? m.content
                        : formatMessageForPrompt(
                            m,
                            char?.name || "创作伙伴",
                            userProfile.name,
                          )}
                    </div>
                  )}
                </article>
              ))}
              {!!song.comments.length && (
                <details className="sw-panel">
                  <summary>原有创作记录（保留原文）</summary>
                  {song.comments.map((c) => (
                    <p key={c.id} className="sw-legacy">
                      <small>
                        {c.authorId === "user" ? userProfile.name : char?.name}
                      </small>
                      <br />
                      {c.content}
                    </p>
                  ))}
                </details>
              )}
              <div ref={bottom} />
            </div>
          </>
        )}
        {tab === "voice" && <SingingLab char={char} />}
        {tab === "history" && (
          <>
            {!(song.lyricRevisions || []).length && (
              <div className="sw-empty">
                写下的每一版，都会有回声
                <br />
                <small>正式保存后，修改历史会出现在这里。</small>
              </div>
            )}
            {[...(song.lyricRevisions || [])].reverse().map((r, i) => (
              <details className="sw-panel" key={r.id}>
                <summary>
                  第{(song.lyricRevisions?.length || 0) - i}版 · {r.label}
                  <small className="sw-history-date">
                    {new Date(r.at).toLocaleString()}
                  </small>
                </summary>
                <h4>修改前</h4>
                <pre>{lyricsText(r.before) || "（空）"}</pre>
                <h4>修改后</h4>
                <pre>{lyricsText(r.after) || "（空）"}</pre>
                <button disabled={!!busy} onClick={() => restore(r)}>
                  预览并恢复这一版
                </button>
              </details>
            ))}
          </>
        )}
      </main>
      {busy && (
        <div className="sw-status" role="status">
          <span className="sw-loading">✧</span> {busy}…{" "}
          {busy === "正在和灵感碰面" && (
            <button onClick={() => controller.current?.abort()}>
              停止生成
            </button>
          )}
        </div>
      )}
      {tab === "chat" && (
        <footer className="sw-composer">
          <textarea
            aria-label="创作聊天"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="聊聊主题，或说说想改哪一句…"
            rows={2}
          />
          <button
            className="sw-primary"
            disabled={!!busy || !text.trim() || !char}
            onClick={send}
          >
            发送 ↑
          </button>
        </footer>
      )}
      {editor !== null && (
        <div className="sw-modal-backdrop">
          <section
            className="sw-modal"
            role="dialog"
            aria-modal="true"
            aria-label="手动编辑歌词"
          >
            <h2>给歌词一点新的形状</h2>
            <p>用 [verse]、[chorus] 等标题划分段落，保存时记录一次修改。</p>
            <textarea
              aria-label="手动歌词"
              value={editor}
              onChange={(e) => setEditor(e.target.value)}
              rows={14}
            />
            <div className="sw-actions">
              <button disabled={!!busy} onClick={() => setEditor(null)}>
                取消
              </button>
              <button
                className="sw-primary"
                disabled={!!busy}
                onClick={saveManual}
              >
                保存修改
              </button>
            </div>
          </section>
        </div>
      )}
      {showCandidate && p && (
        <div className="sw-modal-backdrop">
          <section
            className="sw-modal"
            role="dialog"
            aria-modal="true"
            aria-label="候选歌词预览"
          >
            <small>ANOTHER WAY TO SAY IT</small>
            <h2>{p.label}</h2>
            <p>
              第{p.start + 1}句起 ·{" "}
              {p.deleteCount ? `替换 ${p.deleteCount} 句` : "新增歌词"} ·
              还没有改动原稿
            </p>
            <details>
              <summary>查看原稿范围</summary>
              <pre>
                {lyricsText(lines.slice(p.start, p.start + p.deleteCount)) ||
                  "（空）"}
              </pre>
            </details>
            <textarea
              aria-label="候选歌词"
              value={candidateText}
              onChange={(e) => setCandidateText(e.target.value)}
              rows={12}
            />
            <div className="sw-actions">
              <button
                disabled={!!busy}
                onClick={() => {
                  void run("取消候选", async () => {
                    setSong(await saveProposal(song.id, undefined));
                    setShowCandidate(false);
                  });
                }}
              >
                取消候选
              </button>
              <button
                disabled={!!busy}
                onClick={() =>
                  void run("收好候选", async () => {
                    setSong(
                      await saveProposal(song.id, {
                        ...p,
                        lines: parseLyrics(
                          candidateText,
                          p.authorId,
                          p.lines[0]?.section || section,
                        ),
                      }),
                    );
                    setShowCandidate(false);
                  })
                }
              >
                稍后再看
              </button>
              <button className="sw-primary" disabled={!!busy} onClick={apply}>
                接受并保存
              </button>
            </div>
            <button
              className="sw-text-button"
              disabled={!!busy || !lastRequest}
              onClick={() => {
                if (lastRequest)
                  void generate({ ...lastRequest, id: crypto.randomUUID() });
              }}
            >
              重新生成本轮
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
