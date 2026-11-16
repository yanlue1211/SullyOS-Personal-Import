import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.SONGWRITING_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
await mkdir('test-results/song-production',{recursive:true});
try{
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://qa-vocal.invalid/**',r=>r.abort());
  await page.goto('http://127.0.0.1:5183/test/fixtures/song-production-browser.html');
  await page.getByText('晚风试唱',{exact:true}).click();
  await page.getByRole('button',{name:'出歌 / 成品 / 下载 →',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  if(await dialog.count()!==1)throw Error('duplicate production dialogs');
  await dialog.getByRole('button',{name:/海绵音乐/}).click();await dialog.getByLabel('自由创作设想').waitFor();
  await page.screenshot({path:`test-results/song-production/haimian-${width}.png`});
  await dialog.getByRole('button',{name:/MiniMax 免费版/}).click();await page.screenshot({path:`test-results/song-production/minimax-${width}.png`});
  await dialog.getByRole('button',{name:/ACE-Step/}).click();await page.screenshot({path:`test-results/song-production/acestep-${width}.png`});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  if(await page.getByRole('button',{name:/试听第\d+句人声曲调/}).count()!==2)throw Error('missing per-line vocal playback');
  await page.getByRole('button',{name:'人声曲谱',exact:true}).click();
  if(await page.getByLabel('创作聊天').count())throw Error('score page duplicates chat');
  await page.getByLabel('旋律范围').selectOption('line');await page.getByLabel('旋律歌词句子').selectOption('1');
  await page.locator('.sw-scroll').evaluate(n=>n.scrollTop=0);
  await page.screenshot({path:`test-results/song-production/vocal-score-${width}.png`});
  await page.getByRole('button',{name:'去创作对话',exact:true}).click();
  if(await page.getByLabel('创作聊天').count()!==1)throw Error('expected exactly one creative composer');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('mobile horizontal overflow');
  if(errors.length)throw Error(errors.join('\n'));await context.close();
 }
 console.log('PASS: one production dialog, unified providers, line melody buttons and one creative chat at 320/390px');
}finally{await browser.close();}
