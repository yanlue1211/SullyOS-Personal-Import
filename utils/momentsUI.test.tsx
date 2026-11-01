// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import MomentsApp from "../apps/MomentsApp";
import { DB } from "./db";
import {
  saveConfig,
  getConfig,
  publish,
  rows,
} from "../features/moments/storage";
import { participantDefaults, type Post } from "../features/moments/schema";
import { handleLocalBack } from "./localBackHandlers";
const mock = vi.hoisted(() => ({
  close: vi.fn(),
  chars: [
    { id: "a", name: "阿青", avatar: "🍃", memories: [], systemPrompt: "" },
    { id: "b", name: "小白", avatar: "☀️", memories: [], systemPrompt: "" },
  ],
}));
vi.mock("../context/OSContext", () => ({
  useOS: () => ({
    characters: mock.chars,
    userProfile: { name: "小雨", avatar: "🌻" },
    apiConfig: {},
    realtimeConfig: {},
    closeApp: mock.close,
  }),
}));
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
}
async function render() {
  await act(async () => {
    root.render(<MomentsApp />);
  });
  await settle();
}
function button(text: string) {
  const b = [...host.querySelectorAll("button")].find(
    (x) =>
      x.textContent?.includes(text) || x.getAttribute("aria-label") === text,
  );
  expect(b, text).toBeTruthy();
  return b!;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
  await settle();
}
async function field(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const proto =
      el.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
  await settle();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.close.mockReset();
  await DB.deleteDB();
  for (const c of mock.chars) await DB.saveCharacter(c as any);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function enable() {
  await saveConfig((c) => {
    c.enabled = true;
    for (const char of mock.chars)
      c.participants[char.id] = { ...participantDefaults(), enabled: true };
  });
}
it("keeps all secondary settings absent until the user confirms the top switch", async () => {
  await render();
  expect(host.textContent).toContain("开启朋友圈");
  expect(host.textContent).not.toContain("每日目标");
  await act(async () => {
    (host.querySelector("input[type=checkbox]") as HTMLInputElement).click();
  });
  await settle();
  expect((await getConfig()).enabled).toBe(false);
  await click("确认");
  expect((await getConfig()).enabled).toBe(true);
  expect(host.textContent).toContain("管理角色之间的好友关系");
  expect(host.textContent).toContain("自动活动预算");
});
it("publishes text without API calls, shows it immediately and supports reply/delete", async () => {
  await enable();
  await render();
  await click("发布朋友圈");
  await field(host.querySelector("textarea")!, "周末去看海。");
  await click("发表");
  expect(host.textContent).toContain("周末去看海。");
  await click("点赞或评论");
  await click("评论");
  await field(host.querySelector("textarea")!, "先占一楼");
  await click("发送");
  expect(host.textContent).toContain("先占一楼");
  expect(await rows("call")).toEqual([]);
  await click("删除评论");
  await click("确认");
  expect(host.textContent).not.toContain("先占一楼");
});
it("lets a user add virtual media and see the complete description in a dialog", async () => {
  await enable();
  await render();
  await click("发布朋友圈");
  await click("虚拟图片");
  await field(
    host.querySelector("[role=dialog] textarea")!,
    "夕阳下的河堤，狗狗在树旁打滚。",
  );
  await click("添加");
  await click("发表");
  expect(host.querySelectorAll(".mm-post .mm-virtual")).toHaveLength(1);
  await act(async () => {
    (host.querySelector(".mm-virtual") as HTMLButtonElement).click();
  });
  await settle();
  expect(host.querySelector("dialog")?.textContent).toContain("狗狗在树旁打滚");
  await click("关闭媒体");
  expect(host.querySelector("dialog")).toBeNull();
});
it("manages symmetric friendships and returns through settings instead of exiting", async () => {
  await enable();
  await render();
  await click("朋友圈设置");
  await click("管理角色之间的好友关系");
  await act(async () => {
    (
      host.querySelector(
        ".mm-setting-row input[type=checkbox]",
      ) as HTMLInputElement
    ).click();
  });
  await settle();
  expect((await getConfig()).friends).toEqual([["a", "b"]]);
  await act(async () => {
    handleLocalBack();
  });
  await settle();
  expect(host.textContent).toContain("自动活动预算");
  expect(mock.close).not.toHaveBeenCalled();
});
it("exposes separate publishing/browsing preferences and editable sleep exceptions", async () => {
  await enable();
  await render();
  await click("朋友圈设置");
  await click("阿青");
  expect(host.textContent).toContain("发布倾向");
  expect(host.textContent).toContain("浏览倾向");
  expect(host.textContent).toContain("通常不发布的休息时段");
  expect(host.textContent).toContain("深夜聊天后例外概率");
  expect(host.textContent).toContain("最多6条");
});
it("provides a read-only character preview without marking actual browsing", async () => {
  await enable();
  await publish("user", "小雨", {
    text: "可见的动态",
    theme: "",
    media: [],
    visibility: { mode: "all", ids: [] },
  });
  await render();
  await click("朋友圈设置");
  await field(host.querySelector("select")!, "a");
  await click("返回");
  expect(host.textContent).toContain("以阿青视角预览");
  expect(
    host.querySelector('[aria-label="发布朋友圈"]')?.hasAttribute("disabled"),
  ).toBe(true);
  expect(await rows("seen")).toEqual([]);
});
it('persists character activation, behavior and habits after controlled inputs reset', async () => {
  await saveConfig(c => { c.enabled = true; });
  await render(); await click('朋友圈设置'); await click('阿青');
  const toggle = () => host.querySelector('input[type=checkbox]') as HTMLInputElement;
  expect(toggle().checked).toBe(false);
  await act(async () => { toggle().click(); }); await settle();
  expect((await getConfig()).participants.a.enabled).toBe(true);
  expect(toggle().checked).toBe(true);
  const post = host.querySelectorAll('input[type=checkbox]')[1] as HTMLInputElement;
  await act(async () => { post.click(); }); await settle();
  expect((await getConfig()).participants.a.post).toBe(false);
  await field(host.querySelector('select')!, 'quiet');
  expect((await getConfig()).participants.a.habits.posting).toBe('quiet');
  const hour = host.querySelector('.mm-hours input') as HTMLInputElement;
  const before = hour.checked;
  await act(async () => { hour.click(); }); await settle();
  expect((await getConfig()).participants.a.habits.hours.includes(0)).toBe(!before);
  await click('返回'); await click('阿青');
  expect(toggle().checked).toBe(true);
  expect((host.querySelectorAll('input[type=checkbox]')[1] as HTMLInputElement).checked).toBe(false);
});
