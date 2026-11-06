let target:string|null=null;
export const yueqiLaunch={request:(id:string)=>{target=id;window.dispatchEvent(new Event('yueqi-launch'));},consume:()=>{const id=target;target=null;return id;}};
