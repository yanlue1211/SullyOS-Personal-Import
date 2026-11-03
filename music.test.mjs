import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDraft, musicOperation, handleMusic } from './music.mjs';
const cookie = 'session=fake-test-only';
const env = { AUTH_TOKEN: 'x'.repeat(32) };
test('draft adds isolated nodes with exact lyric binding, no deletes or layout', () => {
  const d = buildDraft('123', '4', '测试歌词', '456', ['11','12','13','14']);
  assert.equal(d.upsert_nodes[1].generation_config.params.voice_id, '456');
  assert.equal(d.upsert_connections[0].mappings[0].target_key, 'prompt');
  assert.equal(d.upsert_contents[0].text, '测试歌词');
  assert.equal(d.layout, undefined);
  assert.deepEqual(d.delete_node_ids, []);
  assert.throws(() => buildDraft('https://evil', '4', 'x', '456', ['11','12','13','14']));
});
test('prepare reads revision and adds draft, never generates; generate is one explicit request', async () => {
  const calls = [];
  const mock = async (url, opts) => {
    const u = new URL(url); calls.push({u,opts});
    assert.equal(u.origin, 'https://www.haimian.com');
    assert.equal(u.searchParams.get('app_id'), '588628');
    assert.equal(opts.headers.Cookie, cookie);
    assert.equal(opts.redirect, 'manual');
    const data = u.pathname.endsWith('/get') ? { revision:'4' } : {revision:'5'};
    return Response.json({ status_code:0, data });
  };
  const d = await musicOperation('prepare', {canvasId:'123',voiceId:'456',lyrics:'测试'},cookie,mock);
  assert.equal(d.prepared.revision,'5'); assert.equal(calls.length,2);
  assert.ok(calls.every(c=>!c.u.pathname.includes('generation_tasks')));
  let attempts=0;
  await assert.rejects(musicOperation('generate',{...d.prepared,confirmSpend:true},cookie,async()=>{attempts++;throw Error('timeout')}));
  assert.equal(attempts,1);
  await assert.rejects(musicOperation('generate',{...d.prepared},cookie,mock),/invalid_input/);
});
test('status follows canvas output reference, not canvas status alone; download allows fixed media hosts', async () => {
  const paths=[];
  const mock=async(url)=>{const p=new URL(url).pathname;paths.push(p);return Response.json({status_code:0,data:p.includes('generation_tasks')?{task:{status:0,output_contents:[{ref:{ref_type:'song',song_task_id:'testTask'}}],deducted_credit:5}}:{status:2,payload:JSON.stringify({title:'测试',progress:100}),deducted_credit:5}})};
  const d=await musicOperation('status',{generationTaskId:'123'},cookie,mock);
  assert.equal(d.state,'complete');assert.equal(d.songTaskId,'testTask');assert.equal(paths.length,2);
  for(const url of ['https://evil.example/audio.mp3','https://haimianyinyue.com.evil.example/x','http://v3-swing.haimianyinyue.com/x'])
    await assert.rejects(musicOperation('download',{songTaskId:'testTask'},cookie,async()=>Response.json({status_code:0,data:{video_info:{origin_video_url:url}}})),/unsupported_media_url/);
  const media=await musicOperation('download',{songTaskId:'testTask'},cookie,async()=>Response.json({status_code:0,data:{video_info:{origin_video_url:'https://v3-swing.haimianyinyue.com/audio.mp3'}}}));
  assert.ok(media.mediaUrl.endsWith('audio.mp3'));
});
test('auth, origin, invalid input and business errors fail without leaking credentials', async()=>{
  let calls=0;const never=async()=>{calls++;throw Error(cookie)};
  const req=(body,headers={})=>new Request('https://probe.example/music/generate',{method:'POST',headers:{Authorization:'Bearer '+env.AUTH_TOKEN,'X-Haimian-Cookie':cookie,...headers},body:JSON.stringify(body)});
  assert.equal((await handleMusic(req({},{Authorization:'wrong'}),env,never)).status,401);
  assert.equal((await handleMusic(req({},{Origin:'https://evil.example'}),env,never)).status,403);
  assert.equal((await handleMusic(req({}),env,never)).status,400);assert.equal(calls,0);
  const r=await handleMusic(req({canvasId:'123',revision:'4',nodeId:'12',confirmSpend:true}),env,never);
  assert.equal(calls,1);assert.ok(!(await r.text()).includes(cookie));
  await assert.rejects(musicOperation('generate',{canvasId:'123',revision:'4',nodeId:'12',confirmSpend:true},cookie,async()=>Response.json({status_code:10,status_info:{status_msg:cookie}})),/upstream_business_error/);
});
