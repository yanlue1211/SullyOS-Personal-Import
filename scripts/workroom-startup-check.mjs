import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.WORKROOM_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto('http://127.0.0.1:4179/test/fixtures/workroom-startup.html');
 await page.getByRole('button',{name:'验证首帧和布局'}).click();
 await page.waitForFunction(()=>document.querySelector('#result')?.textContent,{timeout:15000});
 const result=await page.locator('#result').textContent();
 if(result!=='PASS')throw Error(result);
 console.log('PASS: first-frame errors, full-height viewport and scrollable short-screen menu');
}finally{await browser.close();}
