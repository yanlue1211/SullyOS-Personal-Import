import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.NOVEL_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({
    executablePath: process.env.NOVEL_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox'],
});
const origin = process.env.NOVEL_TEST_ORIGIN || 'http://127.0.0.1:5183';

try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const requests = [];
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/novel-test-*/v1/chat/completions', route => {
        const body = route.request().postDataJSON();
        requests.push(body);
        if (body.model === 'mock-summary') {
            return route.fulfill({ status: 503, json: { error: { message: '预期的副 API 故障' } } });
        }
        const chunk = JSON.stringify({ choices: [{ delta: { content: '{"writer":{"content":"模拟正文\u3002' } }] });
        return route.fulfill({ contentType: 'text/event-stream', body: `data: ${chunk}\n\n` });
    });

    await page.goto(`${origin}/test/fixtures/novel-upgrade.html`);
    assert.equal(await page.getByTitle('结束本章').count(), 0);
    const send = page.getByRole('button', { name: '发送创作任务' });
    await send.click();
    await page.getByText('模拟正文。', { exact: true }).waitFor();
    assert.deepEqual(requests.map(request => request.model), ['mock-main']);
    assert.equal(requests[0].stream, true);
    assert.match(JSON.stringify(requests[0].messages), /描述偏向.*视角人物/);
    assert.match(JSON.stringify(requests[0].messages), /正文默认用第三人称/);
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
    assert.match(characterRequest, /WORLD_ENABLED/);
    assert.doesNotMatch(characterRequest, /WORLD_DISABLED/);
    assert.match(characterRequest, /幕后编辑指令/);
    assert.doesNotMatch(characterRequest, /合作撰写小说/);
    assert.deepEqual(pageErrors, []);
    console.log('PASS: mobile writer, one main call, truncated stream recovery, local input, single-work completion, summary failure without fallback, and worldbook selection');
} finally {
    await browser.close();
}
