// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import MessageItem from "../components/chat/MessageItem";
import type { Message } from "../types";
const open = vi.hoisted(() => vi.fn());
vi.mock("../context/OSContext", () => ({ useOS: () => ({ openApp: open }) }));
const base = {
  id: 1,
  charId: "a",
  role: "assistant",
  type: "text",
  content: "🌙 月栖 · 夜间记录\n今晚一起听了一个海边的故事。",
  timestamp: Date.now(),
  metadata: { source: "yueqi", yueqiSessionId: "night-1" },
} as Message;
let host: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  menu: ReturnType<typeof vi.fn>;
async function render(message: Message = base, selection = false) {
  await act(async () =>
    root.render(
      <MessageItem
        msg={message}
        activeTheme={{ user: {}, ai: {} } as any}
        isFirstInGroup
        isLastInGroup
        charAvatar=""
        userAvatar=""
        charName="阿源"
        onLongPress={menu}
        onReply={() => {}}
        selectionMode={selection}
        isSelected={false}
        onToggleSelect={() => {}}
      />,
    ),
  );
}
function card() {
  return (
    host.querySelector("article") ||
    host.querySelector("summary") ||
    [...host.querySelectorAll("*")].at(-1)!
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  menu = vi.fn();
  open.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("a mobile hold on Yueqi opens the shared message menu and consumes the release click", async () => {
  await render();
  vi.useFakeTimers();
  const record = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("查看记录"),
  )!;
  await act(async () => {
    record.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    vi.advanceTimersByTime(610);
  });
  expect(menu).toHaveBeenCalledOnce();
  expect(menu).toHaveBeenCalledWith(base);
  await act(async () => {
    record.click();
  });
  expect(open).not.toHaveBeenCalled();
  expect(host.textContent).toContain("查看完整摘要");
});
it("Yueqi right click opens the same message menu rather than a private expand-only action", async () => {
  await render();
  await act(async () =>
    card().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
  expect(menu).toHaveBeenCalledOnce();
  expect(menu).toHaveBeenCalledWith(base);
});
it("normal summary and record buttons retain their original actions", async () => {
  await render();
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "查看完整摘要")!
      .click();
  });
  expect(host.textContent).toContain("收起摘要");
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("查看记录"))!
      .click();
  });
  expect(open).toHaveBeenCalledOnce();
  expect(menu).not.toHaveBeenCalled();
});
it.each([
  {
    type: "moments_card",
    role: "system",
    content: "[私人朋友圈重要事件] 一次散步",
    metadata: { source: "moments" },
  },
  {
    type: "friend_feed_card",
    role: "system",
    content: "公开动态",
    metadata: {
      friendFeedComment: {
        kind: "post",
        postId: "p",
        commentId: "c",
        postAuthor: "阿源",
        postExcerpt: "公开动态",
        comment: "",
      },
    },
  },
  { type: "room_card", role: "system", content: "一次家园记录", metadata: {} },
] as any[])(
  "keeps the shared long-press menu available for $type",
  async (patch) => {
    const m = { ...base, ...patch };
    await render(m);
    await act(async () =>
      card().dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    expect(menu).toHaveBeenCalledOnce();
    expect(menu).toHaveBeenCalledWith(m);
  },
);
it("scrolling movement and unmount cancel a pending hold", async () => {
  await render();
  vi.useFakeTimers();
  await act(async () => {
    card().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 0 }),
    );
    card().dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientY: 30 }),
    );
    vi.advanceTimersByTime(650);
  });
  expect(menu).not.toHaveBeenCalled();
  await act(async () => {
    card().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    root.render(null);
  });
  await act(async () => vi.advanceTimersByTime(650));
  expect(menu).not.toHaveBeenCalled();
});
it("selection mode exposes a selector and disables Yueqi navigation buttons", async () => {
  await render(base, true);
  expect(host.querySelector('[aria-label="选择月栖卡片"]')).not.toBeNull();
  const link = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("查看记录"),
  )!;
  expect(link.disabled).toBe(true);
});
