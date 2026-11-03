export interface CallHandsFreeConditions {
 inCall:boolean;visible:boolean;modalOpen:boolean;generating:boolean;
 playbackActive:boolean;manualRecording:boolean;transcribing:boolean;draft:string;
}
/** Read real transport activity: a stale 'speaking' UI label must not lock the microphone. */
export function callHandsFreeWaitReason(state:CallHandsFreeConditions):string {
 if(!state.inCall||!state.visible)return '通话已暂停';
 if(state.modalOpen)return '等待关闭弹窗';
 if(state.generating)return '等待对方回应';
 if(state.playbackActive)return '等对方说完';
 if(state.manualRecording||state.transcribing)return '等待当前录音完成';
 if(state.draft.trim())return '先发送或清空草稿';
 return '';
}
export function isCallPlaybackActive(audio:Pick<HTMLMediaElement,'paused'|'ended'>|null,streamStatus?:string,silentSpeech=false,priming=false):boolean {
 return silentSpeech||streamStatus==='loading'||streamStatus==='playing'||!!(audio&&!priming&&!audio.paused&&!audio.ended);
}
