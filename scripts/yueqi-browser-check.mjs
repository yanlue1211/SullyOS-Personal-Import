import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const modulePath=process.env.YUEQI_PLAYWRIGHT_MODULE;
if(!modulePath)throw Error('Set YUEQI_PLAYWRIGHT_MODULE to the installed Playwright entry');
const {chromium}=await import(pathToFileURL(modulePath));
const browser=await chromium.launch({headless:true});
await mkdir('test-results/yueqi',{recursive:true});
const errors=[];
try{
 for(const width of [390,320]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('https://qa-yueqi.invalid/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:'测试摘要：两段合成测试音频均已播放，不涉及真实经历。'}}]})}));
  await page.goto('http://127.0.0.1:4183/test/fixtures/yueqi-browser.html');
  await page.getByText('月亮今天栖息在哪里').waitFor();
  const snap=async name=>{
   const overflow=await page.locator('.yueqi').evaluate(el=>el.scrollWidth>el.clientWidth+1);
   if(overflow)throw Error(`${width}px ${name} horizontal overflow`);
   await page.screenshot({path:`test-results/yueqi/${width}-${name}.png`});
  };
  const cardColors=await page.locator('.yq-grid > button').evaluateAll(cards=>cards.map(card=>getComputedStyle(card).backgroundImage));
  if(new Set(cardColors).size!==1)throw Error('Home card colors differ');
  await snap('home');
  await page.getByRole('button',{name:/月下听风/}).click();
  await page.getByRole('heading',{name:'月下听风',exact:true}).waitFor();
  await snap('music');
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:/选择一位熟悉的声音/}).click();
  await page.getByRole('button',{name:/阿源/}).click();
  await page.getByRole('button',{name:/枕月听书/}).click();
  await page.getByRole('button',{name:/月下相依/}).click();
  await snap('setup');
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:/月光拾音/}).click();
  await snap('records');
  await page.getByRole('button',{name:/海边的小羊/}).click();
  await page.locator('.yq-player').waitFor({state:'visible'});
  await snap('player');
  await page.getByRole('button',{name:'修改摘要',exact:true}).click();
  await page.getByRole('textbox',{name:'本场摘要',exact:true}).fill('修正摘要：这是虚构的小羊故事，用户没有回应。');
  await snap('summary-editor');
  await page.getByRole('button',{name:'保存摘要',exact:true}).click();
  await page.getByRole('dialog',{name:'修改月栖摘要'}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await snap('settings');
  if(width===390){
   await page.getByRole('button',{name:'完成',exact:true}).click();
   await page.evaluate(async()=>{await window.__yueqiQA.seedAudio();await window.__yueqiQA.moon.musicPlay();});
   await page.getByRole('button',{name:'继续播放',exact:true}).click();
   await page.waitForFunction(()=>{const m=window.__yueqiQA.moon;return m.voice?.currentTime>.7&&m.music.volume<.2;});
   await page.getByRole('button',{name:'暂停',exact:true}).click();
   const paused=await page.evaluate(()=>{const m=window.__yueqiQA.moon;return {time:m.voice.currentTime,paused:m.voice.paused,musicPaused:m.music.paused};});
   if(!paused.paused||!paused.musicPaused)throw Error('Pause did not stop both tracks');
   await page.waitForTimeout(250);
   const retained=await page.evaluate(()=>window.__yueqiQA.moon.voice.currentTime);
   if(Math.abs(retained-paused.time)>.08)throw Error('Paused audio clock drifted');
   await page.getByRole('button',{name:'继续播放',exact:true}).click();
   await page.waitForFunction(()=>{const s=window.__yueqiQA.moon.session;return s.status==='ended'&&s.cursor===2&&s.cardId&&!window.__yueqiQA.moon.busy;});
   await page.waitForFunction(()=>window.__yueqiQA.moon.music.paused);
   const played=await page.evaluate(async()=>{const q=window.__yueqiQA;const s=await q.storage.get(q.moon.session.id);return {count:s.turns.filter(t=>t.played).length,audios:s.clips.filter(c=>c.audio).length,offset:s.offset};});
   if(played.count!==2||played.audios!==2||played.offset!==0)throw Error('Audio completion or persistence mismatch: '+JSON.stringify(played));
   await snap('audio-complete');
   await page.reload();
   await page.getByRole('button',{name:/月下听风/}).click();
   const savedTrack=page.locator('.yq-playlist button[aria-pressed]').filter({hasText:'测试背景音'});
   await savedTrack.waitFor();
   await savedTrack.click();
   await page.waitForFunction(()=>{const m=window.__yueqiQA.moon;return m.music&&!m.music.paused;});
   await snap('saved-music');

   console.log('PASS: actual HTMLAudio playback, ordered two-clip completion, pause/resume, ducking, music fade-out and persisted audio.');
  }
  if(await page.getByRole('button',{name:'完成',exact:true}).isVisible())await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.evaluate(()=>window.__yueqiQA.seedNight());
  await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:/月光拾音/}).click();await page.getByRole('button',{name:/声音语气验收/}).click();
  await page.getByLabel('夜话语音识别方式').selectOption('audio');
  await page.getByText(/今晚的文字 ·/).click();
  const detail=page.locator('.yq-voice-detail');if(await detail.evaluate(el=>el.open))throw Error('Tone opened automatically');
  await snap('voice-tone-folded');await detail.locator('summary').click();await detail.locator('p').waitFor({state:'visible'});await snap('voice-tone-open');
  await page.reload();await page.getByRole('button',{name:/月光拾音/}).click();await page.getByRole('button',{name:/声音语气验收/}).click();await page.getByText(/今晚的文字 ·/).click();
  if(await page.locator('.yq-voice-detail').evaluate(el=>el.open))throw Error('Tone did not reset to folded on reopen');
  if(!await page.locator('.yq-voice-detail').textContent().then(text=>text.includes('声音轻柔')))throw Error('Tone lost after reload');
  await context.close();
 }
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile('test-results/yueqi/result.json',JSON.stringify({passed:true,widths:[390,320],pages:6,audioPlayback:true,errors},null,2));
 console.log('PASS: 320/390px home, setup, records, player, summary editing, settings; no page errors or horizontal overflow.');
}finally{await browser.close();}
