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
 await page.route('https://qa-runtime.invalid/**',async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:failGeneration?'[{"broken":true}':JSON.stringify(route.request().postDataJSON()).includes('availableActions')?JSON.stringify({actionId:'feed',reply:'我也来喂一次'}):'```json\n'+JSON.stringify({question:'现场生成的第七扇门',solution:'隐藏答案不能进入聊天'})+'```'}}]})});});
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
 await page.getByRole('button',{name:'让 TA 玩一轮',exact:true}).click();await frame.getByText('等级 3',{exact:true}).waitFor();
 await page.screenshot({path:'test-results/workroom/mobile.png'});
 await page.getByRole('button',{name:'验证启动观察',exact:true}).click();await page.getByText('PASS: 真实浏览器启动观察',{exact:true}).waitFor();
 await page.getByRole('button',{name:'验证分享与备份整链',exact:true}).click();
 await page.getByText('PASS: 进度、独立分享、五类卡片语义、组件文件、真实ZIP恢复',{exact:true}).waitFor();
 await page.getByRole('button',{name:'验证沙盒边界',exact:true}).click();await page.getByText('PASS: 父页面隔离、存储隔离与CSP网络限制',{exact:true}).waitFor();
 const experience=await context.newPage();await experience.goto('http://127.0.0.1:4179/test/fixtures/experience-browser.html');
 const input=experience.getByPlaceholder('Message...');await input.tap();
 for(const label of ['聊天功能','表情包']){await experience.getByRole('button',{name:label,exact:true}).tap();await experience.getByLabel('当前面板').filter({hasText:label==='聊天功能'?'actions':'emojis'}).waitFor();if(await input.evaluate(n=>document.activeElement===n))throw Error('面板打开后输入框仍然聚焦');await input.tap();await experience.getByLabel('当前面板').filter({hasText:'none'}).waitFor();if(!await input.evaluate(n=>document.activeElement===n))throw Error('点击面板上方输入框不能获得焦点');}
 if(await input.inputValue()!=='草稿不会丢')throw Error('切换丢失草稿');
 await experience.getByRole('button',{name:'更多现场功能',exact:true}).click();await experience.getByRole('button',{name:'✦ 我谕',exact:true}).click();await experience.getByRole('button',{name:'＋ 新建道具',exact:true}).click();await experience.getByLabel('名字 *',{exact:true}).fill('桂花糖');await experience.getByLabel('用法／功能 *',{exact:true}).fill('游戏中有些困意');await experience.getByLabel('char 认知 *',{exact:true}).fill('只闻到糖香');await experience.getByRole('button',{name:'保存并递给 TA',exact:true}).click();await experience.getByRole('button',{name:'返回',exact:true}).click();
 const clip=await experience.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>{recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}));});recorder.start();for(let i=0;i<12;i++){ctx.fillStyle=i%2?'red':'blue';ctx.fillRect(0,0,320,180);await new Promise(r=>setTimeout(r,100));}recorder.stop();const blob=await done;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await blob.arrayBuffer()));});
 await experience.getByLabel('选择真实视频').setInputFiles({name:'现场.webm',mimeType:'video/webm',buffer:Buffer.from(clip)});await experience.getByText('真实视频',{exact:true}).waitFor();await experience.getByRole('button',{name:'验证媒体与道具上下文',exact:true}).click();await experience.getByText('PASS: 六帧、聊天与见面视觉上下文、用户道具与记忆文本',{exact:true}).waitFor();await experience.screenshot({path:'test-results/workroom/experience.png'});await experience.getByRole('button',{name:'准备归档清理验收',exact:true}).click();await experience.getByText('已准备可清理归档',{exact:true}).waitFor();await experience.getByRole('button',{name:'更多现场功能',exact:true}).click();await experience.getByRole('button',{name:'清理归档附件',exact:true}).click();await experience.getByText(/找到 0 张图片、1 段视频/).waitFor();await experience.getByRole('button',{name:'一键清理符合条件的附件',exact:true}).click();await experience.getByRole('button',{name:'确认清理',exact:true}).click();await experience.getByText(/已清理 1 条附件/).waitFor();await experience.screenshot({path:'test-results/workroom/cleanup.png'});await experience.close();
 if(canaryRequests.length)throw Error('CSP没有阻止测试网络请求');
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile('test-results/workroom/result.txt','PASS: mobile UI; real iframe/MessageChannel; native IndexedDB reload; smoke test; explicit copy; card text; ZIP restore; independent notice dismissal.\n');
 console.log('PASS: workroom browser integration, sandbox parent/storage/connect-src boundaries');
}catch(error){console.error(await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:'test-results/workroom/failure.png'}).catch(()=>{});await writeFile('test-results/workroom/error.txt',String(error)+'\n'+errors.join('\n')+'\n'+await page.locator('body').innerText().catch(()=>''));throw error;}
finally{await browser.close();}
