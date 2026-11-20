import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.NOVEL_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({
    executablePath: process.env.NOVEL_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox'],
});
const origin = process.env.NOVEL_TEST_ORIGIN || 'http://127.0.0.1:5183';

try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.setDefaultTimeout(20_000);
    const requests = [];
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/novel-test-*/v1/chat/completions', route => {
        const body = route.request().postDataJSON();
        requests.push(body);
        if (body.model === 'mock-summary') {
            return route.fulfill({ status: 503, json: { error: { message: '预期的副 API 故障' } } });
        }
        const chunk = JSON.stringify({ choices: [{ delta: { content: '{"bookMeta":{"title":"海底来信","summary":"一场人鱼的冒险"},"writer":{"content":"模拟正文\u3002' } }] });
        return route.fulfill({ contentType: 'text/event-stream', body: `data: ${chunk}\n\n` });
    });

    await page.goto(`${origin}/test/fixtures/novel-upgrade.html`);
    assert.equal(await page.getByTitle('结束本章').count(), 0);
    const send = page.getByRole('button', { name: '发送创作任务' });
    await send.click();
    await page.getByText('模拟正文。', { exact: true }).waitFor();
    await page.getByText('海底来信', { exact: true }).waitFor().catch(async error => {
        console.log('DEBUG: first novel state:', (await page.locator('body').innerText()).slice(0, 1600));
        console.log('DEBUG: model request count:', requests.length, 'page errors:', pageErrors);
        throw error;
    });
    assert.equal(await page.getByTestId('novel-book-summary').textContent(), '一场人鱼的冒险');
    assert.deepEqual(requests.map(request => request.model), ['mock-main']);
    assert.match(JSON.stringify(requests[0].messages), /bookMeta/);
    assert.equal(requests[0].stream, true);
    assert.match(JSON.stringify(requests[0].messages), /描述偏向.*视角人物/);
    assert.match(JSON.stringify(requests[0].messages), /测试用户.*人称偏好为第三人称/);
    assert.match(JSON.stringify(requests[0].messages), /20000 字/);

    await page.getByRole('button', { name: '续写正文' }).click();
    await page.getByRole('button', { name: '写入正文' }).click();
    await page.getByPlaceholder('输入要写入小说的正文…').fill('亲手写的句子');
    await send.click();
    await page.getByText('亲手写的句子', { exact: true }).waitFor();
    assert.equal(requests.length, 1);

    await page.getByRole('button', { name: '完结作品', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '503' }).waitFor();
    assert.deepEqual(requests.map(request => request.model), ['mock-main', 'mock-summary']);
    await page.getByRole('dialog').locator('textarea').fill('手动总结。');
    await page.getByRole('button', { name: '确认完结' }).click();
    await page.getByRole('button', { name: '重新开启作品' }).waitFor();
    await page.getByRole('button', { name: '纯正文阅读' }).click();
    await page.getByText('亲手写的句子', { exact: true }).waitFor();

    await page.goto(`${origin}/test/fixtures/novel-upgrade.html?chapters`);
    await send.click();
    await page.getByText('模拟正文。', { exact: true }).waitFor();
    const characterRequest = JSON.stringify(requests[2].messages);
    const characterPrompt = requests[2].messages.map(message => message.content).join('\n');
    assert.match(characterPrompt, /"bookMeta": \{ "summary"/);
    assert.doesNotMatch(characterPrompt, /"bookMeta": \{ "title"/);
    assert.match(characterRequest, /WORLD_ENABLED/);
    assert.match(characterRequest, /WORLD_CAST_ONLY/);
    assert.match(characterRequest, /GUEST_CARD_CORE/);
    assert.match(characterRequest, /作者核心人物卡/);
    assert.match(characterRequest, /本作品中对应的剧中人：客串人物别名/);
    assert.match(characterRequest, /本作品的身份、经历与世界背景以本作品设定及剧情为准/);
    assert.doesNotMatch(characterRequest, /ONLY_USER_REMARK/);
    assert.doesNotMatch(characterRequest, /WORLD_DISABLED/);
    assert.match(characterRequest, /幕后编辑指令/);
    assert.doesNotMatch(characterRequest, /合作撰写小说/);
    await page.goto(`${origin}/test/fixtures/novel-upgrade.html`);
    await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.fetch = (url, init) => {
            if (!String(url).includes('/novel-test-main/v1/chat/completions')) return originalFetch(url, init);
            const encoder = new TextEncoder();
            const event = content => encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
            const body = Array.from({ length: 80 }, (_, index) => `流式正文第 ${index + 1} 段。`).join('\n\n');
            const json = JSON.stringify({ writer: { content: body } });
            return Promise.resolve(new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(event(json.slice(0, -3)));
                    window.finishNovelTestStream = () => {
                        controller.enqueue(event(json.slice(-3)));
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    };
                },
            }), { headers: { 'Content-Type': 'text/event-stream' } }));
        };
    });
    await page.addStyleTag({ content: 'div.overflow-y-auto:has(> [data-novel-block]) { height: 420px; overflow-y: auto; }' });
    await send.click();
    const firstParagraph = page.getByText('流式正文第 1 段。', { exact: true });
    await firstParagraph.waitFor();
    assert.equal(await page.getByText('提笔写下新的开始...', { exact: true }).count(), 0);
    const novelScroll = page.locator('div.overflow-y-auto').filter({ has: firstParagraph }).last();
    const readingPosition = await novelScroll.evaluate(node => {
        node.scrollTop = 500;
        node.dispatchEvent(new Event('scroll'));
        return node.scrollTop;
    });
    assert.ok(readingPosition >= 490, 'Fixture must have a scrollable reading area');
    const previewNode = await firstParagraph.elementHandle();
    await page.evaluate(() => window.finishNovelTestStream());
    await page.waitForFunction(() => !document.querySelector('[aria-label="发送创作任务"]')?.disabled);
    assert.ok(await previewNode.evaluate(node => node.isConnected));
    assert.ok(Math.abs(await novelScroll.evaluate(node => node.scrollTop) - readingPosition) < 15);
    await page.getByLabel('正文字号').selectOption('3');
    assert.equal(await firstParagraph.evaluate(node => getComputedStyle(node).fontSize), '23px');
    await page.getByRole('button', { name: '纯正文阅读' }).click();
    assert.equal(await firstParagraph.evaluate(node => getComputedStyle(node).fontSize), '23px');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 TXT' }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.txt$/);
    assert.match(await readFile(await download.path(), 'utf8'), /流式正文第 1 段。[\s\S]*流式正文第 80 段。/);
    assert.deepEqual(pageErrors, []);
    console.log('PASS: mobile writer, one main call, truncated stream recovery, local input, single-work completion, summary failure without fallback, and worldbook selection');
} finally {
    await browser.close();
}
