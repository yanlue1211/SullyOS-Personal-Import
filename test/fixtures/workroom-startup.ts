import {smokeTestWorkroom} from '../../features/workroom/smokeTest';
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
document.querySelector('#run')!.addEventListener('click',async()=>{
 try{
  const broken=await smokeTestWorkroom({html:'<canvas></canvas>',css:'',js:'let items;requestAnimationFrame(()=>items.forEach(()=>{}));'},new AbortController().signal);
  check(broken.errors.some(e=>e.includes('forEach')),'未捕获首帧未初始化数组');
  const good=await smokeTestWorkroom({html:'<main id="app"><section id="menu"><button>开始</button></section><canvas></canvas></main>',css:'#app{height:100%;width:100%}#menu{height:100%;overflow:auto}button{margin-top:900px}',js:`const items=[];let frames=0;function draw(){items.forEach(()=>{});frames++;requestAnimationFrame(draw)}draw();setTimeout(()=>{if(document.querySelector('#app').clientHeight!==640)throw Error('根容器高度未撑满');const menu=document.querySelector('#menu');if(menu.scrollHeight<=menu.clientHeight)throw Error('短屏菜单不可滚动');menu.scrollTop=1000;if(!menu.scrollTop)throw Error('按钮不可到达');if(frames<2)throw Error('动画未继续');},300);`},new AbortController().signal);
  check(!good.errors.length,JSON.stringify(good));
  document.querySelector('#result')!.textContent='PASS';
 }catch(error){document.querySelector('#result')!.textContent='FAIL: '+String(error);}
});
