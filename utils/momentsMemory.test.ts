import { beforeEach, it, expect, vi } from "vitest";
import { extractMemoriesFromBuffer } from "./memoryPalace/extraction";
import { safeFetchJson } from "./safeApi";
import { formatMessageWithTime } from "./messageFormat";
import type { Message } from "../types";
vi.mock("./safeApi", async (original) => ({
  ...(await original<any>()),
  safeFetchJson: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(safeFetchJson)
    .mockReset()
    .mockResolvedValue({
      choices: [{ message: { content: "[]" }, finish_reason: "stop" }],
    });
});
const message = {
  id: 1,
  charId: "a",
  role: "system",
  type: "moments_card",
  timestamp: Date.now(),
  content:
    "[私人朋友圈重要事件]\n用户分享了第一次登山。\nD回复：下次一起。\n动态ID：mountain",
  metadata: { source: "moments" },
} as Message;
it("passes readable Moments events into the actual automatic extraction request", async () => {
  await extractMemoriesFromBuffer(
    [message],
    "a",
    "甲",
    { baseUrl: "https://example.invalid/v1", apiKey: "test", model: "test" },
    undefined,
    "用户",
  );
  expect(safeFetchJson).toHaveBeenCalledTimes(1);
  const request = JSON.parse(
    String(vi.mocked(safeFetchJson).mock.calls[0][1]?.body),
  );
  const text = JSON.stringify(request.messages);
  expect(text).toContain("第一次登山");
  expect(text).toContain("下次一起");
  expect(text).toContain("mountain");
});
it("retains the same event body in the formatter consumed by manual archive", () => {
  expect(formatMessageWithTime(message, "甲", "用户", () => "12:00")).toContain(
    "动态ID：mountain",
  );
});
