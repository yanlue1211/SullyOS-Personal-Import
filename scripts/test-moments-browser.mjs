import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const modulePath =
  process.env.MOMENTS_BROWSER_MODULE ||
  "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MOMENTS_CHROME_PATH
    ? { executablePath: process.env.MOMENTS_CHROME_PATH }
    : {}),
  args: ["--no-sandbox"],
});
const out = process.env.MOMENTS_SCREENSHOTS || "/tmp/moments-browser";
await mkdir(out, { recursive: true });
const errors = [];
let modelCalls = 0;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/chat/completions", (route) => {
    modelCalls++;
    return route.abort();
  });
  await page.goto(
    (process.env.MOMENTS_PREVIEW_ORIGIN || "http://127.0.0.1:4188") +
      "/test/fixtures/moments.html",
  );
  await page
    .getByText("太阳落下之前，刚好走到这里。", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".mm-post").count(), 3);
  async function centeredTitle() {
    const title = await page.locator('.mm-header h1').boundingBox();
    assert.ok(Math.abs(title.x + title.width / 2 - page.viewportSize().width / 2) < 1,
      'Header title must stay centered independently of action buttons');
  }
  await centeredTitle();
  assert.equal(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({ path: out + "/feed-390.png" });
  await page.getByRole("button", { name: "朋友圈设置", exact: true }).click();
  await page.getByRole("button", { name: "管理角色之间的好友关系" }).waitFor();
  await page.screenshot({ path: out + "/settings-390.png" });
  await page.getByRole("button", { name: /^A\s*已启用/ }).click();
  await page.getByText("通常不发布的休息时段", { exact: true }).waitFor();
  const enabled = page.getByLabel('启用朋友圈', {exact:true});
  await enabled.click();
  await page.getByText('通常不发布的休息时段', {exact:true}).waitFor({state:'hidden'});
  await enabled.click();
  await page.getByText('通常不发布的休息时段', {exact:true}).waitFor();
  assert.equal(await enabled.isChecked(), true);
  await centeredTitle();
  await page.screenshot({ path: out + "/habits-390.png" });
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "发布朋友圈", exact: true }).click();
  await page
    .getByRole("textbox", { name: "朋友圈正文" })
    .fill("浏览器验收：窗外的风有点凉。");
  await page.getByRole("button", { name: "虚拟图片", exact: true }).click();
  await page
    .getByRole("dialog", { name: "虚拟媒体描述" })
    .getByRole("textbox")
    .fill("白色窗帘轻轻晃动，窗台上放着一杯热茶。");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "发表", exact: true }).click();
  await page
    .getByText("浏览器验收：窗外的风有点凉。", { exact: true })
    .waitFor();
  await page
    .locator(".mm-post")
    .filter({ hasText: "浏览器验收：窗外的风有点凉。" })
    .getByRole("button", { name: "点赞或评论" })
    .click();
  await page.getByRole("button", { name: "▢ 评论", exact: true }).click();
  await page
    .getByRole("dialog", { name: "评论朋友圈" })
    .getByRole("textbox")
    .fill("一条手动评论，不应触发模型。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByText("一条手动评论，不应触发模型。", { exact: false })
    .waitFor();
  await page.reload();
  await page
    .getByText("浏览器验收：窗外的风有点凉。", { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 320, height: 740 });
  await centeredTitle();
  assert.equal(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({ path: out + "/feed-320.png" });
  assert.equal(
    modelCalls,
    0,
    "Local browsing/publication/comments must not call a model",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Moments browser checks passed: persistence, compose, virtual media, comment, settings, sleep controls, 390/320px, zero model requests.",
  );
} finally {
  await browser.close();
}
