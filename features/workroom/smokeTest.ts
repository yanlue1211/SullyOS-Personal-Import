import {buildWorkroomDocument,WORKROOM_SANDBOX} from './runner';
import {createWorkroomHost} from './host';
import type {WorkroomCode} from './schema';
/** Browser startup observation only. No original state, chat side effects or external model calls. */
export function smokeTestWorkroom(code:WorkroomCode,signal:AbortSignal):Promise<{errors:string[];notes:string}>{
    signal.throwIfAborted();
    if(typeof document==='undefined')return Promise.reject(Error('当前环境没有组件运行器'));
    return new Promise((resolve,reject)=>{
        const frame=document.createElement('iframe'),session=crypto.randomUUID(),errors:string[]=[];
        let timer:ReturnType<typeof setTimeout>,ready=false,loads=0,finished=false;
        const cleanup=()=>{clearTimeout(timer);host.close();frame.remove();signal.removeEventListener('abort',abort);};
        const finish=()=>{if(finished)return;finished=true;cleanup();resolve({errors:errors.slice(0,20),notes:ready?'启动观察结束；仅检查加载和短时运行错误，未验证所有玩法。':'组件未在规定时间内完成启动；未通过启动观察。'});};
        const abort=()=>{if(finished)return;finished=true;cleanup();reject(signal.reason||new DOMException('测试取消','AbortError'));};
        const host=createWorkroomHost('smoke','smoke','smoke',session,{onError:text=>{if(errors.length<20)errors.push(text.slice(0,2000));},onStop:()=>{errors.push('运行通道已撤销');finish();},onReady:()=>{if(ready)return;ready=true;clearTimeout(timer);timer=setTimeout(finish,800);}},true);
        frame.setAttribute('sandbox',WORKROOM_SANDBOX);frame.referrerPolicy='no-referrer';
        frame.style.cssText='position:fixed;left:-10000px;top:0;width:360px;height:640px;border:0;pointer-events:none';
        frame.setAttribute('aria-hidden','true');frame.allow="camera 'none'; microphone 'none'; geolocation 'none'";
        frame.onload=()=>{if(finished)return;if(++loads>1){errors.push('组件尝试导航，测试已停止');finish();return;}const channel=new MessageChannel();host.bind(channel.port1);frame.contentWindow?.postMessage({workroomSession:session},'*',[channel.port2]);};
        signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>{errors.push('启动观察超时');finish();},5000);
        try{frame.srcdoc=buildWorkroomDocument(code,session);document.body.append(frame);}catch(error){finished=true;cleanup();reject(error);}
    });
}
