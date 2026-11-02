import React,{useEffect,useRef} from 'react';
import type {Comment,Post} from '../features/moments/schema';
export default function MomentsComment({comment:c,post,viewer,onReply,onManage}:{comment:Comment;post:Post;viewer:string;onReply:()=>void;onManage:()=>void}){
 const timer=useRef<ReturnType<typeof setTimeout>>(),held=useRef(false),origin=useRef({x:0,y:0});
 const cancel=()=>{clearTimeout(timer.current);timer.current=undefined;};useEffect(()=>cancel,[]);
 const manageable=viewer==='user'||viewer===c.authorId;
 return <div className="mm-comment" onPointerDown={e=>{if(!manageable||e.button!==0)return;cancel();held.current=false;origin.current={x:e.clientX,y:e.clientY};timer.current=setTimeout(()=>{held.current=true;onManage();},600);}} onPointerMove={e=>{if(Math.hypot(e.clientX-origin.current.x,e.clientY-origin.current.y)>10)cancel();}} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel} onContextMenu={e=>{if(manageable){e.preventDefault();cancel();held.current=true;onManage();}}}>
  <button type="button" aria-label={`回复评论 ${c.name}：${c.text}`} onClick={e=>{if(held.current){held.current=false;e.preventDefault();return;}if(viewer==='user')onReply();}}><b>{c.name}</b>{c.replyTo&&<> 回复 <b>{post.comments.find(x=>x.id===c.replyTo)?.name}</b></>}：{c.text}</button>
  <time className="mm-comment-time" dateTime={new Date(c.at).toISOString()}>{new Date(c.at).toLocaleString([],{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>
 </div>;
}
