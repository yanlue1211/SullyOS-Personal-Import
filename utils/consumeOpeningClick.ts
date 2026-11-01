/** A layout opened on pointerdown must not receive that pointer's compatibility click. */
export function consumeOpeningClick():()=>void{
 const clear=()=>{document.removeEventListener('click',block,true);document.removeEventListener('pointerdown',clear,true);document.removeEventListener('keydown',clear,true);clearTimeout(timer);};
 const block=(event:MouseEvent)=>{event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();clear();};
 const timer=setTimeout(clear,900);document.addEventListener('click',block,true);document.addEventListener('pointerdown',clear,{capture:true,once:true});document.addEventListener('keydown',clear,{capture:true,once:true});return clear;
}
