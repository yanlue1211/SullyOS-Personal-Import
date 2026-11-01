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
  await page.route('https://qa-yueqi.invalid/**',route=>route.abort());
  await page.goto('http://127.0.0.1:4183/test/fixtures/yueqi-browser.html');
  await page.getByText('月亮今晚栖在哪里？').waitFor();
  const snap=async name=>{
   const overflow=await page.locator('.yueqi').evaluate(el=>el.scrollWidth>el.clientWidth+1);
   if(overflow)throw Error(`${width}px ${name} horizontal overflow`);
   await page.screenshot({path:`test-results/yueqi/${width}-${name}.png`});
  };
  await snap('home');
  await page.getByRole('button',{name:/月下寻羊/}).click();
  await page.getByRole('button',{name:/阿源/}).click();
  await page.getByRole('button',{name:/枕月听书/}).click();
  await page.getByRole('button',{name:/月下相依/}).click();
  await snap('setup');
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:/月光拾音/}).click();
  await snap('records');
  await page.getByRole('button',{name:/海边的小羊/}).click();
  await snap('player');
  await page.getByRole('button',{name:'修改摘要',exact:true}).click();
  await page.getByRole('textbox',{name:'本场摘要',exact:true}).fill('修正摘要：这是虚构的小羊故事，用户没有回应。');
  await snap('summary-editor');
  await page.getByRole('button',{name:'保存摘要',exact:true}).click();
  await page.getByRole('dialog',{name:'修改月栖摘要'}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await snap('settings');
  await context.close();
 }
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile('test-results/yueqi/result.json',JSON.stringify({passed:true,widths:[390,320],pages:6,errors},null,2));
 console.log('PASS: 320/390px home, setup, records, player, summary editing, settings; no page errors or horizontal overflow.');
}finally{await browser.close();}
