import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.WORKROOM_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true});
await mkdir('test-results/personal-library',{recursive:true});
try{
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('sully_music_cfg_v1',JSON.stringify({workerUrl:'https://qa-music.invalid',cookie:'TEST-ONLY',quality:'standard'})));
  const page=await context.newPage(),errors=[];let indexCalls=0;
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('https://qa-music.invalid/**',async route=>{
   const url=route.request().url(),body=route.request().postDataJSON()||{};let result={code:200};
   if(url.endsWith('/login/status'))result={data:{profile:{userId:123,nickname:'歌单验收',playlistCount:1}}};
   else if(url.endsWith('/user/playlist')){indexCalls++;result={playlist:[{id:12,name:'原有网易歌单',trackCount:125}]};}
   else if(url.endsWith('/playlist/track/all'))result={songs:Array.from({length:Math.min(body.limit,125-body.offset)},(_,i)=>({id:body.offset+i+1,name:'云端歌曲'+(body.offset+i+1),ar:[{name:'歌手'}]}))};
   else if(url.endsWith('/search'))result={result:{songs:[{id:900,name:'搜索加歌',ar:[{name:'歌手'}]}]}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:4179/test/fixtures/personal-library.html?profile');
  await page.getByRole('button',{name:'展开歌单 原有网易歌单'}).waitFor();
  const row=page.locator('[aria-label="音乐快捷操作"]');await row.getByRole('button',{name:'音乐管理',exact:true}).waitFor();
  if(await page.getByText('歌曲与歌单管理',{exact:true}).count())throw Error('旧悬浮按钮仍存在');
  await page.screenshot({path:`test-results/personal-library/profile-${width}.png`});
  await page.getByRole('button',{name:'加歌',exact:true}).click();
  await page.getByLabel('选择歌单').locator('option',{hasText:'原有网易歌单（125）'}).waitFor({state:'attached'});
  await page.getByLabel('歌曲音频链接').fill('https://cdn.test/private-song.mp3');await page.getByLabel('歌名',{exact:true}).fill('自己导入的歌');await page.getByRole('button',{name:'导入并加入此歌单',exact:true}).click();
  await page.getByLabel('选择歌单').locator('option',{hasText:'（126）'}).waitFor({state:'attached'});
  await page.getByLabel('搜索添加歌曲').fill('搜索加歌');await page.getByRole('dialog',{name:'音乐管理'}).getByRole('button',{name:'搜索',exact:true}).click();await page.getByRole('button',{name:'加入',exact:true}).last().click();
  await page.getByLabel('选择歌单').locator('option',{hasText:'（127）'}).waitFor({state:'attached'});
  await page.getByRole('dialog',{name:'音乐管理'}).getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:'展开歌单 原有网易歌单'}).click();await page.getByRole('button',{name:'播放 自己导入的歌',exact:true}).waitFor();await page.getByRole('button',{name:'播放 搜索加歌',exact:true}).waitFor();
  if(await page.getByRole('button',{name:'展开歌单 原有网易歌单'}).count()!==1)throw Error('原歌单被复制成两张卡片');
  await page.getByRole('button',{name:'一键保存已有歌单',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='一键保存已有歌单'&&!b.disabled));await page.waitForFunction(async()=>JSON.parse(await window.__libraryQA.DB.getAsset('music-user-playlists'))[0].songs.length===127);
  await page.reload();await page.getByRole('button',{name:'展开歌单 原有网易歌单'}).waitFor();if(indexCalls!==1)throw Error('重进页面重复请求歌单索引');
  await page.getByRole('button',{name:'展开歌单 原有网易歌单'}).click();await page.getByRole('button',{name:'播放 自己导入的歌'}).waitFor();
  await page.getByRole('button',{name:'同步网易云',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='同步网易云'&&!b.disabled));await page.waitForFunction(async()=>JSON.parse(await window.__libraryQA.DB.getAsset('music-user-playlists'))[0].songs.length===127);if(indexCalls!==2)throw Error('手动同步没有拉取新索引');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('歌单页面横向溢出');if(errors.length)throw Error(errors.join('\n'));await context.close();
 }
 console.log('PASS: original playlist cards, 125-song pagination, imported/search additions, deduplication, cached reopening and manual sync');
}finally{await browser.close();}
