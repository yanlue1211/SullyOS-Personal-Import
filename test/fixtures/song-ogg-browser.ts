import {songAudioToPayload,describeAudioWithAudioApi} from '../../utils/audioApi';
const result=document.querySelector('#result')!;
try{
 const raw=await (await fetch('/test/fixtures/audio/recognition-tone.ogg')).arrayBuffer();
 const source=new Blob([raw],{type:'audio/ogg'});
 const payload=await songAudioToPayload(source,'recognition-tone.ogg');
 const bytes=Uint8Array.from(atob(payload.base64),c=>c.charCodeAt(0));const view=new DataView(bytes.buffer);
 if(payload.format!=='wav'||String.fromCharCode(...bytes.slice(0,4))!=='RIFF'||view.getUint32(24,true)!==24000||view.getUint16(22,true)!==1)throw Error('Wrong WAV format');
 if(Math.abs(view.getUint32(40,true)/2/24000-1)>.03)throw Error('Duration changed');
 let energy=0;for(let i=44;i<bytes.length;i+=2)energy+=Math.abs(view.getInt16(i,true));if(energy<1000)throw Error('Audio was silent');
 if(new Uint8Array(await source.arrayBuffer()).some((b,i)=>b!==new Uint8Array(raw)[i]))throw Error('Original audio changed');
 let sent=false;const realFetch=window.fetch;
 window.fetch=async(input,init)=>{
  if(String(input)==='https://audio.invalid/v1/chat/completions'){
   const body=JSON.parse(String(init?.body));const part=body.messages[1].content.find(p=>p.type==='input_audio');
   if(part.input_audio.format!=='wav'||part.input_audio.data!==payload.base64)throw Error('Request lost converted bytes');
   sent=true;return Response.json({choices:[{message:{content:'这是一段持续的单音，没有人声。'}}]});
  }
  return realFetch(input,init);
 };
 try{await describeAudioWithAudioApi(payload,{enabled:true,baseUrl:'https://audio.invalid/v1',apiKey:'synthetic-test',model:'gemini-4-argon'});}finally{window.fetch=realFetch;}
 if(!sent)throw Error('No request');result.textContent='PASS: real OGG → PCM WAV → input_audio';result.setAttribute('data-passed','true');
}catch(e){result.textContent='FAIL: '+String(e);result.setAttribute('data-passed','false');}
