/* TapNest portable PNG playback. No API keys, memory or executable ZIP content. */
(function(root){'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0)),rad=x=>x*Math.PI/180;
const I=[1,0,0,1,0,0],T=(x,y)=>[1,0,0,1,x,y],S=(x,y)=>[x,0,0,y,0,0],R=d=>{const a=rad(d);return [Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]};
function mul(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
const p0=()=>({x:0,y:0,angle:0,scaleX:1,scaleY:1,alpha:1});
function sample(clip,id,t){const f=(clip?.tracks||[]).find(x=>x.layerId===id)?.frames?.slice().sort((a,b)=>a.atMs-b.atMs);if(!f?.length)return p0();if(clip.loop&&clip.durationMs)t%=clip.durationMs;const i=f.findIndex(x=>x.atMs>t);if(i===0)return {...p0(),...f[0].pose};if(i<0)return {...p0(),...f[f.length-1].pose};const a=f[i-1],b=f[i];let u=clamp((t-a.atMs)/(b.atMs-a.atMs),0,1);if(a.easeToNext==='HOLD')u=0;else if(a.easeToNext!=='LINEAR')u=u*u*(3-2*u);const x={...p0(),...a.pose},y={...p0(),...b.pose},out={};for(const k of Object.keys(x))out[k]=x[k]+(y[k]-x[k])*u;return out;}
function planeAngle(layer,type,wave,amplitude){const p=layer[type+'Plane'];if(p?.enabled){const a=clamp(p.negativeLimit??45,0,180),b=clamp(p.positiveLimit??45,0,180);return -a+(wave+1)*.5*(a+b);}return wave*amplitude;}
function motion(l,t,age,canvasHeight=300){const q=p0();const period=Math.max(1000,(l.periodicIntervalSeconds||7)*1000),periodAge=(t+hash(l.syncPairedPeriodic===false?l.id:(l.mirroredFromId||l.id))%1000)%period;
 const tap=age>=0&&age<Math.max(l.tapFlexible?.durationMs||680,680),per=l.periodicEnabled&&periodAge<Math.max(l.periodicFlexible?.durationMs||680,680);
 function impulse(type,a){const flex=l[type+'Flexible']||{},speed=clamp(flex.speed||3,.1,10);const wave=Math.sin(a/1000*Math.PI*speed*2)*Math.exp(-a/Math.max(300,flex.durationMs||680));const kind=type==='tap'?l.tapMotion:(l.periodicMotion||l.tapMotion);const amp=flex.amplitude??18;const angle=planeAngle(l,type,wave,amp)*(l[type+'StartReversed']?-1:1)*(l.reflectedMotion?-1:1);if(kind==='HAT_POP'){const u=clamp(a/900,0,1);q.y-=4*u*(1-u)*(l.hatFlightHeight??.22)*canvasHeight;}else if(kind==='BOUNCE')q.y-=Math.abs(wave)*amp;else q.angle+=angle;}
 if(tap&&(l.tapShake||!l.interactionConfigured&&/^head_|^face_/.test(l.id)))impulse('tap',age);else if(per&&(l.periodicAction!=='SWITCH_FRAME'))impulse('periodic',periodAge);
 if(l.idleSwing){const w=Math.sin(t/1000*Math.PI*2*(l.idleSpeed||.7))*(l.idleStartReversed?-1:1);if(!(l.bones?.length>1)&&!l.boneChains?.length)q.angle+=planeAngle(l,'idle',w,l.idleAmplitude||10)*(l.reflectedMotion?-1:1);}
 return {pose:q,tap,per,periodAge};}
function hash(s){let h=0;for(const c of String(s))h=Math.imul(h,31)+c.charCodeAt(0)|0;return h>>>0;}
function regionWeight(r,x,y){if(!r)return 1;r={left:0,top:0,right:1,bottom:1,...r};if(x<r.left||x>r.right||y<r.top||y>r.bottom)return 0;if(r.left===0&&r.top===0&&r.right===1&&r.bottom===1)return 1;return clamp(Math.min(x-r.left,r.right-x,y-r.top,r.bottom-y)/.04,0,1);}
const springStates=new Map();
function mesh(l,w,h,t,n,age){
 const channels=[],m=motion(l,t,age);const type=m.tap&&l.tapFlexible?.enabled?'tap':m.per&&l.periodicFlexible?.enabled?'periodic':'idle';
 const enabled=type!=='idle'||l.idleSwing&&l.idleFlexibleEnabled!==false;
 const bones=l[type+'Bones']||l.bones||[],chains=l[type+'BoneChains']||l.boneChains||[];
 if(enabled&&bones.length>1)channels.push({...l,bones,region:l[type+'BoneRegion']||l.boneRegion});
 if(enabled)chains.forEach((c,i)=>{if(c.bones?.length>1)channels.push({...l,...c,id:l.id+':'+i,bones:c.bones,region:c.region});});
 const prepared=channels.map(c=>{
  const base=c.bones.map(p=>[clamp(p.x,0,1)*w,clamp(p.y,0,1)*h]),moved=[base[0]],angles=[];
  const lengths=base.slice(1).map((p,i)=>Math.hypot(p[0]-base[i][0],p[1]-base[i][1])),sum=lengths.reduce((a,b)=>a+b,0)||1;
  const flex=type==='idle'?null:c[type+'Flexible'],speed=flex?.speed??c.idleSpeed??.7,time=type==='tap'?age:type==='periodic'?m.periodAge:t;
  const count=base.length-1,targets=[],scope=type==='idle'?(c.idleScope||'WHOLE'):(flex?.scope||'TIP');let total=0;
  for(let j=0;j<count;j++){const progress=(total+lengths[j]/2)/sum;total+=lengths[j];const weight=scope==='TIP'?progress*progress:scope==='DISTAL'?progress:scope==='UPPER'?1-progress:scope==='MIDDLE'?Math.sin(progress*Math.PI):scope==='LOWER'?progress:1;
   let wave=Math.sin(2*Math.PI*speed*(time/1000-j*(c.idleLagSeconds??.18)));
   if(type!=='idle')wave*=Math.exp(-time/Math.max(300,flex?.durationMs||680));
   if(c.swingRange==='OUTWARD_ONLY')wave=(wave+1)/2;
   let angle=planeAngle(c,type,wave,flex?.amplitude??c.idleAmplitude??10)*weight;
   if(c.reflectedMotion)angle=-angle;if(c[type+'StartReversed'])angle=-angle;targets.push(angle);
  }
  let turns=targets;
  if(c.swingMode==='SPRING'){
   const key=c.id+':'+type,soft=clamp(flex?.softness??c.springSoftness??.72,0,1),damping=clamp(flex?.damping??c.springDamping??.4,.1,1.3),omega=2*Math.PI*(3.3-2.6*soft);
   let state=springStates.get(key);
   if(!state||state.a.length!==count||time<state.t||time-state.t>600){state={t:time,a:targets.slice(),v:targets.map(()=>0)};springStates.set(key,state);}
   else {const steps=Math.max(1,Math.min(80,Math.ceil((time-state.t)/8))),dt=(time-state.t)/steps/1000;
    for(let step=0;step<steps;step++)for(let j=0;j<count;j++){
     const target=j===0?targets[0]:state.a[j-1]*.5+targets[j]*.5;
     const acceleration=omega*omega*(target-state.a[j])-2*damping*omega*state.v[j];
     state.v[j]=clamp(state.v[j]+acceleration*dt,-550,550);state.a[j]=clamp(state.a[j]+state.v[j]*dt,-180,180);
    }state.t=time;
   }turns=state.a;
  }
  for(let j=1;j<base.length;j++){
   // Each absolute bone angle is driven smoothly; small one-sided ranges do not use a hard stop.
   const a=rad(turns[j-1]||0),vx=base[j][0]-base[j-1][0],vy=base[j][1]-base[j-1][1],dir=c.bones[j].swingDirection||c.bones[0].swingDirection,offset=Math.hypot(vx,vy)*Math.sin(a);
   let nx=vx*Math.cos(a)-vy*Math.sin(a),ny=vx*Math.sin(a)+vy*Math.cos(a);
   if(dir==='FIXED'){nx=vx;ny=vy;}else if(/^HORIZONTAL/.test(dir||'')){nx=vx+offset*(dir.endsWith('REVERSE')?-1:1);ny=vy;}else if(/^VERTICAL/.test(dir||'')){nx=vx;ny=vy+offset*(dir.endsWith('REVERSE')?-1:1);}
   if(c[type+'Plane']?.enabled&&c[type+'Plane'].linear){const axis=rad(c[type+'Plane'].axisDegrees||0);nx=vx+offset*Math.cos(axis);ny=vy+offset*Math.sin(axis);}
   const last=moved[j-1];moved.push([last[0]+nx,last[1]+ny]);angles.push(Math.atan2(ny,nx)-Math.atan2(vy,vx));
  }return {c,base,moved,angles};
 });
 const vertices=new Float32Array((n+1)*(n+1)*2);let k=0;
 for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
  const x=col*w/n,y=row*h/n;let dx=0,dy=0,weight=0;
  for(const {c,base,moved,angles} of prepared){const r=regionWeight(c.region,x/w,y/h);if(!r)continue;let best=Infinity,index=0,u=0;
   for(let j=0;j<base.length-1;j++){const vx=base[j+1][0]-base[j][0],vy=base[j+1][1]-base[j][1],d=vx*vx+vy*vy;const v=d?clamp(((x-base[j][0])*vx+(y-base[j][1])*vy)/d,0,1):0,dist=(x-base[j][0]-v*vx)**2+(y-base[j][1]-v*vy)**2;if(dist<best){best=dist;index=j;u=v;}}
   const j=index,bx=base[j][0]+(base[j+1][0]-base[j][0])*u,by=base[j][1]+(base[j+1][1]-base[j][1])*u,mx=moved[j][0]+(moved[j+1][0]-moved[j][0])*u,my=moved[j][1]+(moved[j+1][1]-moved[j][1])*u,a=angles[j]||0;
   let px=mx+(x-bx)*Math.cos(a)-(y-by)*Math.sin(a),py=my+(x-bx)*Math.sin(a)+(y-by)*Math.cos(a);
   const preserve=clamp(c.shapePreservation||0,0,1),rootAngle=angles[0]||0,rx=base[0][0]+(x-base[0][0])*Math.cos(rootAngle)-(y-base[0][1])*Math.sin(rootAngle),ry=base[0][1]+(x-base[0][0])*Math.sin(rootAngle)+(y-base[0][1])*Math.cos(rootAngle);
   px+=(rx-px)*preserve;py+=(ry-py)*preserve;dx+=(px-x)*r;dy+=(py-y)*r;weight+=r;
  }vertices[k++]=x+dx/Math.max(1,weight);vertices[k++]=y+dy/Math.max(1,weight);
 }return vertices;
}
function triangle(ctx,img,src,dst){const [x0,y0,x1,y1,x2,y2]=src,[u0,v0,u1,v1,u2,v2]=dst;const d=x0*(y1-y2)+x1*(y2-y0)+x2*(y0-y1);if(Math.abs(d)<.00001)return;const a=(u0*(y1-y2)+u1*(y2-y0)+u2*(y0-y1))/d,c=(u0*(x2-x1)+u1*(x0-x2)+u2*(x1-x0))/d,e=(u0*(x1*y2-x2*y1)+u1*(x2*y0-x0*y2)+u2*(x0*y1-x1*y0))/d,b=(v0*(y1-y2)+v1*(y2-y0)+v2*(y0-y1))/d,f=(v0*(x1*y2-x2*y1)+v1*(x2*y0-x0*y2)+v2*(x0*y1-x1*y0))/d,g=(v0*(x2-x1)+v1*(x0-x2)+v2*(x1-x0))/d;ctx.save();ctx.beginPath();ctx.moveTo(u0,v0);ctx.lineTo(u1,v1);ctx.lineTo(u2,v2);ctx.closePath();ctx.clip();ctx.transform(a,b,c,g,e,f);ctx.drawImage(img,0,0);ctx.restore();}
function make(canvas){const ctx=canvas.getContext('2d'),images=new Map();let pack,rig,settings,formId='',started=0,tapAt=-1e9,tapCount=0,isThinking=false,held=false,raf=0,epoch=0,last=0,baseHeight=canvas.clientHeight,requiredHeight=0;
 async function load(p,s){springStates.clear();const run=++epoch;cancelAnimationFrame(raf);const pictures=new Map();await Promise.all(Object.entries(p.assets||{}).map(([name,url])=>new Promise((resolve,reject)=>{if(!/^data:image\/(png|jpeg|webp);base64,/.test(url))return reject(Error('图片格式不支持'));const img=new Image();img.onload=()=>{if(img.naturalWidth>4096||img.naturalHeight>4096)reject(Error('图片尺寸超限'));else{const rig0=p.forms.find(f=>f.rig.layers.some(l=>l.image===name))?.rig||p.forms[0].rig;if(img.width!==rig0.canvasWidth||img.height!==rig0.canvasHeight){const normalized=document.createElement('canvas');normalized.width=rig0.canvasWidth;normalized.height=rig0.layers.some(l=>l.id==='pickup_pose'&&l.image===name)?Math.round(img.height*rig0.canvasWidth/img.width):rig0.canvasHeight;normalized.getContext('2d').drawImage(img,0,0,normalized.width,normalized.height);pictures.set(name,normalized);}else pictures.set(name,img);resolve();}};img.onerror=()=>reject(Error('图片损坏：'+name));img.src=url;})));if(run!==epoch)return;images.clear();for(const [k,v]of pictures)images.set(k,v);pack=p;settings=s;select(s.formId);started=performance.now();raf=requestAnimationFrame(draw);}
 function select(id){springStates.clear();const form=pack.forms.find(f=>f.id===id)||pack.forms[0];formId=form.id;rig=form.rig;tapAt=-1e9;return formId;}
 function draw(time){if(!rig)return;raf=requestAnimationFrame(draw);if(time-last<1000/30)return;last=time;const pickup=held&&rig.pickupArtworkEnabled?images.get(rig.layers.find(l=>l.id==='pickup_pose')?.image):null;const margin0=Math.max(.30,...rig.layers.map(l=>(l.hatFlightHeight||0)+.12)),cssScale=Math.min(canvas.clientWidth/(rig.canvasWidth*1.6),baseHeight/(rig.canvasHeight*(1+margin0+.3)));const stageHeight=pickup?Math.max(baseHeight,(pickup.height*rig.canvasWidth/pickup.width+rig.canvasHeight*margin0+rig.canvasWidth*.18)*cssScale):baseHeight;requiredHeight=stageHeight; if(canvas.style)canvas.style.height=stageHeight+'px';const dpr=Math.min(2,root.devicePixelRatio||1),w=canvas.clientWidth*dpr,h=canvas.clientHeight*dpr;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);
 const t=time-started,age=time-tapAt,margin=Math.max(.30,...rig.layers.map(l=>(l.hatFlightHeight||0)+.12)),scale=Math.min(w/(rig.canvasWidth*1.6),baseHeight*dpr/(rig.canvasHeight*(1+margin+.3))),ox=(w-rig.canvasWidth*scale)/2,oy=rig.canvasHeight*margin*scale;
 const byId=new Map(rig.layers.map(l=>[l.id,l])),poses=new Map();function pose(l){if(poses.has(l.id))return poses.get(l.id);let p=motion(l,t,age,rig.canvasHeight).pose;const clip=rig.clips?.find(c=>c.tracks?.some(tr=>tr.layerId===l.id));if(clip&&(clip.loop||age>=0&&age<clip.durationMs)){const cp=sample(clip,l.id,clip.loop?t:age);for(const key of ['x','y','angle'])p[key]+=cp[key];p.scaleX*=cp.scaleX;p.scaleY*=cp.scaleY;p.alpha*=cp.alpha;}poses.set(l.id,p);return p;}
 const faceType=rig.headMode==='BLANK_HEAD_WITH_FACE'?'face_':'head_',angryLayer=tapCount>=5&&(age<1800||isThinking)?byId.get(rig.rapidTapAngryFrameId):null,angryLegacy=angryLayer&&/^head_\d+$|^face_\d+$/.test(angryLayer.id)?Number(angryLayer.id.split('_')[1]):null,expression=angryLegacy!==null?angryLegacy:age<900&&rig.tapExpression>=0?rig.tapExpression:rig.blinkExpression>=0&&t%5000>4700?rig.blinkExpression:0;
 const special=held&&rig.pickupArtworkEnabled&&images.has(byId.get('pickup_pose')?.image);
 const all=special?[byId.get('pickup_pose')]:rig.layers.slice().sort((a,b)=>(a.bodyLinkedClothing?(byId.get('body')?.zIndex||0)+.1:a.zIndex||0)-(b.bodyLinkedClothing?(byId.get('body')?.zIndex||0)+.1:b.zIndex||0));
 for(const l of all){if(!l||l.frameOwner||!l.image||!images.has(l.image)||!special&&l.id==='pickup_pose')continue;if(!special){if(/^head_\d+$/.test(l.id)&&(faceType!=='head_'||l.id!==faceType+expression&&!(expression&&!byId.has(faceType+expression)&&l.id==='head_0')))continue;if(l.id==='head_blank'&&faceType!=='face_')continue;if(/^face_\d+$/.test(l.id)&&(faceType!=='face_'||l.id!==faceType+expression&&!(expression&&!byId.has(faceType+expression)&&l.id==='face_0')))continue;}
 const skin=l.bodyLinkedClothing?byId.get('body')||l:l,m=motion(skin,t,age);let fi=m.tap&&skin.tapSwitchFrame?skin.tapFrame:m.per&&(skin.periodicSwitchFrame||skin.periodicAction==='SWITCH_FRAME')?skin.periodicFrame:skin.idleBlinkEnabled&&t%5000>4700?skin.blinkFrame:0;
 const frame=angryLayer?.frameOwner===l.id?angryLayer:rig.layers.find(f=>f.frameOwner===l.id&&f.frameIndex===fi);const img=images.get(frame?.image)||images.get(l.image);if(!img)continue;
 const chain=[],seen=new Set();let node=l.bodyLinkedClothing?skin:l;while(node&&!seen.has(node.id)){chain.unshift(node);seen.add(node.id);node=byId.get(node.parentId);}
 let matrix=held?mul(mul(T(rig.canvasWidth/2,0),R(8*Math.sin(t/125))),T(-rig.canvasWidth/2,0)):I,alpha=1;
 for(const part of chain){const p=pose(part),pw=rig.canvasWidth,ph=rig.canvasHeight,px=(part.pivotX??.5)*pw,py=(part.pivotY??.5)*ph,s=clamp(part.restScale??1,.1,4);matrix=mul(matrix,T((part.x||0)+p.x+px*s,(part.y||0)+p.y+py*s));if(part.mirrorX)matrix=mul(matrix,mul(T(rig.canvasWidth-2*px,0),S(-1,1)));matrix=mul(matrix,R(p.angle));matrix=mul(matrix,S(s*p.scaleX,s*p.scaleY));matrix=mul(matrix,T(-px,-py));alpha*=p.alpha;}
 if(rig.idleBreathingEnabled&&!held){const b=1+Math.sin(t/1000*2)*.006*(rig.idleBreathingStrength||1);matrix=mul(matrix,mul(T(rig.canvasWidth/2,rig.canvasHeight),mul(S(1,b),T(-rig.canvasWidth/2,-rig.canvasHeight))));}
 ctx.save();ctx.setTransform(scale,0,0,scale,ox,oy);ctx.transform(...matrix);ctx.globalAlpha=clamp(alpha,0,1);const flexible=(skin.bones?.length>1||skin.boneChains?.length||skin.tapBoneChains?.length||skin.periodicBoneChains?.length)&&!held;
 if(flexible){const n=10,v=mesh(skin,img.width,img.height,t,n,age);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=(y*(n+1)+x)*2,b=a+2,c=a+(n+1)*2,d=c+2;const sx=x*img.width/n,sy=y*img.height/n,ex=(x+1)*img.width/n,ey=(y+1)*img.height/n;triangle(ctx,img,[sx,sy,ex,sy,sx,ey],[v[a],v[a+1],v[b],v[b+1],v[c],v[c+1]]);triangle(ctx,img,[ex,sy,ex,ey,sx,ey],[v[b],v[b+1],v[d],v[d+1],v[c],v[c+1]]);}}
 else ctx.drawImage(img,0,0,rig.canvasWidth,special?img.height*rig.canvasWidth/img.width:rig.canvasHeight);ctx.restore();}
 }
 return {load,select,thinking:v=>{isThinking=!!v;},tap:(count)=>{tapAt=performance.now();tapCount=count||1;},held:v=>{held=!!v;},destroy:()=>{epoch++;cancelAnimationFrame(raf);images.clear();},get requiredHeight(){return requiredHeight||baseHeight;},get formId(){return formId;}};
}
root.TapNestEngine={make,math:{mul,sample,mesh,regionWeight,planeAngle,motion}};
})(typeof window!=='undefined'?window:globalThis);
