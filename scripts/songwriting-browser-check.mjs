import { pathToFileURL } from "node:url";
const modulePath = process.env.SONGWRITING_PLAYWRIGHT_MODULE;
if (!modulePath)
  throw Error(
    "Set SONGWRITING_PLAYWRIGHT_MODULE to the installed Playwright entry",
  );
const { chromium } = await import(pathToFileURL(modulePath).href);
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SONGWRITING_CHROMIUM_PATH
    ? { executablePath: process.env.SONGWRITING_CHROMIUM_PATH }
    : {}),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--disable-gpu-sandbox",
  ],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("/tmp/songwriting-qa", { recursive: true });
try {
  await page.route("https://qa-songwriting.invalid/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: "可以，把海风写得更轻一点。先看看这一版。",
                proposal: {
                  scope: "section",
                  label: "温柔的主歌",
                  start: 0,
                  deleteCount: 2,
                  lines: [
                    { section: "verse", content: "月光轻轻落在你掌心" },
                    { section: "verse", content: "海风捎来一封未寄的信" },
                    { section: "verse", content: "小羊数着星星等你靠近" },
                  ],
                },
              }),
            },
          },
        ],
      }),
    }),
  );
  await page.goto(
    "http://127.0.0.1:5183/test/fixtures/songwriting-browser.html",
  );
  await page
    .getByRole("button", { name: "生成候选歌词", exact: false })
    .waitFor();
  if (process.env.SONGWRITING_FONT_CSS) {
    const fontFile = process.env.SONGWRITING_FONT_CSS;
    const css = await readFile(fontFile, "utf8");
    const paths = [
      ...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1])),
    ];
    let embedded = css;
    for (const path of paths) {
      const data = await readFile(resolve(dirname(fontFile), path));
      embedded = embedded
        .split(`url(${path})`)
        .join(`url(data:font/woff2;base64,${data.toString("base64")})`);
    }
    await page.addStyleTag({
      content:
        embedded +
        "body,.sw-studio,.sw-studio h1,.sw-studio h2,.sw-lyric-row p{font-family:'Noto Sans SC',sans-serif!important}",
    });
    await page.evaluate(() => document.fonts.ready);
  }
  await page.screenshot({
    path: "/tmp/songwriting-qa/sheep.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "≈ 小狗", exact: true }).click();
  await page.screenshot({
    path: "/tmp/songwriting-qa/dog.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "生成候选歌词", exact: false })
    .click();
  await page.getByRole("dialog", { name: "候选歌词预览" }).waitFor();
  const before = await page.evaluate(async () =>
    window.__songwritingQA.getSong("sw-browser"),
  );
  if (before.lines.length !== 4) throw Error("Preview already mutated lyrics");
  await page.screenshot({
    path: "/tmp/songwriting-qa/candidate.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "接受并保存", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const saved = await page.evaluate(async () =>
    window.__songwritingQA.getSong("sw-browser"),
  );
  if (saved.lines.length !== 5 || saved.lyricRevisions.length !== 1)
    throw Error("Batch save failed");
  await page.getByRole("button", { name: "创作对话", exact: true }).click();
  await page
    .getByText("可以，把海风写得更轻一点。先看看这一版。", { exact: true })
    .waitFor();
  await page.getByText("LYRIC LETTER", { exact: true }).waitFor();
  await page.screenshot({
    path: "/tmp/songwriting-qa/chat.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: /修改历史/ }).click();
  await page.getByText("第1版 · 温柔的主歌", { exact: false }).waitFor();
  await page.getByRole("button", { name: "歌词本", exact: true }).click();
  await page.getByRole("button", { name: "✓ 歌词定稿", exact: true }).click();
  await page.waitForFunction(async () => {
    const s = await window.__songwritingQA.getSong("sw-browser");
    return s.status === "completed";
  });
  await page.getByRole("button", { name: "专属歌声", exact: true }).click();
  await page
    .getByRole("button", { name: "生成测试朗读", exact: true })
    .waitFor();
  if (
    !(await page
      .getByRole("button", { name: "生成测试朗读", exact: true })
      .isDisabled())
  )
    throw Error("Billable synthesis did not require opt-in");
  await page.screenshot({
    path: "/tmp/songwriting-qa/lab.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw Error("Mobile viewport overflows");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: mobile themes, generated preview, batch accept, single chat projection, reload/history, completion, voice cost gate; no page errors.",
  );
} finally {
  await browser.close();
}
