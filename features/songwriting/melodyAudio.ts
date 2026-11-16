import {melodyToAbc,type MelodyVersion} from './melody';
const ABCJS_URL = 'https://cdn.jsdelivr.net/npm/abcjs@6.7.2/dist/abcjs-basic-min.js';
let abcScript: Promise<any> | undefined;
/** Version-pinned temporary prototype. Replace with a bundled dependency after mobile acceptance. */
export function loadAbcjs(): Promise<any> {
  const existing = (window as any).ABCJS;
  if (existing?.renderAbc && existing?.synth?.CreateSynth) return Promise.resolve(existing);
  if (!abcScript) abcScript = new Promise((resolve, reject) => {
    const node = document.createElement('script');
    node.src = ABCJS_URL;
    node.async = true;
    node.onload = () => {
      const library = (window as any).ABCJS;
      library?.renderAbc && library?.synth?.CreateSynth ? resolve(library) : reject(Error('乐谱播放器未正确加载'));
    };
    node.onerror = () => reject(Error('无法加载 abcjs，请检查网络'));
    document.head.appendChild(node);
  }).catch(error => {
    abcScript = undefined; // allow a later manual retry
    throw error;
  });
  return abcScript;
}

export async function renderMelodyAudio(version:MelodyVersion,title:string,context?:AudioContext):Promise<{wav:Blob;midi:Blob|null}> {
  const AudioCtx=window.AudioContext||(window as any).webkitAudioContext;
  if(!AudioCtx)throw Error('当前浏览器不支持 Web Audio');
  const ctx=context||new AudioCtx();
  try {
    await ctx.resume();const abc=await loadAbcjs();
    if(!abc.synth.supportsAudio())throw Error('当前浏览器不支持旋律合成');
    const visual=abc.renderAbc('*',melodyToAbc(version,title))?.[0];
    if(!visual)throw Error('乐谱无法演奏');
    const synth=new abc.synth.CreateSynth();
    const sounds=await synth.init({visualObj:visual,audioContext:ctx,options:{chordsOff:true}});
    if(sounds?.error?.length)throw Error('旋律音色未加载完整，请重试');
    await synth.prime();const url=synth.download();
    if(!url?.startsWith('blob:'))throw Error('没有取得旋律 WAV');
    let wav:Blob;try{const response=await fetch(url);if(!response.ok)throw Error('旋律 WAV 读取失败');wav=await response.blob();}finally{URL.revokeObjectURL(url);}
    if(wav.size<44)throw Error('旋律音频为空');
    const bytes=abc.synth.getMidiFile(visual,{midiOutputType:'binary',chordsOff:true});
    return {wav,midi:bytes?(bytes instanceof Blob?bytes:new Blob([bytes],{type:'audio/midi'})):null};
  }finally{if(!context)await ctx.close().catch(()=>{});}
}
