import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.WORKROOM_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true});
/**
 * Deterministic audio fixture for the mobile smoke test.
 * The real jsDelivr file is sometimes unreachable from GitHub-hosted runners;
 * that is a network/CDN health concern, not a regression of the audio player.
 * A playable 5-second WAV exercises HTMLMediaElement playback and progress
 * without making this UI/layout regression depend on an external CDN.
 */
function makeSmokeAudio(){
 const rate=16000,seconds=5,frames=rate*seconds;
 const bytes=Buffer.alloc(44+frames*2);
 bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);
 bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
 bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
 bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);
 bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
 bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++){
  const gain=Math.min(1,i/800)*Math.min(1,(frames-i)/800);
  bytes.writeInt16LE(Math.round(3000*gain*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
 }
 return bytes;
}
const smokeAudio=makeSmokeAudio();
async function fulfillSmokeAudio(route){
 const range=route.request().headers().range;
 const match=/^bytes=(\d+)-(\d*)$/.exec(range||'');
 const start=match?Math.min(smokeAudio.length-1,Number(match[1])):0;
 const end=match&&match[2]?Math.min(smokeAudio.length-1,Number(match[2])):smokeAudio.length-1;
 const chunk=smokeAudio.subarray(start,Math.max(start,end)+1);
 await route.fulfill({
  status:match?206:200,
  contentType:'audio/wav',
  headers:{
   'access-control-allow-origin':'*',
   'accept-ranges':'bytes',
   'content-length':String(chunk.length),
   ...(match?{'content-range':'bytes '+start+'-'+Math.max(start,end)+'/'+smokeAudio.length}:{}),
  },
  body:chunk,
 });
}

await mkdir('test-results/personal-library',{recursive:true});
try{
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  await context.route('https://cdn.jsdelivr.net/gh/yanlue1211/yan@main/xiangsisuo.mp3', fulfillSmokeAudio);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4179/test/fixtures/personal-library.html');
  await page.getByLabel('歌曲音频链接').fill('https://cdn.jsdelivr.net/gh/yanlue1211/yan@main/xiangsisuo.mp3');await page.getByLabel('歌名',{exact:true}).fill('相思锁');await page.getByLabel('歌曲歌词').fill('[00:10.50]第一句\n[00:20.20]第二句');
  await page.getByRole('button',{name:'导入到本地歌曲',exact:true}).click();
  await page.getByRole('button',{name:'相思锁',exact:false}).waitFor();
  const assets=await page.evaluate(async()=>await window.__libraryQA.DB.getRawStoreData('assets'));if(assets.some(x=>String(x.id).startsWith('music-import-')))throw Error('链接导入落地了音频');
  await page.getByLabel('歌单名称').fill('我的晚安歌单');await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByLabel('选择歌单').locator('option',{hasText:'我的晚安歌单'}).waitFor({state:'attached'});
  await page.getByRole('button',{name:'加入',exact:true}).click();await page.getByLabel('选择歌单').locator('option',{hasText:'（1）'}).waitFor({state:'attached'});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw Error('音乐管理页面溢出');
  await page.screenshot({path:`test-results/personal-library/music-${width}.png`});
  await page.reload();await page.getByLabel('选择歌单').locator('option',{hasText:'我的晚安歌单（1）'}).waitFor({state:'attached'});
  await page.getByRole('button',{name:'相思锁',exact:false}).last().click();
  await page.waitForFunction(()=>window.__libraryQA.music.progress>0.1&&window.__libraryQA.music.playing,{},{timeout:45000});
  await page.evaluate(()=>window.__libraryQA.music.togglePlay());
  await page.goto('http://127.0.0.1:4179/test/fixtures/personal-library.html?gallery');
  await page.getByText('测试角色',{exact:true}).click();await page.getByRole('button',{name:'批量选择',exact:true}).click();
  await page.locator('.grid.grid-cols-3 > div').nth(0).click();await page.locator('.grid.grid-cols-3 > div').nth(1).click();await page.getByRole('button',{name:'删除 (2)',exact:true}).click();await page.getByRole('button',{name:'确认',exact:true}).click();
  await page.waitForFunction(async()=> (await window.__libraryQA.DB.getGalleryImages('library-qa')).length===1);
  await page.screenshot({path:`test-results/personal-library/gallery-${width}.png`});if(errors.length)throw Error(errors.join('\n'));
  await context.close();
 }
 console.log('PASS: mobile library layouts, remote playback, playlist reload and gallery multi-delete');
}finally{await browser.close();}
