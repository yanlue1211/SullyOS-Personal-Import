import React, {useEffect,useState} from 'react';
import {CommerceOrder,orderStatus} from '../../utils/personalCommerce';
export default function OrderCard({order:o,delivered=false,historical=false}:{order:CommerceOrder;delivered?:boolean;historical?:boolean}){
 const [now,setNow]=useState(Date.now());const [expanded,setExpanded]=useState(false);
 useEffect(()=>{if(historical)return;const id=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(id);},[historical]);
 const food=o.product.kind==='meituan';
 return <button onClick={()=>setExpanded(v=>!v)} className="block w-full text-left rounded-2xl overflow-hidden border border-black/10 shadow-sm" style={{maxWidth:300,background:food?'#fffbdd':'#fff4eb',color:'#382a20'}}>
 <div className="px-4 py-2 text-xs font-bold" style={{background:food?'#ffd84a':'#ffb682'}}>{food?'美团':'淘宝'} · 订单 <span className="float-right">{delivered?(food?'已送达':'已签收'):historical?'已下单':orderStatus(o,now)}</span></div>
 <div className="p-4"><div className="text-xs opacity-60 mb-1">{o.buyer==='char'?o.charName:o.userName} → {o.recipient==='char'?o.charName:o.userName}</div><strong className="block text-sm">{o.product.title}</strong>{o.selectedOptions&&<p className="text-xs opacity-70 mt-1">{Object.entries(o.selectedOptions).map(([k,v])=>k+'：'+v).join(' · ')}</p>}<p className="text-xs opacity-70 my-2">{o.product.shop} · ¥{(o.unitPrice??o.product.price).toFixed(2)}{o.quantity&&o.quantity>1?' ×'+o.quantity:''}</p><div className="text-xs">{delivered?'已于':'预计'} {new Date(o.eta).toLocaleString()} {delivered?'送达':''}</div>
 {expanded&&<div className="text-xs mt-3 pt-3 border-t border-black/10 leading-relaxed"><p>{o.product.detail}</p><p>下单时间：{new Date(o.createdAt).toLocaleString()}</p><p>接单 → {food?'制作 → 配送':'发货 → 运输 → 派送'} → 送达</p></div>}</div></button>;
}
