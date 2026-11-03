import {it,expect} from 'vitest';
import {callHandsFreeWaitReason,isCallPlaybackActive,type CallHandsFreeConditions} from '../features/personal/calls/readiness';
const idle:CallHandsFreeConditions={inCall:true,visible:true,modalOpen:false,generating:false,playbackActive:false,manualRecording:false,transcribing:false,draft:''};
it('actual audio or streaming activity blocks recording; finished audio unlocks without depending on a speaking label',()=>{
 expect(isCallPlaybackActive({paused:false,ended:false})).toBe(true);
 expect(isCallPlaybackActive({paused:false,ended:true})).toBe(false);
 expect(isCallPlaybackActive({paused:true,ended:false},'playing')).toBe(true);
 expect(isCallPlaybackActive({paused:true,ended:false},'done')).toBe(false);
 expect(isCallPlaybackActive({paused:false,ended:false},undefined,false,true)).toBe(false);
 expect(callHandsFreeWaitReason({...idle,playbackActive:true})).toBe('等对方说完');
 expect(callHandsFreeWaitReason(idle)).toBe('');
});
it('interrupted playback waits only for the real pending request and then automatically unlocks',()=>{
 expect(callHandsFreeWaitReason({...idle,generating:true})).toBe('等待对方回应');
 expect(callHandsFreeWaitReason({...idle,generating:false})).toBe('');
});
it('hidden input does not gate hands-free; real drafts and visible dialogs report why they pause',()=>{
 expect(callHandsFreeWaitReason(idle)).toBe('');
 expect(callHandsFreeWaitReason({...idle,draft:'未发送'})).toBe('先发送或清空草稿');
 expect(callHandsFreeWaitReason({...idle,modalOpen:true})).toBe('等待关闭弹窗');
 expect(callHandsFreeWaitReason({...idle,visible:false})).toBe('通话已暂停');
});
