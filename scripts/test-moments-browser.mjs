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
  await page.getByRole('button',{name:/API 调用监控/}).click();
  const monitor=page.getByRole('dialog',{name:'朋友圈 API 调用监控'});
  await monitor.getByRole('button',{name:'关闭并清除',exact:true}).click();
  await monitor.getByText('监控已关闭',{exact:true}).waitFor();
  await monitor.getByRole('button',{name:'返回',exact:true}).click();
  await monitor.waitFor({state:'hidden'});
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
  assert.ok(await page.locator('.mm-comment-time').count() > 0);
  assert.equal(await page.locator('.mm-delete-comment').count(),0);
  const commentRow=page.locator('.mm-comment').filter({hasText:'一条手动评论，不应触发模型。'});
  const bodyBounds=await commentRow.locator('button').boundingBox(),timeBounds=await commentRow.locator('time').boundingBox();
  assert.ok(timeBounds.y>=bodyBounds.y+bodyBounds.height-1,'Timestamp must be below the full-width comment body');
  await commentRow.dispatchEvent('pointerdown',{button:0,clientX:20,clientY:20,pointerType:'touch'});
  const commentDialog=page.getByRole('dialog',{name:'评论操作'});await commentDialog.waitFor();
  await commentRow.dispatchEvent('pointerup',{button:0});
  await commentDialog.getByRole('button',{name:'修改评论',exact:true}).click();
  await page.getByRole('textbox',{name:'修改评论正文'}).fill('长按修改后的完整评论。');
  await commentDialog.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByText('长按修改后的完整评论。',{exact:false}).waitFor();
  await page.screenshot({path:out+'/comments-edited-390.png'});

  const editedPost = page.locator('.mm-post').filter({hasText:'早起多出来的十分钟，用来吃一碗热面。'});
  await editedPost.getByRole('button',{name:'编辑朋友圈',exact:true}).click();
  await page.getByRole('textbox',{name:'朋友圈正文'}).fill('用户编辑了角色的早餐朋友圈。');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByText('用户编辑了角色的早餐朋友圈。',{exact:true}).waitFor();
  await page.locator('.mm-post').filter({hasText:'用户编辑了角色的早餐朋友圈。'}).getByRole('button',{name:'删除朋友圈',exact:true}).click();
  await page.getByRole('dialog',{name:'删除朋友圈方式'}).getByRole('button',{name:'普通删除',exact:true}).click();
  await page.getByText('用户编辑了角色的早餐朋友圈。',{exact:true}).waitFor({state:'hidden'});
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
  const music = await context.newPage();
  music.on('pageerror',e=>errors.push(e.message));
  const musicUrl=(process.env.MOMENTS_PREVIEW_ORIGIN || 'http://127.0.0.1:4188')+'/test/fixtures/music-management.html';
  await music.goto(musicUrl);
  await music.getByRole('textbox',{name:'批量歌曲链接'}).fill('https://fixture.invalid/one.mp3\nhttps://fixture.invalid/two.mp3');
  await music.getByRole('button',{name:'识别链接',exact:true}).click();
  await music.getByRole('button',{name:'移除待导入歌曲 1',exact:true}).click();
  await music.getByRole('textbox',{name:'第1首歌名'}).fill('留下的歌曲');
  await music.getByRole('textbox',{name:'第1首歌手'}).fill('确认的歌手');
  await music.screenshot({path:out+'/music-confirm-390.png'});
  await music.getByRole('button',{name:'确认导入',exact:true}).click();
  await music.getByRole('dialog',{name:'确认批量歌曲'}).waitFor({state:'hidden'});
  await music.goto(musicUrl+'?playlists');
  await music.getByRole('button',{name:'展开歌单 测试歌单'}).click();
  const track=music.getByRole('button',{name:'播放 留下的歌曲',exact:true});
  await track.waitFor();
  assert.equal(await music.getByRole('button',{name:'播放 one',exact:true}).count(),0);
  const box=await track.boundingBox();
  await music.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await music.mouse.down();
  await music.getByRole('dialog',{name:'歌曲操作'}).waitFor();
  await music.mouse.up();
  assert.equal(await music.locator('[data-play-count]').getAttribute('data-play-count'),'0');
  await music.getByRole('button',{name:'删除歌曲',exact:true}).click();
  await track.waitFor({state:'hidden'});
  await music.reload();
  await music.getByRole('button',{name:'展开歌单 测试歌单'}).click();
  assert.equal(await music.getByRole('button',{name:'播放 留下的歌曲',exact:true}).count(),0);
  await music.setViewportSize({width:320,height:740});
  await music.screenshot({path:out+'/music-playlist-320.png'});
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
