import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.YUEQI_PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try {
 const page=await browser.newPage();
 const captured=[];
 await page.route('https://qa-recording.invalid/**',async route=>{
  const request=route.request().postDataJSON();
  const audio=request.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(p=>p.type==='input_audio').input_audio;
  captured.push(audio);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({transcript:'测试声音',analysis:'合成音频'})}}]})});
 });
 await page.goto('http://127.0.0.1:4183/test/fixtures/yueqi-recording-browser.html');
 await page.waitForFunction(()=>!!window.__recordingQA);
 for(const bgm of [false,true]) {
  await page.evaluate(async bgm=>{
   const ctx=new AudioContext();await ctx.resume();
   const input=ctx.createMediaStreamDestination(),tone=ctx.createOscillator(),gain=ctx.createGain();
   tone.frequency.value=440;gain.gain.value=.3;tone.connect(gain);gain.connect(input);tone.start();
   const music=ctx.createOscillator(),musicGain=ctx.createGain();music.frequency.value=180;musicGain.gain.value=.05;music.connect(musicGain);if(bgm)musicGain.connect(ctx.destination);music.start();
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>input.stream}});
   const q=window.__recordingQA;q.result=null;q.error=null;
   q.cancel=await q.handsFree({}, {text:(text)=>q.result=text,speech:()=>{},error:e=>q.error=String(e),end:()=>{}}, {manual:true,audioApi:{enabled:true,baseUrl:'https://qa-recording.invalid',apiKey:'qa',model:'qa'}});
   q.cleanup=async()=>{tone.stop();music.stop();await ctx.close();};
   // Simulate busy UI work; recording must remain off the main thread.
   const start=performance.now();while(performance.now()-start<350){}
  },bgm);
  await page.waitForTimeout(900);
  await page.evaluate(()=>window.__recordingQA.cancel.finish());
  await page.waitForFunction(()=>window.__recordingQA.result||window.__recordingQA.error);
  const error=await page.evaluate(()=>window.__recordingQA.error);if(error)throw Error(error);
  const audio=captured.at(-1);if(audio.format!=='wav')throw Error('Expected WAV payload');
  const buf=Buffer.from(audio.data,'base64');
  if(buf.toString('ascii',0,4)!=='RIFF'||buf.readUInt32LE(24)!==16000)throw Error('Invalid WAV header/rate');
  const samples=[];for(let offset=44;offset+1<buf.length;offset+=2)samples.push(buf.readInt16LE(offset)/32768);
  // Ignore codec warmup and tail; check duration, level and energy at the source tone.
  const body=samples.slice(3200,-1600);let energy=0,re=0,im=0;
  body.forEach((v,i)=>{energy+=v*v;re+=v*Math.cos(2*Math.PI*440*i/16000);im+=v*Math.sin(2*Math.PI*440*i/16000);});
  const rms=Math.sqrt(energy/body.length),toneFraction=2*(re*re+im*im)/(body.length*energy);
  if(samples.length<16000||rms<.12||rms>.3||toneFraction<.85)throw Error(`Audio quality mismatch bgm=${bgm}: samples=${samples.length} rms=${rms} toneFraction=${toneFraction}`);
  console.log(JSON.stringify({bgm,sampleRate:16000,duration:samples.length/16000,rms,toneFraction}));
  await page.evaluate(()=>window.__recordingQA.cleanup());
 }
} finally {await browser.close();}
