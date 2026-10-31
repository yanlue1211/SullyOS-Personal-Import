import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const runtime=process.env.WORKROOM_PLAYWRIGHT_MODULE;
if(!runtime)throw Error('Set WORKROOM_PLAYWRIGHT_MODULE to the installed Playwright module');
const {chromium}=await import(pathToFileURL(runtime));
const browser=await chromium.launch({headless:true,...(process.env.WORKROOM_CHROME_PATH?{executablePath:process.env.WORKROOM_CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],canaryRequests=[];
page.on('request',request=>{if(request.url().includes('/qa-network-canary'))canaryRequests.push(request.url());});
page.on('pageerror',error=>errors.push(String(error)));
await mkdir('test-results/workroom',{recursive:true});
try{
 await page.route('https://qa-runtime.invalid/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({question:'现场生成的第七扇门',solution:'隐藏答案不能进入聊天'})}}]})}));
 await page.goto('http://127.0.0.1:4179/test/fixtures/workroom-browser.html');
 await page.getByRole('button',{name:'准备隔离测试数据'}).click();
 await page.getByText('测试数据已准备',{exact:true}).waitFor();
 const selectCreator=async()=>{await page.getByLabel('当前创作者').selectOption({label:'测试 Claude'});await page.screenshot({path:'test-results/workroom/desktop.png'});await page.getByRole('button',{name:/游戏库/}).click();await page.getByRole('button').filter({hasText:'浏览器小狗屋'}).click();};
 await selectCreator();const frame=page.frameLocator('iframe[title="造物间作品"]');
 await frame.getByText('等级 1',{exact:true}).waitFor();await frame.getByRole('button',{name:'喂小狗'}).click();await frame.getByText('等级 2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'重开造物间',exact:true}).click();await selectCreator();await frame.getByText('等级 2',{exact:true}).waitFor();
 await page.getByLabel(/运行时AI ·/).check();await page.getByText(/运行时AI已开启/).waitFor();await frame.getByRole('button',{name:'生成新题目',exact:true}).click();await frame.getByText('现场生成的第七扇门',{exact:true}).waitFor();
 await page.screenshot({path:'test-results/workroom/mobile.png'});
 await page.getByRole('button',{name:'验证启动观察',exact:true}).click();await page.getByText('PASS: 真实浏览器启动观察',{exact:true}).waitFor();
 await page.getByRole('button',{name:'验证分享与备份整链',exact:true}).click();
 await page.getByText('PASS: 进度、独立分享、五类卡片语义、组件文件、真实ZIP恢复',{exact:true}).waitFor();
 await page.getByRole('button',{name:'验证沙盒边界',exact:true}).click();await page.getByText('PASS: 父页面隔离、存储隔离与CSP网络限制',{exact:true}).waitFor();
 if(canaryRequests.length)throw Error('CSP没有阻止测试网络请求');
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile('test-results/workroom/result.txt','PASS: mobile UI; real iframe/MessageChannel; native IndexedDB reload; smoke test; explicit copy; card text; ZIP restore; independent notice dismissal.\n');
 console.log('PASS: workroom browser integration, sandbox parent/storage/connect-src boundaries');
}catch(error){console.error(await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:'test-results/workroom/failure.png'}).catch(()=>{});await writeFile('test-results/workroom/error.txt',String(error)+'\n'+errors.join('\n')+'\n'+await page.locator('body').innerText().catch(()=>''));throw error;}
finally{await browser.close();}
