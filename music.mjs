// Existing-voice adapter. Fixed official endpoints; no captured credentials or IDs.
const META = { app_name: 'goat', app_name_cn: '海绵音乐', aid: '588628', app_id: '588628', region: 'CN', language: 'zh', app_version: '1.0.0.1667', channel: 'online', device_platform: 'web' };
const numeric = value => typeof value === 'string' && /^\d{1,24}$/.test(value);
const taskId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
function fail(code) { throw new Error(code); }
async function boundedText(body, limit) {
  if (!body) return '';
  const reader = body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail('payload_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
export function buildDraft(canvasId, revision, lyrics, voiceId, ids) {
  if (!numeric(canvasId) || !numeric(revision) || !numeric(voiceId) || !Array.isArray(ids) || ids.length !== 4 || !ids.every(numeric) || new Set(ids).size !== 4 || typeof lyrics !== 'string' || !lyrics.trim() || lyrics.length > 10000) fail('invalid_input');
  const [lyricNode, musicNode, contentId, connectionId] = ids;
  return { canvas_id: canvasId, base_revision: revision,
    upsert_nodes: [
      { node_id: lyricNode, data: { title: '糯米 · 歌词', primary_content_id: contentId, content_batches: [{ content_ids: [contentId] }] }, generation_config: { tool_key: 'lyrics.complete', params: { mode: 'complete', llm: 'Seed-2.1-Pro' }, parts: [] } },
      { node_id: musicNode, data: { title: '糯米 · 已有音色创作', content_batches: [] }, generation_config: { tool_key: 'music.generate', params: { batch_size: 1, voice_id: voiceId }, parts: [] } },
    ],
    upsert_connections: [{ connection_id: connectionId, source_node_id: lyricNode, target_node_id: musicNode, mappings: [{ source_content_id: contentId, target_key: 'prompt' }] }],
    upsert_contents: [{ content_id: contentId, media_type: 'text', usage_type: 'lyrics', name: '歌词', origin: 'authored', text: lyrics }],
    delete_node_ids: [], delete_connection_ids: [], delete_content_ids: [],
  };
}
function freshIds() {
  const base = BigInt(Date.now()) * 1000000n + BigInt(crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
  return [0n, 1n, 2n, 3n].map(n => String(base + n));
}
function safeMedia(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'haimianyinyue.com' || u.hostname.endsWith('.haimianyinyue.com')) ? u.href : null;
  } catch { return null; }
}
export async function musicOperation(action, input, cookie, upstreamFetch = fetch) {
  async function api(path, params = {}, body) {
    const u = new URL('https://www.haimian.com' + path);
    u.search = new URLSearchParams({ ...META, ...params }).toString();
    const response = await upstreamFetch(u.href, { method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Cookie: cookie, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) { await response.body?.cancel(); fail('upstream_http_error'); }
    let data; try { data = JSON.parse(await boundedText(response.body, 1048576)); } catch { fail('upstream_invalid_response'); }
    if (data.status_code !== 0) fail('upstream_business_error');
    if (!data.data || typeof data.data !== 'object') fail('upstream_invalid_response');
    return data.data;
  }
  if (action === 'prepare') {
    if (!numeric(input.canvasId) || !numeric(input.voiceId) || typeof input.lyrics !== 'string' || !input.lyrics.trim() || input.lyrics.length > 10000) fail('invalid_input');
    const canvas = await api('/jd/api/v1/canvas/get', { canvas_id: input.canvasId, count: '200' });
    if (!numeric(String(canvas.revision))) fail('upstream_invalid_response');
    const ids = freshIds();
    const draft = buildDraft(input.canvasId, String(canvas.revision), input.lyrics, input.voiceId, ids);
    const applied = await api('/jd/api/v1/canvas/apply', {}, draft);
    if (!numeric(String(applied.revision))) fail('upstream_invalid_response');
    return { prepared: { canvasId: input.canvasId, revision: String(applied.revision), nodeId: ids[1] }, note: '已在所选画布新增独立歌词和音乐节点，尚未提交生成。' };
  }
  if (action === 'generate') {
    if (input.confirmSpend !== true || !numeric(input.canvasId) || !numeric(input.revision) || !numeric(input.nodeId)) fail('invalid_input');
    // Deliberately one attempt: a timeout may still have created a billable task.
    const d = await api('/jd/api/v1/canvas/generation_tasks/create', {}, { canvas_id: input.canvasId, base_revision: input.revision, node_id: input.nodeId });
    if (!numeric(d.task?.generation_task_id)) fail('upstream_invalid_response');
    return { generationTaskId: d.task.generation_task_id };
  }
  if (action === 'status') {
    if (!numeric(input.generationTaskId)) fail('invalid_input');
    const d = await api('/jd/api/v1/canvas/generation_tasks/get', { generation_task_id: input.generationTaskId });
    const task = d.task;
    if (!task) fail('upstream_invalid_response');
    if (task.error_code) return { state: 'failed', errorCode: task.error_code };
    const ref = task.output_contents?.find(c => c.ref?.ref_type === 'song' && taskId(c.ref.song_task_id))?.ref;
    if (!ref) return { state: 'processing', deductedCredit: task.deducted_credit ?? null };
    const song = await api('/jd/api/v1/generate/task/' + ref.song_task_id);
    let payload = song.payload;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { fail('upstream_invalid_response'); } }
    return { state: song.status === 2 ? 'complete' : 'processing', songStatus: song.status, songTaskId: ref.song_task_id, deductedCredit: song.deducted_credit ?? task.deducted_credit ?? null, title: payload?.title || '', progress: payload?.progress ?? null };
  }
  if (action === 'download') {
    if (!taskId(input.songTaskId)) fail('invalid_input');
    const d = await api('/jd/api/v1/misc/download', {}, { task_id: input.songTaskId });
    const mediaUrl = safeMedia(d.video_info?.origin_video_url) || safeMedia(d.video_info?.transcoding_video_url);
    if (!mediaUrl) fail('unsupported_media_url');
    return { mediaUrl, expiresAt: d.video_info.expire_at ?? null };
  }
  fail('route_not_found');
}
export async function handleMusic(request, env, upstreamFetch = fetch) {
  const u = new URL(request.url); const origin = request.headers.get('Origin');
  const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  if (origin && origin !== u.origin) return reply({ error: 'origin_denied' }, 403);
  if (u.search) return reply({ error: 'route_not_found' }, 404);
  if (request.method === 'GET' && u.pathname === '/music') return new Response(MUSIC_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src https://*.haimianyinyue.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" } });
  const action = u.pathname.split('/')[2];
  if (!['prepare', 'generate', 'status', 'download'].includes(action) || u.pathname !== '/music/' + action) return reply({ error: 'route_not_found' }, 404);
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (typeof env.AUTH_TOKEN !== 'string' || env.AUTH_TOKEN.length < 32) return reply({ error: 'configure_AUTH_TOKEN_secret_first' }, 503);
  if (request.headers.get('Authorization') !== 'Bearer ' + env.AUTH_TOKEN) return reply({ error: 'unauthorized' }, 401);
  const cookie = request.headers.get('X-Haimian-Cookie') || '';
  if (!cookie.trim() || cookie.length > 16000 || /[\r\n\x00]/.test(cookie)) return reply({ error: 'invalid_cookie' }, 400);
  try {
    const input = JSON.parse(await boundedText(request.body, 48000));
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_input');
    return reply(await musicOperation(action, input, cookie, upstreamFetch));
  } catch (error) {
    const codes = ['invalid_input', 'payload_too_large', 'upstream_http_error', 'upstream_invalid_response', 'upstream_business_error', 'unsupported_media_url'];
    const code = codes.includes(error?.message) ? error.message : 'operation_failed';
    return reply({ error: code, ...(action === 'generate' ? { note: '生成请求可能已受理，请到海绵画布确认后再决定是否重新提交。' } : {}) }, ['invalid_input', 'payload_too_large'].includes(code) ? 400 : 502);
  }
}

const MUSIC_PAGE = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>糯米 · 已有音色创作</title>
<style>body{margin:0;background:#edf7f3;color:#284d49;font:16px system-ui}main{max-width:560px;margin:24px auto;padding:24px;background:white;border-radius:24px}input,textarea,select,button{box-sizing:border-box;width:100%;padding:13px;margin:8px 0 18px;border:1px solid #add4cc;border-radius:12px;font:inherit}button{background:#d7eee7;color:#234d47}button:disabled{opacity:.45}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5fb;padding:16px;border-radius:12px}small{display:block;line-height:1.7}audio{width:100%}a{color:#284d49}</style>
<main><h2>把歌词唱给你听</h2><p>已有音色 · 独立联调页</p><small>准备步骤会在指定的海绵画布新增歌词和音乐节点。点击提交生成会按海绵规则消耗积分；每次仅提交一首。本页尚待实际生成验证。凭证仅保留在本页内存。</small>
<label>专用连接密钥<input id="token" type="password" autocomplete="off"></label><label>海绵 Cookie<input id="cookie" type="password" autocomplete="off"></label>
<button id="load">读取积分与已有音色</button><p id="balance"></p><label>已有音色<select id="voice"><option value="">请先读取音色</option></select></label>
<label>海绵画布 ID<input id="canvas" inputmode="numeric" placeholder="填写专门用于测试的画布 ID"></label><small>可从官网画布链接或 canvas/get 请求的 canvas_id 查看；只新增独立节点。</small>
<label>歌词<textarea id="lyrics" rows="8" maxlength="10000" placeholder="粘贴完整歌词，可包含段落标记"></textarea></label>
<button id="prepare">准备歌词与音色（不提交生成）</button><button id="generate" disabled>确认消耗海绵积分，提交生成一首</button>
<label>生成任务 ID<input id="task" inputmode="numeric" placeholder="生成后自动填入，可自行保存以恢复查询"></label><button id="status">查询一次进度</button><button id="download" disabled>获取播放与下载地址</button>
<audio id="audio" controls hidden></audio><a id="link" target="_blank" rel="noreferrer" hidden>打开音频并下载</a><button id="clear">清空凭证</button><pre id="result">等待准备</pre></main>
<script type="module">
const $=id=>document.getElementById(id);let prepared=null,songTaskId=null,busy=false;
async function call(path,data){const r=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+$('token').value,'X-Haimian-Cookie':$('cookie').value,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),cache:'no-store'});const d=await r.json();if(!r.ok||d.error)throw Error(d.note||d.error||'请求失败');return d;}
function show(d){$('result').textContent=typeof d==='string'?d:JSON.stringify(d,null,2)}
function run(id,fn){$(id).onclick=async()=>{if(busy)return;busy=true;$(id).disabled=true;try{await fn()}catch(e){show(e.message)}finally{busy=false;if(id!=='generate')$(id).disabled=false}}}
run('load',async()=>{const b=await call('/probe/balance');if(b.data?.status_code!==0)throw Error('积分查询未成功');$('balance').textContent='当前积分：'+b.data.data.total_balance;const v=await call('/probe/voices');if(v.data?.status_code!==0)throw Error('音色查询未成功');$('voice').replaceChildren();const seen=new Set();for(const item of [...(v.data.data.voices||[]),...(v.data.data.campaign_voices||[])]){const id=String(item.id);if(seen.has(id))continue;seen.add(id);const o=document.createElement('option');o.value=id;o.textContent=item.title||id;$('voice').append(o)}show('读取成功，请填写画布 ID 和歌词。')});
for(const id of ['canvas','lyrics','voice'])$(id).oninput=()=>{prepared=null;$('generate').disabled=true};
run('prepare',async()=>{prepared=null;$('generate').disabled=true;const d=await call('/music/prepare',{canvasId:$('canvas').value.trim(),lyrics:$('lyrics').value,voiceId:$('voice').value});prepared=d.prepared;$('generate').disabled=false;show(d)});
run('generate',async()=>{if(!prepared)throw Error('请先准备歌词与音色');const draft=prepared;prepared=null;songTaskId=null;$('download').disabled=true;const d=await call('/music/generate',{...draft,confirmSpend:true});$('task').value=d.generationTaskId;show({...d,note:'请保存任务 ID，点击查询进度；请勿重复提交。'})});
$('task').oninput=()=>{songTaskId=null;$('download').disabled=true};
run('status',async()=>{songTaskId=null;$('download').disabled=true;const d=await call('/music/status',{generationTaskId:$('task').value.trim()});if(d.state==='complete'){songTaskId=d.songTaskId;$('download').disabled=false}show(d)});
run('download',async()=>{if(!songTaskId)throw Error('请先查询到生成完成');const d=await call('/music/download',{songTaskId});$('audio').src=d.mediaUrl;$('audio').hidden=false;$('link').href=d.mediaUrl;$('link').hidden=false;show('音频已就绪，点击播放；下载地址可能会过期。')});
function clear(){$('token').value='';$('cookie').value=''}$('clear').onclick=()=>{clear();show('凭证已清空')};window.addEventListener('pagehide',clear);
</script></html>`;
