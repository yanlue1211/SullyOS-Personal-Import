import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.TAPNEST_BROWSER_MODULE).href);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const out=process.env.TAPNEST_SCREENSHOTS||'/tmp/tapnest-ui';await mkdir(out,{recursive:true});
let paidCalls=0;const errors=[];
try{
 for(const width of [390,320]){
  const ctx=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.route('**/chat/completions',r=>{paidCalls++;return r.abort();});
  const base=(process.env.TAPNEST_PREVIEW_ORIGIN||'http://127.0.0.1:4188')+'/test/fixtures/tapnest.html';
  async function within(){assert.equal(await p.locator('.tapnest-app').evaluate(e=>e.scrollWidth<=window.innerWidth),true,'No page horizontal overflow');for(const e of await p.locator('.tn-main button:visible,.tn-main input:visible,.tn-main select:visible,.tn-main a:visible').all()){const b=await e.boundingBox();assert.ok(b.x>=-1&&b.x+b.width<=width+1,'Control must stay within viewport');}}
  await p.goto(base);await p.getByText('迎接第一位桌面伙伴',{exact:true}).waitFor();await within();await p.screenshot({path:`${out}/empty-${width}.png`});
  await p.getByRole('button',{name:'桌面连接',exact:true}).click();await p.getByRole('button',{name:'一键开启已保存的桌宠'}).waitFor();await within();await p.screenshot({path:`${out}/connection-${width}.png`});
  const download=p.getByRole('link',{name:'下载／更新连接脚本'});const linkBox=await download.boundingBox();const pinBox=await p.getByLabel('桌宠配对码').boundingBox();assert.ok(linkBox.y+linkBox.height<pinBox.y,'Download link must not collide with pairing input');
  await p.getByRole('button',{name:'使用指南',exact:true}).click();await within();await p.screenshot({path:`${out}/guide-${width}.png`});
  await p.goto(base+'?model=1');await p.getByRole('button',{name:'保存并开启／替换'}).waitFor();await within();await p.screenshot({path:`${out}/model-${width}.png`});
  const api=p.getByRole('checkbox',{name:/接入 API 与角色记忆/});await api.check();await p.getByPlaceholder('留空：戳 1 下也能触发').fill('3');await p.getByText('接口与桌宠提示词',{exact:true}).click();await p.getByRole('checkbox',{name:/使用桌宠独立 API/}).check();await within();await p.screenshot({path:`${out}/api-${width}.png`});
  await p.getByRole('checkbox',{name:/使用桌宠独立 API/}).uncheck();await p.getByRole('button',{name:'保存',exact:true}).click();await p.reload();await p.getByRole('button',{name:'保存并开启／替换'}).waitFor();
  assert.equal(await p.getByRole('checkbox',{name:/接入 API 与角色记忆/}).isChecked(),true);assert.equal(await p.getByLabel('戳动最低次数').inputValue(),'3');
  // UI settings must survive the reorganization; all network/model work remains blocked.
  await p.getByText('戳动与日常台词',{exact:true}).click();await p.getByRole('textbox',{name:'戳动台词'}).fill('在这儿陪着你。');await p.getByRole('checkbox',{name:/每隔一段时间主动发言/}).check();await p.getByRole('spinbutton',{name:'桌宠自动发言间隔'}).fill('20');await within();
  await p.goto(base+'?icon=1');const box=await p.locator('[data-testid=desktop-icon]').boundingBox(),svg=await p.locator('[data-testid=desktop-icon] svg').boundingBox();assert.ok(Math.abs(box.x+box.width/2-svg.x-svg.width/2)<1);assert.ok(Math.abs(box.y+box.height/2-svg.y-svg.height/2)<1);await p.screenshot({path:`${out}/icon-${width}.png`});await ctx.close();
 }
 assert.equal(paidCalls,0);assert.deepEqual(errors,[]);console.log('TapNest 320/390 UI, persistence, icon centering and zero-model checks passed');
}finally{await browser.close();}
