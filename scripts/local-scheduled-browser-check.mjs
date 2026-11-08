import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.STATUS_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true});
await mkdir('test-results/local-scheduled',{recursive:true});
try {
 for(const width of [320,390]) {
  const page=await browser.newPage({viewport:{width,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4183/test/fixtures/local-scheduled-browser.html');
  await page.getByText('历史本地待发消息 · 仅管理旧任务').click();
  await page.getByText('另一条待发送消息',{exact:true}).waitFor();
  if(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth))throw Error('Horizontal overflow');
  await page.screenshot({path:`test-results/local-scheduled/${width}.png`});
  await page.locator('article').first().getByRole('button',{name:'取消任务'}).click();
  await page.getByText('过一会儿再来找你，记得把被子盖好。',{exact:true}).waitFor({state:'hidden'});
  await page.reload();
  await page.getByText('历史本地待发消息 · 仅管理旧任务').click();
  await page.getByText('另一条待发送消息',{exact:true}).waitFor();
  if(await page.locator('article').count()!==1)throw Error('Cancellation did not persist');
  if(errors.length)throw Error(errors.join('\n'));
  await page.close();
 }
} finally {await browser.close();}
