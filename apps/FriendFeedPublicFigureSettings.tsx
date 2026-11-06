import React, { useEffect, useState } from "react";
import { useOS } from "../context/OSContext";
import {
  readFriendFeed,
  savePublicFigureSettings,
  type FriendFeedState,
} from "../utils/friendFeed";
import { resolveFriendFeedSettings } from "../utils/friendFeedSettings";
import {
  friendAccountName,
  activeFriendAccounts,
} from "../utils/friendFeedGraph";
import { useLocalBackHandler } from "../hooks/useLocalBackHandler";
export default function FriendFeedPublicFigureSettings() {
  const os = useOS(),
    [open, setOpen] = useState(false),
    [feed, setFeed] = useState<FriendFeedState>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (open)
      void readFriendFeed()
        .then(setFeed)
        .catch((e) => setError(e.message));
  }, [open]);
  useLocalBackHandler(
    () => {
      setOpen(false);
      return true;
    },
    50,
    open,
  );
  const update = async (
    fn: (s: ReturnType<typeof resolveFriendFeedSettings>) => void,
  ) => {
    if (busy || !feed) return;
    setBusy(true);
    try {
      const fresh = await readFriendFeed(),
        settings = resolveFriendFeedSettings(fresh.settings);
      fn(settings);
      await savePublicFigureSettings(
        settings.publicFigures,
        settings.publicPeers,
      );
      setFeed(await readFriendFeed());
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const settings = resolveFriendFeedSettings(feed?.settings);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        公众人物账号与公开互动许可 ›
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="公众人物设置"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 60,
            background: "#f5f6f4",
            overflow: "auto",
            padding: "calc(var(--chrome-top,0px) + 18px) 20px 30px",
          }}
        >
          <button onClick={() => setOpen(false)} style={{ minHeight: 44 }}>
            ‹ 返回
          </button>
          <h2>公众人物账号</h2>
          <p>仅适用于公开哔哔，与私人朋友圈好友关系独立。</p>
          {error && <p role="alert">{error}</p>}
          {os.characters.map((c) => (
            <label
              key={c.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "15px 0",
                borderBottom: "1px solid #ddd",
              }}
            >
              {c.name}
              <input
                type="checkbox"
                checked={!!settings.publicFigures[c.id]}
                disabled={busy}
                onChange={(e) =>
                  void update((s) => {
                    s.publicFigures = {
                      ...s.publicFigures,
                      [c.id]: e.target.checked,
                    };
                  })
                }
              />
            </label>
          ))}
          <h3>身份确认且适合公开互动的同行账号</h3>
          <p>
            只勾选确定可公开互动的公众人物/同行。角色还需已经知道该账号身份；普通粉丝、user、未知身份不允许主动互动，小号单独设置。
          </p>
          {feed &&
            activeFriendAccounts(feed, os.characters)
              .filter((a) => a.ownerId !== "user")
              .map((a) => (
                <label
                  key={a.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 0",
                  }}
                >
                  {friendAccountName(
                    feed,
                    a,
                    os.characters,
                    os.userProfile.name,
                  )}
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={!!settings.publicPeers[a.id]}
                    onChange={(e) =>
                      void update((s) => {
                        s.publicPeers = {
                          ...s.publicPeers,
                          [a.id]: e.target.checked,
                        };
                      })
                    }
                  />
                </label>
              ))}
        </div>
      )}
    </>
  );
}
