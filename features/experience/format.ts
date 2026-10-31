export interface RealMedia {kind:'image'|'video';originalRef:string;frames:Array<{timeSeconds:number;image:string}>;name:string;inPerson:boolean}
export function mediaText(media:RealMedia):string{return media.kind==='image'?(media.inPerson?'【现场实拍】用户提供了此刻所处环境的真实照片，以可见内容为现场线索；不推测画面外的事。':'【真实图片】用户发送了一张真实照片。'):`【真实视频】${media.name}。已截取 ${media.frames.length} 帧，时间点：${media.frames.map(f=>f.timeSeconds.toFixed(1)+'秒').join('、')}。仅据这些可见画面理解，不假装听到声音或看到未截取片段。`;}
export function readRealMedia(value:any):RealMedia|undefined{
 if(!value||!['image','video'].includes(value.kind)||typeof value.originalRef!=='string'||!Array.isArray(value.frames)||!value.frames.length||value.frames.length>6)return;
 if(value.frames.some((f:any)=>typeof f.image!=='string'||!f.image.startsWith('blobref:')||!Number.isFinite(f.timeSeconds)||f.timeSeconds<0))return;
 return value;
}

export function realMediaContent(message:{content:string;metadata?:any},useDescription=false):any{
 const media=readRealMedia(message.metadata?.realMedia);if(!media)return message.content;
 const text=mediaText(media);const description=typeof message.metadata?.visionDescription==='string'?message.metadata.visionDescription.trim():'';
 if(description)return text+'\n画面描述：'+description;
 if(useDescription)return text+'\n画面尚未成功识别，不要编造具体内容。';
 return [{type:'text',text},...media.frames.map(f=>({type:'image_url',image_url:{url:f.image}}))];
}
