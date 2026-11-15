import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {uploadVoice,crc32,signedVod} from './voice.mjs';
globalThis.crypto ||= webcrypto;
test('CRC and signed VOD requests use temporary credentials and deterministic scope',async()=>{
 assert.equal(crc32(new TextEncoder().encode('123456789')),'cbf43926');
 const r=await signedVod('GET',{Version:'2020-11-19',Action:'ApplyUploadInner'},'',{access_key:'fake-access',secret_key:'fake-secret',auth_token:'fake-token'},new Date('2026-11-15T12:00:00Z'));
 assert.ok(r.options.headers.Authorization.includes('20261115/cn-north-1/vod/aws4_request'));
 assert.equal(r.options.headers['x-amz-date'],'20261115T120000Z');assert.equal(r.options.redirect,'manual');assert.ok(!r.url.includes('fake-secret'));
});
test('voice upload follows authorization, upload, commit, register once; no Cookie on storage',async()=>{
 const calls=[];const bytes=new Uint8Array(1000);const input={audioBase64:Buffer.from(bytes).toString('base64'),lyrics:'测试朗读',confirmUpload:true};
 const api=async(path,params,body)=>{calls.push(path);if(path.endsWith('get_auth_token'))return {access_key:'fake-key',secret_key:'fake-secret',auth_token:'fake-token'};assert.deepEqual(body,{lyrics:'测试朗读',vid:'fakeVid',source:0});return {voice_id:123};};
 const fetcher=async(url,opts)=>{calls.push(new URL(url).hostname);assert.equal(opts.headers.Cookie,undefined);if(new URL(url).searchParams.get('Action')==='ApplyUploadInner')return Response.json({Result:{InnerUploadAddress:{UploadNodes:[{SessionKey:'fake-session',UploadHost:'tos-test.snssdk.com',StoreInfos:[{StoreUri:'test/audio',Auth:'fake-storage'}]}]}}});if(new URL(url).hostname==='tos-test.snssdk.com'){assert.equal(opts.body.length,1000);return Response.json({code:2000})}assert.deepEqual(JSON.parse(opts.body),{SessionKey:'fake-session',Functions:[{name:'GetMeta'}]});return Response.json({Result:{Results:[{Vid:'fakeVid'}]}})};
 const d=await uploadVoice(input,api,fetcher);assert.equal(d.voiceId,'123');assert.equal(calls.length,5);
 let attempts=0;await assert.rejects(uploadVoice(input,api,async()=>{attempts++;throw Error('timeout')}));assert.equal(attempts,1);
 await assert.rejects(uploadVoice({...input,confirmUpload:false},()=>{throw Error('must not call')},fetcher),/invalid_input/);
});
test('untrusted upload hosts are rejected before sending audio',async()=>{
 const api=async()=>({access_key:'fake',secret_key:'fake',auth_token:'fake'});let calls=0;
 await assert.rejects(uploadVoice({audioBase64:Buffer.alloc(1000).toString('base64'),lyrics:'测试',confirmUpload:true},api,async()=>{calls++;return Response.json({Result:{InnerUploadAddress:{UploadNodes:[{SessionKey:'s',UploadHost:'evil.example',StoreInfos:[{StoreUri:'x',Auth:'a'}]}]}}})}),/unsupported_media_url/);assert.equal(calls,1);
});
test('voice routes require authorization and return training state without payload',async()=>{
 const {handleMusic}=await import('./music.mjs');const env={AUTH_TOKEN:'x'.repeat(32)};
 const request=(auth)=>new Request('https://test/music/voice-status',{method:'POST',headers:{Authorization:auth,'X-Haimian-Cookie':'session=fake'},body:JSON.stringify({voiceId:'123'})});
 let calls=0;const upstream=async()=>{calls++;return Response.json({status_code:0,data:{status:2,payload:'private'}})};
 assert.equal((await handleMusic(request('wrong'),env,upstream)).status,401);assert.equal(calls,0);
 const r=await handleMusic(request('Bearer '+env.AUTH_TOKEN),env,upstream);assert.deepEqual(await r.json(),{voiceId:'123',state:'ready'});assert.equal(calls,1);
});
test('official storage address variants normalize without allowing other domains',async()=>{
 const {voiceUploadUrl}=await import('./voice.mjs');
 for(const host of ['tos-d-ct-hl.snssdk.com','https://tos-d-ct-hl.snssdk.com','tos-d-ct-hl.snssdk.com:443'])assert.equal(voiceUploadUrl(host,'/tos-cn-v-test/fakeKey'),'https://tos-d-ct-hl.snssdk.com/upload/v1/tos-cn-v-test/fakeKey');
 for(const host of ['https://evil.example','tos-test.snssdk.com.evil.example','https://u:p@tos-test.snssdk.com','http://tos-test.snssdk.com'])assert.throws(()=>voiceUploadUrl(host,'tos-cn-v-test/fakeKey'),e=>e.safeToRetry&&e.message==='unsupported_media_url');
});
