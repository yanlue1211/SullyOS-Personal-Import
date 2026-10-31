import { describe, expect, it } from 'vitest';
import { buildWorkroomDocument, readWorkroomRpc, WORKROOM_CSP, WORKROOM_SANDBOX } from '../features/workroom/runner';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');

describe('造物间沙盒协议', () => {
    it('宿主先写 CSP 与接口引导，再装载作品，不附带同源或宿主能力', () => {
        const doc = buildWorkroomDocument({ html: '<p>游戏</p>', css: 'p{color:blue}', js: 'document.title="dog"' }, 'test-session');
        expect(WORKROOM_SANDBOX).toBe('allow-scripts');
        expect(WORKROOM_CSP).toContain("connect-src 'none'");
        expect(WORKROOM_CSP).toContain("frame-src 'none'");
        expect(WORKROOM_CSP).toContain("base-uri 'none'");
        expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<p>游戏</p>'));
        expect(doc.indexOf('Object.defineProperty')).toBeLessThan(doc.indexOf('<p>游戏</p>'));
        expect(doc).not.toContain('allow-same-origin');
        expect(doc).not.toContain('apiKey');
    });
    it('仅允许受限 RPC，循环对象、未知方法和超限内容被拒绝', () => {
        expect(readWorkroomRpc({ id: '1', method: 'loadState', args: [] })).toEqual({ id: '1', method: 'loadState', args: [] });
        for (const method of ['fetch', 'getAllCharacters', '__proto__', 'publish', 'eval']) {
            expect(readWorkroomRpc({ id: '1', method, args: [] })).toBeUndefined();
        }
        expect(readWorkroomRpc({ id: '1', method: 'saveState', args: ['a'.repeat(270001)] })).toBeUndefined();
        const circular: any = { id: '1', method: 'saveState', args: [] }; circular.args.push(circular);
        expect(readWorkroomRpc(circular)).toBeUndefined();
    });
    it('引导脚本定义异步 API，拒绝来自非父窗口的初始化消息', async () => {
        const dom = new JSDOM(buildWorkroomDocument({ html: '', css: '', js: '' }, '</script>test'), { runScripts: 'dangerously', url: 'https://sandbox.invalid' });
        const window = dom.window as any;
        expect(Object.keys(window.workroom)).toEqual(['loadState', 'saveState', 'emitEvent', 'generate', 'registerActions', 'notify', 'requestUpdate']);
        expect(Object.isFrozen(window.workroom)).toBe(true);
        const sent: any[] = [];
        const port = { postMessage: (v: unknown) => sent.push(v), onmessage: undefined as any };
        const pending = window.workroom.loadState();
        window.dispatchEvent(new window.MessageEvent('message', { source: null, data: { workroomSession: '</script>test' }, ports: [port] }));
        expect(sent).toHaveLength(0);
        window.dispatchEvent(new window.MessageEvent('message', { source: window.parent, data: { workroomSession: '</script>test' }, ports: [port] }));
        expect(sent).toHaveLength(1);
        port.onmessage({ data: { id: sent[0].id, ok: true, value: { level: 3 } } });
        expect(await pending).toEqual({ level: 3 });
        window.close();
    });
});
