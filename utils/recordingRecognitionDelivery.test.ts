// @vitest-environment jsdom
import { it,expect,vi } from 'vitest';
import { DB } from './db';
import { materializeAudioDescriptions, registerRecordingRecognition, recordingMetadata } from './audioApi';
import { editRecordingText } from '../features/personal/chatMedia/editRecording';
const config={enabled:true,baseUrl:'https://example.invalid/v1',apiKey:'test',model:'test-audio'};
it('includes completed recognition in the initial saved row',async()=>{
 const meta=recordingMetadata({transcript:'正确的原文',analysis:'轻松'},true);
 const id=await DB.saveMessage({charId:'ready',role:'user',type:'audio',content:'blobref:b_ready',metadata:meta});
 const saved=(await DB.getRecentMessagesByCharId('ready',10)).find(m=>m.id===id)!;
 expect(saved.metadata).toMatchObject({audioTranscript:'正确的原文',audioAnalysis:'轻松',audioTextEdited:true});
});
it('continues the same pending recognition after send and publishes the updated row',async()=>{
 let resolve!:(value:any)=>void; const pending=new Promise<any>(r=>{resolve=r;});
 const ref='blobref:b_pending';registerRecordingRecognition(ref,pending);
 const id=await DB.saveMessage({charId:'pending',role:'user',type:'audio',content:ref});
 const row=(await DB.getRecentMessagesByCharId('pending',10)).find(m=>m.id===id)!;
 const listener=vi.fn();window.addEventListener('personal-recording-edited',listener);
 const work=materializeAudioDescriptions([row],config);
 resolve({transcript:'晚到的字幕',analysis:'很平静'});
 const [out]=await work;
 expect(out.metadata?.audioTranscript).toBe('晚到的字幕');
 const [fromStaleHistory]=await materializeAudioDescriptions([row],config);
 expect(fromStaleHistory.metadata?.audioTranscript).toBe('晚到的字幕');
 expect((listener.mock.calls[0][0] as CustomEvent).detail.id).toBe(id);
 window.removeEventListener('personal-recording-edited',listener);
});
it('late recognition cannot overwrite a manual correction',async()=>{
 let resolve!:(value:any)=>void;const pending=new Promise<any>(r=>{resolve=r;});
 const ref='blobref:b_edited';registerRecordingRecognition(ref,pending);
 const id=await DB.saveMessage({charId:'corrected',role:'user',type:'audio',content:ref});
 const row=(await DB.getRecentMessagesByCharId('corrected',10)).find(m=>m.id===id)!;
 const work=materializeAudioDescriptions([row],config);
 await editRecordingText(id,'用户修正','用户修正语气');
 resolve({transcript:'错误字幕',analysis:'错误分析'});
 const [out]=await work;expect(out.metadata?.audioTranscript).toBe('用户修正');
});
