import {processImageToBlob} from '../../utils/file';
import {putImageBlob,putImageBlobDeduped} from '../../utils/blobRef';
import {extractVideoFrames} from '../../utils/shareVideoFrames';
import {mediaText,type RealMedia} from './format';
export {readRealMedia,mediaText,type RealMedia} from './format';
export interface ExperienceMessage {content:string;metadata:Record<string,any>}
export async function prepareRealMedia(file:File,inPerson:boolean):Promise<ExperienceMessage>{
 if(!file.size||file.size>64*1024*1024)throw Error('请选择64MB以内的图片或视频');
 const video=file.type.startsWith('video/');if(!video&&!file.type.startsWith('image/'))throw Error('不支持的媒体类型');
 const frames:RealMedia['frames']=[];let originalRef:string;
 if(video){const url=URL.createObjectURL(file);try{const extracted=await extractVideoFrames(url,{count:6,width:640});if(!extracted.length)throw Error('视频无法解码或没有可读取画面，请换一个视频');for(const frame of extracted){const blob=await (await fetch(frame.image)).blob();frames.push({...frame,image:(await putImageBlobDeduped(blob)).token});}}finally{URL.revokeObjectURL(url);}originalRef=await putImageBlob(file);}
 else{const blob=await processImageToBlob(file,{maxWidth:1280,quality:.8,forceJpeg:true});originalRef=(await putImageBlobDeduped(blob)).token;frames.push({timeSeconds:0,image:originalRef});}
 const realMedia:RealMedia={kind:video?'video':'image',originalRef,frames,name:file.name.slice(0,150),inPerson};return {content:mediaText(realMedia),metadata:{realMedia}};
}
