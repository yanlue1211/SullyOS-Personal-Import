import React,{useEffect,useState} from 'react';
import {useOS} from '../../context/OSContext';
import {AppID} from '../../types';
import {workroomLaunch} from '../../features/workroom/launch';
import {WORKROOM_HISTORY_UPDATED} from '../../features/workroom/delivery';
import {dismissWorkroomNotice,listWorkroomNotices,WORKROOM_NOTICE_UPDATED} from '../../features/workroom/notices';
import type {WorkroomStoredEvent} from '../../features/workroom/schema';
/** Notification state is independent of the immutable chat snapshot and its delivery marker. */
export default function WorkroomNotification(){
    const {openApp}=useOS();const [rows,setRows]=useState<WorkroomStoredEvent[]>([]),[error,setError]=useState('');
    useEffect(()=>{let active=true,sequence=0;const refresh=async()=>{const current=++sequence;try{const result=await listWorkroomNotices();if(active&&sequence===current)setRows(result);}catch{if(active)setError('作品通知读取失败');}};
        void refresh();const update=()=>void refresh();window.addEventListener(WORKROOM_HISTORY_UPDATED,update);window.addEventListener(WORKROOM_NOTICE_UPDATED,update);window.addEventListener('focus',update);
        return()=>{active=false;window.removeEventListener(WORKROOM_HISTORY_UPDATED,update);window.removeEventListener(WORKROOM_NOTICE_UPDATED,update);window.removeEventListener('focus',update);};},[]);
    const first=rows[0];if(!first)return null;
    const close=async()=>{try{await dismissWorkroomNotice(first.id);setError('');}catch{setError('通知未能关闭，请重试');}};
    return <aside role="status" aria-label="造物间作品完成通知" className="absolute top-16 inset-x-4 z-[90] rounded-2xl border border-amber-200 bg-white p-4 shadow-lg text-stone-700">
        <strong>🎁 {first.event.charName}完成了作品！</strong><p>{first.event.title}</p><p className="text-xs">{first.event.summary}</p>
        <div className="flex gap-4 mt-3 text-sm"><button onClick={()=>{workroomLaunch.request({charId:first.charId,workId:first.workId});openApp(AppID.Workroom);void close();}}>打开看看</button><button onClick={()=>void close()}>稍后再说</button></div>{error&&<p>{error}</p>}
    </aside>;
}
