import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const runtime=process.env.WORKROOM_PLAYWRIGHT_MODULE;
if(!runtime)throw Error('Set WORKROOM_PLAYWRIGHT_MODULE to the installed Playwright module');
const {chromium}=await import(pathToFileURL(runtime));
const browser=await chromium.launch({headless:true,...(process.env.WORKROOM_CHROME_PATH?{executablePath:process.env.WORKROOM_CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],canaryRequests=[];let failGeneration=false;
page.on('request',request=>{if(request.url().includes('/qa-network-canary'))canaryRequests.push(request.url());});
page.on('pageerror',error=>errors.push(String(error)));
await mkdir('test-results/workroom',{recursive:true});
try{
 await page.route('https://qa-runtime.invalid/**',async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:failGeneration?'[{"broken":true}':'```json\n'+JSON.stringify({question:'现场生成的第七扇门',solution:'隐藏答案不能进入聊天'})+'\n```'}}]})});});
 await page.goto('http://127.0.0.1:4179/test/fixtures/workroom-browser.html');
 await page.getByRole('button',{name:'准备隔离测试数据'}).click();
 await page.getByText('测试数据已准备',{exact:true}).waitFor();
 const selectCreator=async()=>{await page.getByLabel('当前创作者').selectOption({label:'测试 Claude'});await page.screenshot({path:'test-results/workroom/desktop.png'});await page.getByRole('button',{name:/游戏库/}).click();await page.getByRole('button').filter({hasText:'浏览器小狗屋'}).click();};
 await selectCreator();const frame=page.frameLocator('iframe[title="造物间作品"]');
 await frame.getByText('等级 1',{exact:true}).waitFor();await frame.getByRole('button',{name:'喂小狗'}).click();await frame.getByText('等级 2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'重开造物间',exact:true}).click();await selectCreator();await frame.getByText('等级 2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'展开游戏简介',exact:true}).click();await page.getByText(/简介末尾也能读到/).waitFor();
 await page.getByRole('button',{name:'功能菜单',exact:true}).click();await page.getByRole('button',{name:'⚙ 设置 ▾',exact:true}).click();
 const settings=page.getByRole('group',{name:'游戏设置'});if(!await settings.evaluate(node=>!!node.closest('nav')))throw Error('设置不在同一菜单内');
 await settings.getByLabel('允许本游戏调用 API').check();
 await page.screenshot({path:'test-results/workroom/menu.png'});
 await page.getByRole('button',{name:'收起功能菜单',exact:true}).click({position:{x:10,y:300}});await settings.waitFor({state:'hidden'});
 await frame.getByRole('button',{name:'生成新题目',exact:true}).click();await page.getByText('游戏正在调用 API…',{exact:true}).waitFor();await frame.getByText('现场生成的第七扇门',{exact:true}).waitFor();
 failGeneration=true;await frame.getByRole('button',{name:'生成新题目',exact:true}).click();await page.getByText('造物间调用失败',{exact:true}).waitFor();await page.getByRole('button',{name:'复制',exact:true}).waitFor();await page.screenshot({path:'test-results/workroom/error-popup.png'});await page.getByRole('button',{name:'关闭',exact:true}).click();failGeneration=false;
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
