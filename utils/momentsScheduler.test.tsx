// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import MomentsRuntime from "../components/os/MomentsRuntime";
import { DB } from "./db";
import { saveConfig } from "../features/moments/storage";
import { momentsEnabled, setMomentsEnabled } from "../features/moments/gate";
import { MOMENTS_CHANGED } from "../features/moments/schema";
import {
  chatMomentsContext,
  prepareMomentsQuery,
} from "../features/moments/bridge";
vi.mock("../context/OSContext", () => ({
  useOS: () => ({
    isLocked: false,
    apiConfig: {},
    userProfile: { name: "test" },
    realtimeConfig: {},
  }),
}));
const tick = vi.hoisted(() => vi.fn());
vi.mock("../features/moments/runtime", () => ({ tick }));
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await DB.deleteDB();
  setMomentsEnabled(false);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  tick.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
it("mounts no five-minute timer or model tick while disabled, and removes the timer on disable", async () => {
  const time = vi.spyOn(globalThis, "setTimeout"),
    clear = vi.spyOn(globalThis, "clearTimeout");
  await act(async () => root.render(<MomentsRuntime />));
  await settle();
  expect(time.mock.calls.filter((c) => typeof c[1] === "number" && c[1] >= 299000 && c[1] <= 300000)).toHaveLength(0);
  await act(async () => {
    await saveConfig((c) => {
      c.enabled = true;
    });
  });
  await settle();
  expect(time.mock.calls.filter((c) => typeof c[1] === "number" && c[1] >= 299000 && c[1] <= 300000).length).toBeGreaterThan(
    0,
  );
  expect(tick).not.toHaveBeenCalled();
  await act(async () => {
    await saveConfig((c) => {
      c.enabled = false;
    });
  });
  await settle();
  expect(clear).toHaveBeenCalled();
  expect(momentsEnabled()).toBe(false);
});
it("disabled chat context and explicit-view preparation return without any database access", async () => {
  setMomentsEnabled(false);
  const db = vi.spyOn(DB, "getAsset").mockRejectedValue(Error("must not read"));
  expect(await chatMomentsContext("a")).toEqual({ stable: "", dynamic: "" });
  await prepareMomentsQuery("a", []);
  expect(db).not.toHaveBeenCalled();
});

it("runs a due Moments check in a hidden but still-alive browser without extra calls on visibility changes", async () => {
  await saveConfig(c => { c.enabled = true; });
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  const timerSpy = vi.spyOn(globalThis, "setTimeout");
  await act(async () => root.render(<MomentsRuntime />));
  await settle();
  const scheduled = timerSpy.mock.calls.findIndex(args => typeof args[1] === "number" && args[1] >= 299000 && args[1] <= 300000);
  expect(scheduled).toBeGreaterThanOrEqual(0);
  const callback = timerSpy.mock.calls[scheduled][0] as () => void;
  // Trigger the captured timer without advancing a real five minutes.
  clearTimeout(timerSpy.mock.results[scheduled].value as ReturnType<typeof setTimeout>);
  await act(async () => {
    callback();
    await new Promise(resolve => setTimeout(resolve, 25));
  });
  expect(tick).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event(MOMENTS_CHANGED));
  await settle();
  expect(tick).toHaveBeenCalledTimes(1);
});
