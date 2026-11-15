// Temporary upload credentials stay inside this request. No captured identifiers.
const enc = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const hash = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const hmac = async (key, value) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, {name:'HMAC',hash:'SHA-256'}, false, ['sign']), enc.encode(value));
const escape = s => encodeURIComponent(s).replace(/[!'()*]/g, c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export async function signedVod(method, params, body, token, now = new Date()) {
 const query=Object.keys(params).sort().map(k=>escape(k)+'='+escape(String(params[k]))).join('&');
 const date=now.toISOString().replace(/[:-]|\.\d{3}/g,''); const day=date.slice(0,8);
 const digest=await hash(body); const scope=day+'/cn-north-1/vod/aws4_request';
 const headers={'x-amz-date':date,'x-amz-security-token':token.auth_token};
 if(method==='POST')headers['x-amz-content-sha256']=digest;
 const keys=Object.keys(headers).sort(); const signed=keys.join(';');
 const canonical=[method,'/',query,keys.map(k=>k+':'+headers[k].trim()+'\n').join(''),signed,digest].join('\n');
 let key=await hmac('AWS4'+token.secret_key,day);
 for(const value of ['cn-north-1','vod','aws4_request'])key=await hmac(key,value);
 const signature=hex(await hmac(key,'AWS4-HMAC-SHA256\n'+date+'\n'+scope+'\n'+await hash(canonical)));
 headers.Authorization='AWS4-HMAC-SHA256 Credential='+token.access_key+'/'+scope+', SignedHeaders='+signed+', Signature='+signature;
 if(method==='POST')headers['Content-Type']='text/plain;charset=UTF-8';
 return {url:'https://vod.bytedanceapi.com/?'+query,options:{method,headers,redirect:'manual',signal:AbortSignal.timeout(30000),...(method==='POST'?{body}:{})}};
}
export function crc32(bytes) { let c=0xffffffff; for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return ((c^0xffffffff)>>>0).toString(16).padStart(8,'0'); }
async function jsonResponse(response) {
 if(!response.ok)throw Error('upstream_http_error');
 // Upload responses must stay bounded too.
 const reader=response.body.getReader();let text='',size=0;const decoder=new TextDecoder();
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>1048576){await reader.cancel();throw Error('payload_too_large')}text+=decoder.decode(r.value,{stream:true});}}finally{reader.releaseLock()}
 try{return JSON.parse(text+decoder.decode())}catch{throw Error('upstream_invalid_response')}
}
export async function uploadVoice(input, api, upstreamFetch) {
 if(input.confirmUpload!==true || typeof input.audioBase64!=='string' || input.audioBase64.length>11200000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioBase64) || typeof input.lyrics!=='string' || !input.lyrics.trim() || input.lyrics.length>3000)throw Error('invalid_input');
 let bytes;try{bytes=Uint8Array.from(atob(input.audioBase64),c=>c.charCodeAt(0))}catch{throw Error('invalid_input')}
 if(bytes.length<1000 || bytes.length>8*1024*1024)throw Error('invalid_input');
 const token=await api('/jd/api/v1/video/get_auth_token',{},{});
 if(!token.access_key||!token.secret_key||!token.auth_token)throw Error('upstream_invalid_response');
 async function vod(method,params,body='') {const r=await signedVod(method,params,body,token);const d=await jsonResponse(await upstreamFetch(r.url,r.options));if(d.ResponseMetadata?.Error)throw Error('upstream_http_error');return d.Result;}
 const apply=await vod('GET',{Action:'ApplyUploadInner',Version:'2020-11-19',SpaceName:'jd_video_play',FileType:'video',IsInner:'1',FileSize:bytes.length,s:crypto.randomUUID().replaceAll('-','').slice(0,11)});
 const node=apply?.InnerUploadAddress?.UploadNodes?.[0];const store=node?.StoreInfos?.[0];
 if(!node||!store||typeof node.UploadHost!=='string'||typeof store.StoreUri!=='string'||!store.Auth||!node.SessionKey)throw Error('upstream_invalid_response');
 const host=node.UploadHost;
 if(!/^[a-z0-9.-]+$/.test(host)||!host.endsWith('.snssdk.com')||!/^tos-[a-z0-9.-]+$/.test(host)||store.StoreUri.startsWith('/')||store.StoreUri.includes('..')||/[?#]/.test(store.StoreUri))throw Error('unsupported_media_url');
 const uploaded=await jsonResponse(await upstreamFetch('https://'+host+'/upload/v1/'+store.StoreUri,{method:'POST',headers:{Authorization:store.Auth,'Content-Type':'application/octet-stream','Content-CRC32':crc32(bytes)},body:bytes,redirect:'manual',signal:AbortSignal.timeout(60000)}));
 if(uploaded.code!==2000)throw Error('upstream_http_error');
 const committed=await vod('POST',{Action:'CommitUploadInner',Version:'2020-11-19',SpaceName:'jd_video_play'},JSON.stringify({SessionKey:node.SessionKey,Functions:[{name:'GetMeta'}]}));
 const vid=committed?.Results?.[0]?.Vid;
 if(typeof vid!=='string'||!vid)throw Error('upstream_invalid_response');
 // Match successful browser recording source=0, not the tutorial's adaptation source=2.
 const d=await api('/jd/api/v1/generate/voice/register',{}, {lyrics:input.lyrics,vid,source:0});
 if(!Number.isSafeInteger(d.voice_id))throw Error('upstream_invalid_response');
 return {voiceId:String(d.voice_id),state:'processing',note:'音色已提交，保存音色 ID 后查询处理状态；请勿重复上传。'};
}
