import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.WORKROOM_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true});
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
await mkdir('test-results/lyrics-launcher',{recursive:true});
try{
 for(const [width,height] of [[390,844],[360,780],[412,915]]){
  const ctx=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4179/test/fixtures/lyrics-launcher.html');await page.locator('[data-app-grid]').first().waitFor();
  const grids=await page.locator('[data-app-grid]').evaluateAll(nodes=>nodes.map(n=>({ids:[...n.querySelectorAll('[data-launcher-kind="app"]')].map(x=>x.dataset.launcherItem),cols:getComputedStyle(n).gridTemplateColumns.split(' ').length})));
  assert(grids.every(g=>g.cols===4&&g.ids.length<=16),'not 4-column/16 capacity');assert(grids.slice(0,-1).every(g=>g.ids.length===16),'unexpected incomplete app page');
  const ids=grids.flatMap(g=>g.ids);assert(new Set(ids).size===ids.length,'duplicate app icons');
  const expected=await page.evaluate(()=>window.__expectedApps);assert(expected.every(id=>ids.includes(id)),'missing apps');
  const first=page.locator('[data-app-grid]').first();const box=await first.boundingBox();assert(box.y+box.height<height-90,'four rows overlap dock');
  await first.locator('[data-launcher-kind="app"]').last().click();assert(await page.evaluate(()=>!!window.__clicked),'app click failed');
  await page.locator('.launcher-pages').evaluate(el=>{el.scrollLeft=el.clientWidth;});await page.waitForTimeout(400);assert(await page.locator('.launcher-pages').evaluate(el=>el.scrollLeft>el.clientWidth*.8),'page navigation failed');
  await page.screenshot({path:`test-results/lyrics-launcher/launcher-${width}.png`});assert(!errors.length,errors.join('\n'));await ctx.close();
 }
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true});await ctx.addInitScript(()=>{localStorage.setItem('sully_music_cfg_v1',JSON.stringify({workerUrl:'https://music.test',cookie:''}));if(!localStorage.getItem('sully_music_local_album_v1'))localStorage.setItem('sully_music_local_album_v1',JSON.stringify(['正确歌曲','已有歌词','同名歌曲','失败歌曲','取消歌曲'].map((name,i)=>({id:-i-1,name,artists:'测试歌手',album:'导入的歌曲',albumPic:'',duration:0,fee:0,local:true,remoteAudioUrl:'https://audio.test/'+i+'.mp3',localLyrics:i===1?'保留原歌词':'',lyricTimingMode:'plain'}))));localStorage.setItem('sully_music_state_v1',JSON.stringify({queue:[JSON.parse(localStorage.getItem('sully_music_local_album_v1'))[0]],idx:0}));});
 const page=await ctx.newPage();let cancelSeen=false;
 await page.route('https://music.test/**',route=>route.fulfill({json:{result:{songs:[]}}}));
 await page.route('https://lrclib.net/api/search?**',async route=>{const name=new URL(route.request().url()).searchParams.get('track_name');if(name==='失败歌曲')return route.fulfill({status:503,body:'offline'});if(name==='取消歌曲'){cancelSeen=true;await new Promise(r=>setTimeout(r,3000));return route.fulfill({json:[]}).catch(()=>{});}return route.fulfill({json:[{id:1,trackName:name,artistName:name==='同名歌曲'?'另一位歌手':'测试歌手',syncedLyrics:'[00:01.00]第一句\n[00:04.00]第二句'}]});});
 await page.goto('http://127.0.0.1:4179/test/fixtures/personal-library.html');await page.getByRole('button',{name:'一键补全歌词',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent?.includes('取消歌曲'),{},{timeout:45000});await page.getByRole('button',{name:'取消任务',exact:true}).click();await page.getByRole('status').filter({hasText:'已取消'}).waitFor();
 assert(await page.evaluate(()=>window.__libraryQA.music.lyric[0]?.t===1&&window.__libraryQA.music.current?.remoteAudioUrl==='https://audio.test/0.mp3'),'playing queue/lyrics not refreshed');
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('sully_music_local_album_v1')));assert(saved[0].lyricTimingMode==='synced'&&saved[0].lyricLineTimings[0]===1,'LRC not persisted');assert(saved[1].localLyrics==='保留原歌词','existing lyrics overwritten');assert(!saved[2].localLyrics,'wrong singer accepted');assert(!saved[3].localLyrics,'failed lyrics changed');
 await page.reload();await page.getByRole('button',{name:'一键补全歌词',exact:true}).waitFor();saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('sully_music_local_album_v1')));assert(saved[0].localLyrics.includes('第一句'),'reload lost lyrics');await page.screenshot({path:'test-results/lyrics-launcher/lyrics.png'});await ctx.close();
 console.log('PASS: mobile 4x4 layout, preserved app entries/clicks/navigation; lyrics queue, singer safety, protection, failure, cancellation and reload persistence');
}finally{await browser.close();}
