export const connection={token:'',runtimeToken:'',visible:false,status:'未连接',busy:false,epoch:0,controller:null as AbortController|null};
export const STATE='tapnest-connection-state';
export const report=(s:string)=>{connection.status=s;window.dispatchEvent(new Event(STATE));};
