import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.SONG_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4185/test/fixtures/song-ogg-browser.html');
 await page.locator('#result[data-passed]').waitFor({timeout:60000});
 const text=await page.locator('#result').textContent();if(await page.locator('#result').getAttribute('data-passed')!=='true')throw Error(text);
 await mkdir('test-results/song-ogg',{recursive:true});await page.screenshot({path:'test-results/song-ogg/conversion.png'});console.log(text);
}finally{await browser.close();}
