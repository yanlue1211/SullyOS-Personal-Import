// 糯米机独立「桌宠」App 专用 AutoJs6 V2。
// 手机桌面/其他App悬浮。只监听127.0.0.1；不保存或调用API密钥，不读取屏幕。
// 旧脚本仍可保留，但请先停止旧桌宠任务，再运行本脚本。
if(!floaty.hasPermission()){floaty.requestPermission();exit();}
var ROOT='https://yanlue1211.github.io/SullyOS-Personal-Import/tapnest/';
var cacheDir=String(new java.io.File(context.getFilesDir(),'tapnest-sully-v2').getAbsolutePath());files.ensureDir(cacheDir+'/');
function download(name){var r=http.get(ROOT+name+'?v=2&at='+Date.now());if(r.statusCode!==200)throw Error('下载播放器失败：'+r.statusCode);return r.body.string();}
var html,engine;
try{html=download('viewer.html');engine=download('engine.js');files.write(files.join(cacheDir,'viewer.html'),html);files.write(files.join(cacheDir,'engine.js'),engine);}catch(e){try{html=files.read(files.join(cacheDir,'viewer.html'));engine=files.read(files.join(cacheDir,'engine.js'));if(!html||!engine)throw e;}catch(_){toastLog('首次运行需要联网下载播放器：'+e);exit();}}
try{html=html.replace('<script src="engine.js"></script>','<script>'+engine.replace(/<\/script/gi,'<\\/script')+'</script>');}catch(e){toastLog(String(e));exit();}
var d=context.getResources().getDisplayMetrics().density;
function dp(v){return Math.round(v*d);}
var PET_SIZE_DP=210,BASE_EXTRA_DP=90,WW=dp(220),HH=dp(330),anchorY=Math.round(device.height*.33),extraDp=90;
var win=floaty.rawWindow(<frame w="*" h="*" bg="#00000000"><webview id="pet" w="*" h="*" /></frame>);
win.setSize(WW,HH);win.setPosition(Math.max(0,device.width-WW-dp(10)),anchorY);win.setTouchable(true);
var renderState={revision:'',status:'idle',error:''};
var payload=null,session='',ended=false,busy=false,upload=null,nextTimer=0,lastInteraction=0,lastWatch=0,eventsQueue=[],spokenIds=[],apiPending=false,tapBurstAt=0,tapBurstCount=0,tapClosed=true,tapBatches=[],pendingUntil=0;
function evaluate(code){ui.run(function(){try{win.pet.evaluateJavascript(code,null);}catch(e){}});}
function speak(text){evaluate('window.PetPreview&&window.PetPreview.speak('+JSON.stringify(String(text).slice(0,1500))+')');}
function thinking(){pendingUntil=Date.now()+180000;evaluate('window.PetPreview&&window.PetPreview.setThinking(true)');}
function currentForm(){if(!payload)return null;return payload.binding.forms.filter(function(f){return f.id===payload.binding.formId;})[0];}
function preset(text){evaluate('window.PetPreview&&window.PetPreview.preset('+JSON.stringify(String(text).slice(0,1500))+')');}
function chooseLine(kind){var f=currentForm(),arr=f&&(kind==='tap'?f.tapLines:f.autoLines);if(!arr||!arr.length)return;var key=payload.charId+':'+f.id+':'+kind;var i=Math.floor(Math.random()*arr.length);if(arr.length>1&&chooseLine.last[key]===i)i=(i+1)%arr.length;chooseLine.last[key]=i;preset(arr[i]);}chooseLine.last={};
function emit(kind,text,formId){if(!payload)return;var now=Date.now();eventsQueue.push({id:'p'+now+'-'+Math.floor(Math.random()*1e8),kind:kind,text:String(text||'').slice(0,1000),charId:payload.charId,formId:formId||payload.binding.formId,modelId:payload.binding.modelId,revision:payload.revision,at:now,tapCount:kind==='tap'?tapBurstCount:undefined,expression:kind==='tap'&&tapBurstCount>=5&&currentForm()&&currentForm().angryFrameConfigured?'angry':'normal'});if(eventsQueue.length>25)eventsQueue.shift();if(kind!=='form'){apiPending=true;thinking();}}
function closeBurst(){if(!tapClosed&&tapBurstCount>0){if(tapBurstCount>=Math.max(1,Math.min(50,Number(payload.binding.tapThreshold)||1)))tapBatches.push({count:tapBurstCount,at:tapBurstAt});tapClosed=true;}}
function interaction(e){if(!e||!payload||renderState.status!=='ready'||renderState.revision!==payload.revision)return;
 if(e.kind==='form'){if(!payload.binding.forms.some(function(f){return f.id===e.formId;}))return;eventsQueue=[];apiPending=false;tapBurstAt=0;tapBurstCount=0;tapClosed=true;tapBatches=[];payload.binding.formId=e.formId;try{files.write(formCache,JSON.stringify({revision:payload.revision,charId:payload.charId,formId:e.formId}));}catch(_){}emit('form','',e.formId);nextTimer=Date.now()+payload.binding.intervalMinutes*60000;return;}
 lastInteraction=Date.now();
 if(e.kind==='tap'){
  var at=Number(e.at)||lastInteraction;
  if(at-tapBurstAt>=3000){if(payload.binding.apiEnabled)closeBurst();tapBurstCount=1;}else tapBurstCount=Math.min(1000,tapBurstCount+1);
  tapBurstAt=at;tapClosed=false;chooseLine('tap');return;
 }
 if(e.kind==='text'&&payload.binding.apiEnabled){if(!session||Date.now()-lastWatch>30000&&!busy&&!apiPending){speak('API连接暂不可用，请保持糯米机运行并重新配对。');return;}emit('text',e.text);}
}
function dispatchBurst(){if(!payload||!payload.binding.apiEnabled||renderState.status!=='ready')return;var now=Date.now();if(!session||now-lastWatch>30000&&!busy&&!apiPending){tapBatches=[];if(now-tapBurstAt>3000)tapClosed=true;return;}if(now-tapBurstAt>3000)closeBurst();if(busy||apiPending||chatOpen||now-tapBurstAt<=3000||!tapBatches.length)return;var batch=tapBatches.shift(),current=tapBurstCount;tapBurstCount=batch.count;emit('tap');tapBurstCount=current;}
var cacheFile=files.join(cacheDir,'desktop-v2.json'),formCache=files.join(cacheDir,'active-form-v2.json');
function apply(p){if(!p||p.version!==2||typeof p.revision!=='string'||typeof p.charId!=='string'||!p.binding||!p.pack||!Array.isArray(p.pack.forms)||!p.pack.forms.length||p.pack.forms.length>24)throw Error('模型同步格式错误');
 // The browser sends only a public binding; reject credentials even if an outdated client tries.
 if(p.binding.api||p.binding.apiKey||p.apiConfig)throw Error('禁止传输API凭据');
 Object.keys(p.pack.assets||{}).forEach(function(k){if(!/^data:image\/(png|jpeg|webp);base64,/.test(p.pack.assets[k]))throw Error('只接收图片素材');});
 var retained=eventsQueue.filter(function(e){return e.kind==='text'&&e.charId===p.charId&&e.formId===p.binding.formId&&e.modelId===p.binding.modelId&&p.binding.apiEnabled&&Date.now()-e.at<180000;}).map(function(e){e.revision=p.revision;return e;});renderState={revision:p.revision,status:'loading',error:''};payload=p;payload.binding.intervalMinutes=Math.max(1,Math.min(1440,Number(p.binding.intervalMinutes)||15));eventsQueue=retained;spokenIds=[];busy=false;apiPending=false;tapBurstAt=0;tapBurstCount=0;tapClosed=true;tapBatches=[];pendingUntil=0;nextTimer=Date.now()+payload.binding.intervalMinutes*60000;
 evaluate('window.PetPreview&&window.PetPreview.apply('+JSON.stringify(p).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')+')');
 files.write(cacheFile,JSON.stringify(p));
}
ui.run(function(){var v=win.pet;v.setBackgroundColor(android.graphics.Color.TRANSPARENT);var s=v.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);v.loadDataWithBaseURL(ROOT,html,'text/html','UTF-8',null);});
// Reuse the tested focus, keyboard release and drag behavior from V0.15.
var focusHeld=false,chatOpen=false,imeWasVisible=false,hiddenChecks=0,focusAt=0;
var checking=false,checkStartedAt=0,shuttingDown=false;
// Long hold without dragging >= 5000ms closes the pet.
var HOLD_TO_CLOSE_MS=5000, holdExitTimer=null, fingerDown=false;
function cancelHoldExit(){
  if(holdExitTimer!==null){clearTimeout(holdExitTimer);holdExitTimer=null;}
}
function closePetAfterHold(){
  if(shuttingDown)return;
  shuttingDown=true;fingerDown=false;cancelHoldExit();
  try { win.disableFocus(); } catch (_) {}
  try { win.close(); } catch (_) {}
  try { engines.myEngine().forceStop(); } catch (_) { try { exit(); } catch (__) {} }
}
function takeFocus(){
  if(shuttingDown||focusHeld)return;
  focusHeld=true;focusAt=Date.now();imeWasVisible=false;hiddenChecks=0;
  try{
    win.requestFocus();
    ui.run(function(){win.pet.requestFocus()});
  }catch(e){focusHeld=false;toast("获取输入焦点失败："+e)}
}
function releaseFocus(){
  if(!focusHeld||shuttingDown)return;
  focusHeld=false;imeWasVisible=false;hiddenChecks=0;
  ui.run(function(){
    try{win.disableFocus()}catch(_){}
    try{win.pet.clearFocus()}catch(_){}
    try{
      var ime=context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
      ime.hideSoftInputFromWindow(win.pet.getWindowToken(),0);
    }catch(_){}
  });
}
var cb=new JavaAdapter(android.webkit.ValueCallback,{
  onReceiveValue:function(raw){
    checking=false;
    if(shuttingDown)return;
    var textResult=String(raw).replace(/^"/,"").replace(/"$/,"");
    var parts=textResult.split("|");
    if(parts.length<2)return;
    var opened=parts[0]==="1",nextExtra=Number(parts[1]);
    if(isFinite(nextExtra)){var nextHeight=Math.max(dp(330),Math.min(device.height,dp(nextExtra)));if(Math.abs(nextHeight-HH)>dp(2)){HH=nextHeight;ui.run(function(){win.setSize(WW,HH);win.setPosition(win.getX(),Math.max(0,Math.min(device.height-HH,anchorY)));});}}
    var newlyOpened=opened&&!chatOpen;
    chatOpen=opened;
    if(newlyOpened){
      // The WebView's JS requested focus before the raw floaty was focusable.
      // Grant native focus first, then re-focus the real HTML text input.
      takeFocus();
      ui.run(function(){
        try{
          win.pet.evaluateJavascript(
            "(function(){var i=document.getElementById('message');if(i)i.focus()})()",null
          );
        }catch(_){}
      });
    }
    if(!opened){
      if(focusHeld)releaseFocus();
      return;
    }
    if(!focusHeld)return;
    try{
      if(android.os.Build.VERSION.SDK_INT>=30){
        var insets=win.pet.getRootWindowInsets();
        if(insets){
          if(insets.isVisible(android.view.WindowInsets.Type.ime())){
            imeWasVisible=true;hiddenChecks=0;
          }else if(imeWasVisible&&Date.now()-focusAt>900){
            hiddenChecks++;
            if(hiddenChecks>=3)releaseFocus();
          }
        }
      }
    }catch(_){}
  }
});
var sx=0,sy=0,ox=0,oy=0,at=0,drag=false;
function setPickupState(active){
  // Never expose native objects to untrusted remote HTML. Send only one bool.
  ui.run(function(){
    try{
      win.pet.evaluateJavascript(
        "window.PetPreview&&window.PetPreview.setDragging("+ (!!active ? "true":"false") +")",
        null
      );
    }catch(_){}
  });
}
win.pet.setOnTouchListener(function(v,e){
  var a=e.getActionMasked();
  if(a===0){
    cancelHoldExit();
    fingerDown=true;
    sx=e.getRawX();sy=e.getRawY();ox=win.getX();oy=win.getY();
    at=Date.now();drag=false;
    if(chatOpen&&!focusHeld)takeFocus();
    if(!chatOpen){
      // Five continuous seconds without crossing the drag threshold.
      holdExitTimer=setTimeout(function(){
        holdExitTimer=null;
        if(fingerDown&&!drag&&!chatOpen&&!shuttingDown)closePetAfterHold();
      },HOLD_TO_CLOSE_MS);
    }
  }else if(a===2){
    var dx=e.getRawX()-sx,dy=e.getRawY()-sy;
    if(!chatOpen&&!drag&&Math.abs(dx)+Math.abs(dy)>dp(12)){
      drag=true;
      cancelHoldExit();
      setPickupState(true);
    }
    if(drag){
      anchorY=Math.max(0,Math.min(device.height-dp(PET_SIZE_DP+BASE_EXTRA_DP),Math.round(oy+dy)));
      win.setPosition(
        Math.max(0,Math.min(device.width-WW,Math.round(ox+dx))),
        Math.max(0,Math.min(device.height-HH,anchorY))
      );
    }
   }else if(a===1){
    fingerDown=false;cancelHoldExit();
    if(drag){setPickupState(false);drag=false;return false;}
    var heldMs=Date.now()-at;
    if(!drag&&!chatOpen){
      if(heldMs>=HOLD_TO_CLOSE_MS)closePetAfterHold();
      // Short holds no longer open chat. Chat opens from the HTML button.
      // Native keyboard focus will be granted after the HTML chat button.
    }
   }else if(a===3){
    fingerDown=false;cancelHoldExit();
    if(drag){setPickupState(false);drag=false;}
  }
  return false; // do not swallow webpage clicks or drag gestures
});
setInterval(function(){
  // Poll only a tiny status string. Needed for chat-button focus + bubble height.
  if(shuttingDown)return;
  if(checking&&Date.now()-checkStartedAt<2000)return;
  checking=true;checkStartedAt=Date.now();
  ui.run(function(){
    try{
      win.pet.evaluateJavascript(
        "(function(){return window.PetPreview&&window.PetPreview.getState?window.PetPreview.getState():'0|8'})()",cb
      );
    }catch(_){
      checking=false;
      if(focusHeld&&Date.now()-focusAt>60000)releaseFocus();
    }
  });
},300);
events.on("exit",function(){
  fingerDown=false;cancelHoldExit();
  shuttingDown=true;
  try{win.disableFocus()}catch(_){}
  try{win.close()}catch(_){}
});

// Startup restore is only artwork/settings, never a key or a conversation log.
setTimeout(function(){try{if(!payload&&files.exists(cacheFile)){var saved=JSON.parse(files.read(cacheFile));try{var form=JSON.parse(files.read(formCache));if(form.revision===saved.revision&&form.charId===saved.charId&&saved.pack.forms.some(function(f){return f.id===form.formId;}))saved.binding.formId=form.formId;}catch(_){}apply(saved);}}catch(e){toastLog('旧桌宠缓存未恢复，请从糯米机重新同步：'+e);}},1800);
var random=new java.security.SecureRandom(),pin=String(100000+random.nextInt(900000)),badPins=0,server;
function token(){var b=java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,24);random.nextBytes(b);var out='';for(var i=0;i<b.length;i++)out+=('0'+((b[i]&255).toString(16))).slice(-2);return out;}
var ORIGIN='https://yanlue1211.github.io';
function respond(socket,code,obj,origin){var data=new java.lang.String(JSON.stringify(obj||{})).getBytes('UTF-8');var h='HTTP/1.1 '+code+'\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: '+data.length+'\r\nCache-Control: no-store\r\nConnection: close\r\n';if(origin===ORIGIN)h+='Access-Control-Allow-Origin: '+ORIGIN+'\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-TapNest-Token\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n';var o=socket.getOutputStream();o.write(new java.lang.String(h+'\r\n').getBytes('UTF-8'));o.write(data);o.flush();}
function line(inp){var b=new java.io.ByteArrayOutputStream();try{while(b.size()<4096){var n=inp.read();if(n<0||n===10)break;if(n!==13)b.write(n);}return String(b.toString('UTF-8'));}finally{b.close();}}
function handle(socket){var origin='';try{socket.setSoTimeout(5000);var inp=new java.io.BufferedInputStream(socket.getInputStream()),parts=line(inp).split(' '),method=parts[0],path=parts[1],length=0,key='';for(var i=0;i<65;i++){var l=line(inp);if(!l)break;var n=l.indexOf(':'),name=l.slice(0,n).trim().toLowerCase(),value=l.slice(n+1).trim();if(name==='origin')origin=value;if(name==='content-length')length=Number(value);if(name==='x-tapnest-token')key=value;}
 function ok(o){respond(socket,'200 OK',Object.assign({ok:true},o||{}),origin);}function bad(s){respond(socket,'400 Bad Request',{ok:false,error:s},origin);}
 if(origin!==ORIGIN)return respond(socket,'403 Forbidden',{ok:false,error:'origin'},origin);if(method==='OPTIONS')return ok();if(method!=='GET'&&method!=='POST')return bad('method');if(!isFinite(length)||length<0||length>120000)return bad('request too large');
 var obj={};if(method==='POST'){var buf=java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,length),at=0;while(at<length){var got=inp.read(buf,at,length-at);if(got<=0)throw Error('truncated');at+=got;}obj=JSON.parse(String(new java.lang.String(buf,'UTF-8'))||'{}');}
 if(path==='/health')return ok({version:2,paired:!!session});if(path==='/pair'&&method==='POST'){if(badPins>=6)return bad('配对失败过多，请重启脚本');if(String(obj.pin)!==pin){badPins++;return bad('配对码错误');}session=token();badPins=0;lastWatch=Date.now();return ok({token:session,version:2,binding:payload?{charId:payload.charId,formId:payload.binding.formId,revision:payload.revision}:null});}
 if(!session||key!==session)return respond(socket,'401 Unauthorized',{ok:false,error:'pair first'},origin);
 lastWatch=Date.now();
 if(path==='/sync/begin'&&method==='POST'){if(typeof obj.id!=='string'||!isFinite(obj.chars)||obj.chars<1||obj.chars>48*1024*1024)return bad('sync size');upload={id:obj.id,chars:obj.chars,text:'',at:Date.now()};return ok();}
 if(path==='/sync/chunk'&&method==='POST'){if(!upload||upload.id!==obj.id||Date.now()-upload.at>180000||obj.offset!==upload.text.length||typeof obj.text!=='string'||obj.text.length>24000||upload.text.length+obj.text.length>upload.chars)return bad('同步已过期或分片顺序错误');upload.text+=obj.text;return ok();}
 if(path==='/sync/commit'&&method==='POST'){if(!upload||upload.id!==obj.id||upload.text.length!==upload.chars)return bad('模型不完整');var text=upload.text;upload=null;apply(JSON.parse(text));return ok({revision:payload.revision});}
 if(path==='/state'&&method==='GET')return ok({render:renderState});
 if(path==='/watch'&&method==='GET'){lastWatch=Date.now();eventsQueue=eventsQueue.filter(function(e){return e.kind!=='timer'||Date.now()-e.at<30000;});var until=Date.now()+12000;while(!ended&&session===key&&!eventsQueue.length&&Date.now()<until)sleep(100);if(session!==key)return bad('配对已改变');lastWatch=Date.now();return ok({events:eventsQueue.slice(0,10)});}
 if(path==='/ack'&&method==='POST'){var ids=Array.isArray(obj.ids)?obj.ids.slice(0,12):[];eventsQueue=eventsQueue.filter(function(e){return ids.indexOf(e.id)<0;});apiPending=eventsQueue.some(function(e){return e.kind!=='form';});return ok();}
 if(path==='/busy'&&method==='POST'){if(payload&&obj.revision===payload.revision){busy=!!obj.busy;if(busy)thinking();}return ok();}
 if((path==='/speech'||path==='/error')&&method==='POST'){if(!payload||obj.revision!==payload.revision||path==='/speech'&&obj.charId!==payload.charId||obj.formId&&obj.formId!==payload.binding.formId)return bad('旧角色或旧形态回复已丢弃');if(path==='/speech'){if(spokenIds.indexOf(obj.id)>=0)return ok();spokenIds.push(obj.id);if(spokenIds.length>100)spokenIds.shift();}pendingUntil=0;speak(String(obj.text||'').slice(0,1500));return ok();}
 return bad('unknown endpoint');
 }catch(e){try{respond(socket,'500 Internal Server Error',{ok:false,error:String(e.message||e).slice(0,150)},origin);}catch(_){}}finally{try{socket.close();}catch(_){}}}
try{server=new java.net.ServerSocket(18347,8,java.net.InetAddress.getByName('127.0.0.1'));server.setSoTimeout(1000);}catch(e){toastLog('18347端口被占用，请停止旧版桌宠后重试');win.close();exit();}
var slots=new java.util.concurrent.Semaphore(6);
threads.start(function(){while(!ended){try{var sock=server.accept();if(!slots.tryAcquire()){sock.close();continue;}threads.start((function(s){return function(){try{handle(s);}finally{slots.release();}};})(sock));}catch(e){if(!ended&&!String(e).includes('SocketTimeout'))sleep(300);}}});
var draining=false,drainCb=new JavaAdapter(android.webkit.ValueCallback,{onReceiveValue:function(raw){draining=false;try{var event=JSON.parse(String(raw));if(event)interaction(event);}catch(_){}}});
setInterval(function(){if(ended||draining)return;draining=true;ui.run(function(){try{win.pet.evaluateJavascript('window.PetPreview&&window.PetPreview.popOutgoing?window.PetPreview.popOutgoing():null',drainCb);}catch(_){draining=false;}});},250);
setInterval(dispatchBurst,200);
setInterval(function(){if(pendingUntil&&Date.now()>pendingUntil){pendingUntil=0;busy=false;apiPending=false;speak('等待回复超时，请到糯米机桌宠App查看连接状态。');}if(!payload||!payload.binding.autoEnabled||renderState.status!=='ready'||renderState.revision!==payload.revision)return;var now=Date.now();if(now<nextTimer)return;nextTimer=now+payload.binding.intervalMinutes*60000;if(busy||apiPending||chatOpen||now-lastInteraction<15000)return;if(payload.binding.apiEnabled){if(session&&now-lastWatch<30000)emit('timer');}else chooseLine('auto');},1000);
events.on('exit',function(){ended=true;try{server.close();}catch(_){}try{win.close();}catch(_){}});
toastLog('🐾 桌宠V2已在手机桌面运行\n糯米机 → 桌宠App → 输入六位配对码：'+pin+'\n点💬聊天，拖动移动，按住5秒关闭。');
setInterval(function(){},1000);

var stateReading=false,stateCb=new JavaAdapter(android.webkit.ValueCallback,{onReceiveValue:function(raw){stateReading=false;try{var s=JSON.parse(String(raw));if(s&&payload&&s.revision===payload.revision)renderState=s;}catch(_){}}});
setInterval(function(){if(ended||stateReading)return;stateReading=true;ui.run(function(){try{win.pet.evaluateJavascript('window.PetPreview&&window.PetPreview.getLoadState?window.PetPreview.getLoadState():null',stateCb);}catch(_){stateReading=false;}});},500);
