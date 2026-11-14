/** Only our local transport control flow is quiet; API and genuine network failures stay visible. */
export function petControlAbort(){return Object.assign(new DOMException('桌宠连接或设置已切换','AbortError'),{tapnestControlAbort:true});}
export function petTimeout(path:string){return Object.assign(new DOMException(path==='/watch'?'桌宠等待互动超时，正在恢复连接':'桌宠本机请求超时','TimeoutError'),{tapnestWatchTimeout:path==='/watch'});}
export function isPetControlCancellation(error:any,signal:AbortSignal|null|undefined,url:string){
 try{const u=new URL(url);if(u.origin!=='http://127.0.0.1:18347'||!signal?.aborted)return false;const reason=signal.reason;return !!((reason?.tapnestControlAbort&&error?.name==='AbortError')||(u.pathname==='/watch'&&reason?.tapnestWatchTimeout&&error?.name==='TimeoutError'));}catch{return false;}
}
export const petTransportFailure=(e:any)=>e instanceof TypeError||['AbortError','TimeoutError'].includes(e?.name)||e?.status===401||e?.status>=500;
