// Independent, read-only Haimian connectivity probe. No database or cron.
const ROUTES = {
  '/probe/balance': '/jd/api/v1/credit/balance',
  '/probe/voices': '/jd/api/v1/generate/me/voices',
};
const PAGE = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>糯米 · 海绵连接测试</title><style>body{margin:0;background:#edf7f3;color:#284d49;font:16px system-ui}main{max-width:560px;margin:32px auto;padding:24px;background:white;border-radius:24px}input,button{box-sizing:border-box;width:100%;padding:14px;margin:8px 0;border:1px solid #add4cc;border-radius:12px;font:inherit}button{background:#d7eee7;color:#234d47}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5fb;padding:16px;border-radius:12px}small{line-height:1.7;display:block}</style><main><h2>潮汐正在寻找你的声音</h2><p>海绵音乐 · 只读连接测试</p><small>只查询额度与音色列表，不生成歌曲，不克隆音色。凭证仅用于本次请求，不写入浏览器存储；测试后清空。此页不代表海绵已接通。</small><label>专用连接密钥<input id="token" type="password" autocomplete="off"></label><label>海绵 Cookie<input id="cookie" type="password" autocomplete="off" spellcheck="false"></label><button id="balance">测试额度查询</button><button id="voices">测试音色列表</button><button id="clear">清空凭证</button><pre id="result">等待测试</pre><small>不要把 Cookie 发到聊天或 GitHub。不要将本 Worker 地址填入糯米机的全局代理。</small></main><script type="module">const token=document.querySelector('#token'),cookie=document.querySelector('#cookie'),result=document.querySelector('#result');let busy=false;for(const kind of ['balance','voices'])document.querySelector('#'+kind).onclick=async()=>{if(busy)return;busy=true;result.textContent='正在查询…';try{const r=await fetch('/probe/'+kind,{method:'POST',headers:{'Authorization':'Bearer '+token.value,'X-Haimian-Cookie':cookie.value},cache:'no-store'});const data=await r.json();result.textContent=JSON.stringify(data,null,2)}catch{result.textContent='连接失败，请检查网络和部署配置。'}finally{busy=false}};document.querySelector('#clear').onclick=()=>{token.value='';cookie.value='';result.textContent='已清空'};window.addEventListener('pagehide',()=>{token.value='';cookie.value=''})</script></html>`;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...extra,
  } });
}

// Never send credential-shaped fields back to the browser or diagnostics.
function redact(value, cookie, token) {
  if (typeof value === 'string') return value.split(cookie).join('[redacted]').split(token).join('[redacted]');
  if (Array.isArray(value)) return value.map(v => redact(v, cookie, token));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, /cookie|token|authorization|secret|session/i.test(k) ? '[redacted]' : redact(v, cookie, token)]));
  return value;
}

export async function handle(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  // The built-in test page is same-origin. Optionally permit the personal app.
  const allowed = origin && (origin === url.origin || origin === env.APP_ORIGIN);
  if (origin && !allowed) return json({ error: 'origin_denied' }, 403);
  const cors = allowed ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
  const reply = (body, status = 200) => json(body, status, cors);
  if (request.method === 'GET' && url.pathname === '/') return new Response(PAGE, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  } });
  if (!Object.hasOwn(ROUTES, url.pathname) || url.search) return reply({ error: 'route_not_found' }, 404);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    ...cors, 'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Authorization, X-Haimian-Cookie',
    'Access-Control-Max-Age': '600',
  } });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (typeof env.AUTH_TOKEN !== 'string' || env.AUTH_TOKEN.length < 32) return reply({ error: 'configure_AUTH_TOKEN_secret_first' }, 503);
  if (request.headers.get('Authorization') !== `Bearer ${env.AUTH_TOKEN}`) return reply({ error: 'unauthorized' }, 401);
  const cookie = request.headers.get('X-Haimian-Cookie') || '';
  if (!cookie.trim() || cookie.length > 16000 || /[\r\n\x00]/.test(cookie)) return reply({ error: 'invalid_cookie' }, 400);
  if (request.body) { await request.body.cancel(); return reply({ error: 'body_not_allowed' }, 400); }
  try {
    const response = await upstreamFetch('https://www.haimian.com' + ROUTES[url.pathname], {
      method: 'GET', headers: { Cookie: cookie, Accept: 'application/json' },
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return reply({ error: 'upstream_redirect_refused' }, 502); }
    if (!response.headers.get('Content-Type')?.includes('application/json')) { await response.body?.cancel(); return reply({ error: 'upstream_not_json', upstreamStatus: response.status }, 502); }
    const reader = response.body?.getReader();
    if (!reader) return reply({ error: 'empty_upstream_response' }, 502);
    let size = 0; const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1048576) { await reader.cancel(); return reply({ error: 'upstream_response_too_large' }, 502); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    const data = redact(JSON.parse(new TextDecoder().decode(bytes)), cookie, env.AUTH_TOKEN);
    return reply({ verified: false, note: '请根据实际响应确认接口与登录态；HTTP 成功不代表业务成功。', upstreamStatus: response.status, data });
  } catch { return reply({ error: 'upstream_request_failed' }, 502); }
}

export default { fetch: handle };
