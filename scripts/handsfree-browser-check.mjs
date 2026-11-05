import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.YUEQI_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
await mkdir('test-results/yueqi',{recursive:true});
try{
 for(const width of [320,390]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4183/test/fixtures/handsfree-browser.html');
  await page.getByRole('button',{name:'开启免手持'}).click();
  await page.getByRole('status').filter({hasText:'等你开口'}).waitFor();
  await page.evaluate(()=>window.__hfQA.level(.08));
  await page.getByRole('status').filter({hasText:'听到你在说话'}).waitFor();await page.waitForTimeout(600);
  await page.evaluate(()=>window.__hfQA.interrupt());await page.waitForFunction(()=>window.__hfQA.analysisState()==='running');
  await page.evaluate(()=>window.__hfQA.level(0));
  await page.getByRole('status').filter({hasText:'秒后发送'}).waitFor();
  await page.screenshot({path:`test-results/yueqi/${width}-handsfree-countdown.png`});
  if(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth))throw Error('Hands-free controls overflow');
  await page.waitForTimeout(2600);await page.evaluate(()=>window.__hfQA.level(.08));
  await page.getByRole('status').filter({hasText:'听到你在说话'}).waitFor();
  if(await page.evaluate(()=>window.__hfQA.sent)!==0)throw Error('Mid-sentence pause sent too early');
  await page.waitForTimeout(500);await page.evaluate(()=>window.__hfQA.level(0));
  await page.waitForFunction(()=>window.__hfQA.sent===1);
  await page.getByRole('status').filter({hasText:'等你开口'}).waitFor();
  await page.evaluate(()=>window.__hfQA.interrupt(true));
  await page.getByRole('status').filter({hasText:'停顿检测暂停'}).waitFor();
  await page.screenshot({path:`test-results/yueqi/${width}-handsfree-paused.png`});
  await page.getByRole('button',{name:'说完了',exact:true}).click();
  await page.waitForFunction(()=>window.__hfQA.sent===2);
  await page.evaluate(()=>window.__hfQA.unblock());
  await page.getByRole('button',{name:'关闭免手持'}).waitFor();
  if(errors.length)throw Error(errors.join('\n'));
  await page.getByRole('button',{name:'关闭免手持'}).click();await page.close();
 }
}finally{await browser.close();}
