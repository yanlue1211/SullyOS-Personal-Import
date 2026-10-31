import React,{useId,useLayoutEffect,useRef,useState} from 'react';
export default function WorkroomSummary({text}:{text:string}){
 const [expanded,setExpanded]=useState(false),[clipped,setClipped]=useState(false),ref=useRef<HTMLParagraphElement>(null),id=useId();
 useLayoutEffect(()=>{if(expanded)return;const node=ref.current;if(!node)return;const measure=()=>setClipped(node.scrollWidth>node.clientWidth+1);measure();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;observer?.observe(node);window.addEventListener('resize',measure);return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};},[text,expanded]);
 return <div className={`wr-summary ${expanded?'expanded':''}`}><p ref={ref} id={id}>{text}</p>{(clipped||expanded)&&<button type="button" className="wr-summary-toggle" aria-controls={id} aria-expanded={expanded} aria-label={expanded?'收起游戏简介':'展开游戏简介'} onClick={()=>setExpanded(value=>!value)}>{expanded?'▴':'▾'}</button>}</div>;
}
