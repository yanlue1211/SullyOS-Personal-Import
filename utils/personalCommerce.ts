import { DB, openDB } from './db';
export type CommerceKind = 'taobao' | 'meituan';
export interface CommerceProduct { id: string; kind: CommerceKind; title: string; shop: string; detail: string; price: number; deliveryMinutes?: number; }
export interface CommerceOrder { id: string; charId: string; charName: string; userName: string; product: CommerceProduct; buyer: 'user'|'char'; recipient: 'user'|'char'; createdAt: number; eta: number; autonomous: boolean; requestId?: string; createdNotified?: boolean; deliveredNotified?: boolean; }
interface State { products: CommerceProduct[]; orders: CommerceOrder[]; }
const KEY = 'personal_commerce_v1';
const empty = (): State => ({products: [], orders: []});
function decode(raw: unknown): State { if (!raw) return empty(); const s = typeof raw === 'string' ? JSON.parse(raw) : raw; if (!Array.isArray(s.products)||!Array.isArray(s.orders)) throw new Error('订单数据无法读取，请保留备份'); return s; }
export const readCommerce = async (): Promise<State> => decode(await DB.getAsset(KEY));
/** One readwrite transaction serializes decisions across tabs, including purchase cooldowns. */
async function mutate<T>(change: (s: State) => T): Promise<T> {
 const db = await openDB();
 return new Promise((resolve,reject) => {
  const tx=db.transaction('assets','readwrite'), store=tx.objectStore('assets'); let result:T, error:unknown;
  const req=store.get(KEY); req.onsuccess=()=>{try{const s=decode(req.result?.data);result=change(s);store.put({id:KEY,data:JSON.stringify(s)});}catch(e){error=e;tx.abort();}};
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error||new Error('订单未保存'));
 });
}
export function normalizeProducts(raw: unknown, kind: CommerceKind): CommerceProduct[] {
 if(!Array.isArray(raw)) throw new Error('商城数据格式不正确');
 const items=raw.slice(0,12).flatMap((v:any)=>typeof v?.title==='string'&&v.title.trim()&&Number.isFinite(Number(v.price))&&Number(v.price)>0&&Number(v.price)<=100000?[{
  id:crypto.randomUUID(),kind,title:v.title.trim().slice(0,80),shop:String(v.shop||'生活小店').slice(0,50),detail:String(v.detail||'').slice(0,250),price:Math.round(Number(v.price)*100)/100,
  deliveryMinutes: Number.isFinite(Number(v.deliveryMinutes)) ? Math.round(Math.min(kind==='meituan'?90:10080,Math.max(kind==='meituan'?15:1440,Number(v.deliveryMinutes)))) : undefined,
 }]:[]);
 if(!items.length) throw new Error('没有生成有效商品，请重试');return items;
}
export async function saveProducts(products:CommerceProduct[],kind:CommerceKind){await mutate(s=>{s.products=[...s.products.filter(p=>p.kind!==kind),...products];});}
export function orderStatus(o:CommerceOrder,now=Date.now()):string {
 const t=Math.max(0,(now-o.createdAt)/(o.eta-o.createdAt));
 if(t>=1)return o.product.kind==='meituan'?'已送达':'已签收';
 const stages=o.product.kind==='meituan'?['商家已接单','商家制作中','骑手配送中']:['等待发货','商家已发货','快递运输中','正在派送'];
 return stages[Math.min(stages.length-1,Math.floor(t*stages.length))];
}
export function purchaseBlock(orders:CommerceOrder[],charId:string,now:number):string {
 const gifts=orders.filter(o=>o.autonomous&&o.buyer==='char'&&o.recipient==='user');
 if(gifts.some(o=>o.eta>now))return '已有给用户的自主购买订单在配送中';
 if(gifts.some(o=>o.charId===charId&&now-o.createdAt<72*3600000))return '该角色近期已经主动购买过，请自然相处';
 if(gifts.some(o=>now-o.createdAt<24*3600000))return '其他角色近期已主动购买过，请避免集中送礼';
 return '';
}
export async function createCommerceOrder(input:{charId:string;charName:string;userName:string;productId:string;buyer:'user'|'char';recipient:'user'|'char';explicitRequest?:boolean;requestId?:string},now=Date.now()):Promise<CommerceOrder>{
 const order=await mutate(s=>{
  const existing=input.requestId&&s.orders.find(o=>o.requestId===input.requestId&&o.charId===input.charId);if(existing)return existing;
  const product=s.products.find(p=>p.id===input.productId);if(!product)throw new Error('商品已失效，请重新逛逛');
  const autonomous=input.buyer==='char'&&!input.explicitRequest;
  if(autonomous){const reason=purchaseBlock(s.orders,input.charId,now);if(reason)throw new Error(reason);}
  const eta=now+(product.deliveryMinutes??(product.kind==='meituan'?35:4320))*60000;
  const order:CommerceOrder={id:crypto.randomUUID(),charId:input.charId,charName:input.charName,userName:input.userName,product,buyer:input.buyer,recipient:input.recipient,createdAt:now,eta,autonomous,requestId:input.requestId};
  s.orders.push(order);return order;
 });
 try { await publishOrderCard(order,false); await markNotified(order.id, false); notify(); } catch { /* Persisted outbox is retried by reconcileCommerce. */ }
 return order;
}
function card(order:CommerceOrder,delivered:boolean){return {type:'commerce_order',order,delivered};}
async function publishOrderCard(order:CommerceOrder,delivered:boolean){const payload=card(order,delivered);await DB.saveMessageOnce(`commerce:${order.id}:${delivered?'delivered':'created'}`,{charId:order.charId,role:'system',type:'score_card',content:JSON.stringify(payload),timestamp:delivered?order.eta:order.createdAt,metadata:{scoreCard:payload,source:'personal-commerce'}});}
const notify=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('commerce-updated'));};
async function markNotified(id:string,delivered:boolean){await mutate(s=>{const o=s.orders.find(o=>o.id===id);if(o){if(delivered)o.deliveredNotified=true;else o.createdNotified=true;}});}
let scanning=false;
/** Durable outbox replay. saveMessageOnce prevents duplicates after crashes or concurrent tabs. */
export async function reconcileCommerce(now=Date.now()){
 if(scanning)return;scanning=true;
 try{const {orders}=await readCommerce();let changed=false;for(const order of orders){if(!order.createdNotified){await publishOrderCard(order,false);await markNotified(order.id,false);changed=true;}if(now>=order.eta&&!order.deliveredNotified){await publishOrderCard(order,true);await markNotified(order.id,true);changed=true;}}if(changed)notify();}finally{scanning=false;}
}
export function orderText(o:CommerceOrder,delivered=false){const who=(v:'user'|'char')=>v==='char'?o.charName:o.userName;return `[模拟${o.product.kind==='meituan'?'外卖':'购物'}订单] ${who(o.buyer)}给${who(o.recipient)}买了${o.product.title}，¥${o.product.price.toFixed(2)}。${delivered?`${who(o.recipient)}已收到（按预计时间模拟送达）`:`状态：${orderStatus(o)}；预计送达：${new Date(o.eta).toLocaleString()}`}。这是模拟订单，不是真实支付或平台物流。`;}
export async function commerceContext(charId:string){const {orders,products}=await readCommerce();const pending=orders.filter(o=>o.charId===charId&&o.eta>Date.now());const blocked=purchaseBlock(orders,charId,Date.now());return {
 pending:pending.length?`\n【生活背景·待收货，仅知晓即可】\n${pending.map(o=>orderText(o)).join('\n')}\n无需每轮提及、查询或关心，只有话题相关或到达时自然回应。\n`:'',
 guide:products.length&&!blocked?`\n【偶尔的模拟购买权限】可以为用户买东西，但不是关心的固定动作；没有具体契机就不要购买。不能捏造已下单。需要时输出 <购物>{"productId":"有效商品ID","recipient":"user"}</购物>，一轮最多一单；本地实际创建订单才算成功。可选商品：${products.slice(0,24).map(p=>`${p.id}:${p.title} ¥${p.price}`).join('；')}。\n`:'',
 };}
export async function consumeCommerceAction(charId:string,charName:string,userName:string,text:string,requestId?:string){const actions=[...text.matchAll(/<购物>\s*([\s\S]*?)\s*<\/购物>/g)];const cleaned=text.replace(/<购物>[\s\S]*?<\/购物>/g,'');if(actions.length){const data=JSON.parse(actions[0][1]);if(data.recipient!=='user'||typeof data.productId!=='string')throw new Error('购买参数不正确');await createCommerceOrder({charId,charName,userName,productId:data.productId,buyer:'char',recipient:'user',requestId});}return cleaned;}
