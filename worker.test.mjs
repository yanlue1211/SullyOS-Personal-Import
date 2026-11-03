import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './worker.mjs';
const env = { AUTH_TOKEN: 'test-only-token-abcdefghijklmnopqrstuvwxyz', APP_ORIGIN: 'https://yanlue1211.github.io' };
const cookie = 'session=private-test-cookie';
const req = (path = '/probe/balance', headers = {}, method = 'POST') => new Request('https://probe.example' + path, { method, headers: { Authorization: 'Bearer ' + env.AUTH_TOKEN, 'X-Haimian-Cookie': cookie, ...headers } });
test('missing secret, wrong auth, foreign origin, unknown route never reach upstream', async () => {
  const never = () => { throw Error('must not reach upstream'); };
  assert.equal((await handle(req(), {}, never)).status, 503);
  assert.equal((await handle(req(undefined, { Authorization: 'bad' }), env, never)).status, 401);
  assert.equal((await handle(req(undefined, { Origin: 'https://evil.example' }), env, never)).status, 403);
  for (const path of ['/probe/balance?target=https://evil.example', '/generate/music', '/probe/__proto__']) assert.equal((await handle(req(path), env, never)).status, 404);
});
test('only fixed read-only upstream and minimal headers; credentials redacted', async () => {
  for (const [route, suffix] of [['balance', 'credit/balance'], ['voices', 'generate/me/voices']]) {
    const r = await handle(req('/probe/' + route, { Origin: env.APP_ORIGIN }), env, async (url, opts) => {
      const target = new URL(url);
      assert.equal(target.origin + target.pathname, 'https://www.haimian.com/jd/api/v1/' + suffix);
      assert.equal(target.searchParams.has('msToken'), false);
      assert.equal(target.searchParams.has('a_bogus'), false);
      assert.equal(target.searchParams.has('official_uid'), false);
      if (route === 'balance') {
        assert.equal(target.searchParams.get('aid'), '588628');
        assert.equal(target.searchParams.get('device_platform'), 'web');
      } else assert.equal(target.search, '');
      assert.equal(opts.method, 'GET'); assert.equal(opts.redirect, 'manual');
      assert.deepEqual(opts.headers, { Cookie: cookie, Accept: 'application/json' });
      return Response.json({ nested: { access_token: 'private', detail: cookie + env.AUTH_TOKEN }, balance: 123 });
    });
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), env.APP_ORIGIN);
    const text = await r.text(); assert.ok(!text.includes(cookie)); assert.ok(!text.includes(env.AUTH_TOKEN)); assert.ok(!text.includes('"private"')); assert.ok(text.includes('123'));
  }
});
test('redirects, HTML login walls, malformed JSON and large responses fail closed', async () => {
  for (const response of [new Response(null, {status:302,headers:{Location:'https://evil.example'}}), new Response('<html>login</html>'), new Response('{', {headers:{'Content-Type':'application/json'}}), new Response('x'.repeat(1048577), {headers:{'Content-Type':'application/json'}})]) {
    assert.equal((await handle(req(), env, async () => response)).status, 502);
  }
});
test('public page contains no credentials; preflight permits only read probe requests', async () => {
  const page = await handle(new Request('https://probe.example/'), env);
  assert.equal(page.status, 200); assert.ok(!(await page.text()).includes(env.AUTH_TOKEN));
  const preflight = await handle(req('/probe/voices', {Origin:env.APP_ORIGIN}, 'OPTIONS'), env);
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST');
  assert.equal((await handle(req('/probe/voices', {}, 'GET'), env)).status, 405);
  assert.equal((await handle(req('/probe/voices', {'X-Haimian-Cookie':''}), env)).status, 400);
});

test('empty stream POST is accepted, nonempty body never reaches upstream', async () => {
  const make = body => new Request('https://probe.example/probe/balance', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.AUTH_TOKEN, 'X-Haimian-Cookie': cookie }, body, duplex: 'half'
  });
  const empty = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(0)); c.close(); } });
  let calls = 0;
  const upstream = async () => { calls++; return Response.json({ balance: 1 }); };
  assert.equal((await handle(make(empty), env, upstream)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await handle(make('x'), env, upstream)).status, 400);
  assert.equal(calls, 1);
});

test('Cloudflare entry does not treat ExecutionContext as upstream fetch', async () => {
  const { default: worker } = await import('./worker.mjs');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ balance: 1 }); };
  try {
    const response = await worker.fetch(req(), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
