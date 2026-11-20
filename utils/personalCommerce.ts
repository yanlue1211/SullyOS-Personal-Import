import { DB, openDB } from './db';
export type CommerceKind = 'taobao' | 'meituan';
export interface CommerceProduct { id: string; kind: CommerceKind; title: string; shop: string; detail: string; price: number; deliveryMinutes?: number; shopId?: string; category?: string; }
export interface CommerceOrder { id: string; charId: string; charName: string; userName: string; product: CommerceProduct; buyer: 'user'|'char'; recipient: 'user'|'char'; createdAt: number; eta: number; autonomous: boolean; quantity?: number; deliveryAddress?: TaobaoAddress; requestId?: string; createdNotified?: boolean; deliveredNotified?: boolean; }
export interface CommerceShop { id:string; kind:CommerceKind; name:string; category:string; description:string; }
export interface TaobaoCartLine { productId:string; quantity:number; }
export interface TaobaoAddress { id:string; label:string; recipientName:string; phone:string; detail:string; }
export interface TaobaoProfile { addresses:TaobaoAddress[]; defaultAddressId?:string; }
export interface TaobaoCatalog { shops:CommerceShop[]; products:CommerceProduct[]; }
interface State { products: CommerceProduct[]; orders: CommerceOrder[]; shops:CommerceShop[]; members:Record<CommerceKind,string[]>; preferences:Record<CommerceKind,string>; cart:TaobaoCartLine[]; taobaoProfiles:Record<string,TaobaoProfile>; }
const KEY = 'personal_commerce_v1';
const empty = (): State => ({products: [], orders: [], shops:[], members:{taobao:[],meituan:[]},preferences:{taobao:'',meituan:''},cart:[],taobaoProfiles:{}});
function decode(raw: unknown): State { if (!raw) return empty(); const s = typeof raw === 'string' ? JSON.parse(raw) : raw; if (!Array.isArray(s.products)||!Array.isArray(s.orders)) throw new Error('订单数据无法读取，请保留备份'); s.members={taobao:Array.isArray(s.members?.taobao)?s.members.taobao:[],meituan:Array.isArray(s.members?.meituan)?s.members.meituan:[]};
 s.preferences={taobao:typeof s.preferences?.taobao==='string'?s.preferences.taobao:'',meituan:typeof s.preferences?.meituan==='string'?s.preferences.meituan:''};
  s.cart=Array.isArray(s.cart)?s.cart.filter((v:any)=>v&&typeof v.productId==='string'&&Number.isInteger(v.quantity)&&v.quantity>0&&v.quantity<=99).slice(0,150):[];
 const rawProfiles=s.taobaoProfiles&&typeof s.taobaoProfiles==='object'&&!Array.isArray(s.taobaoProfiles)?s.taobaoProfiles:{};
 s.taobaoProfiles={};
 for(const [id,p] of Object.entries(rawProfiles)){
  const profile=p as TaobaoProfile;
  if(!id||!profile||!Array.isArray(profile.addresses))continue;
  const addresses=profile.addresses.filter(a=>a&&typeof a.id==='string'&&typeof a.detail==='string'&&typeof a.recipientName==='string'&&typeof a.phone==='string'&&typeof a.label==='string').slice(0,40);
  s.taobaoProfiles[id]={addresses,defaultAddressId:addresses.some(a=>a.id===profile.defaultAddressId)?profile.defaultAddressId:addresses[0]?.id};
 }
 if(!Array.isArray(s.shops)){const byName=new Map<string,CommerceShop>();for(const product of s.products){const key=`${product.kind}:${product.shop}`;if(!byName.has(key))byName.set(key,{id:`legacy:${product.kind}:${product.shop}`,kind:product.kind,name:product.shop,category:product.category||'精选店铺',description:''});product.shopId=byName.get(key)!.id;}s.shops=[...byName.values()];}
 return s; }
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
export async function saveCommercePreferences(kind:CommerceKind,value:string){await mutate(s=>{s.preferences[kind]=value.trim().slice(0,2000);});}
export async function saveCommerceMembers(kind:CommerceKind,ids:string[]){await mutate(s=>{s.members[kind]=[...new Set(ids.filter(id=>typeof id==='string'&&id))];});notify();}
export function normalizeShops(raw:unknown,kind:CommerceKind):CommerceShop[]{
 if(!Array.isArray(raw))throw new Error('店铺数据格式不正确');
 const shops=raw.slice(0,12).flatMap((v:any)=>typeof v?.name==='string'&&v.name.trim()?[{id:crypto.randomUUID(),kind,name:v.name.trim().slice(0,60),category:String(v.category||'精选店铺').slice(0,30),description:String(v.description||'').slice(0,180)}]:[]);
 if(!shops.length)throw new Error('没有生成有效店铺');return shops;
}
export async function saveShops(shops:CommerceShop[],kind:CommerceKind){await mutate(s=>{s.shops=[...s.shops.filter(p=>p.kind!==kind),...shops];s.products=s.products.filter(p=>p.kind!==kind);});notify();}
/** Require a complete batch before starting any storage writes, including nested products. */
export function normalizeTaobaoCatalog(raw:unknown):TaobaoCatalog{
 if(!Array.isArray(raw)||raw.length!==8)throw new Error('店铺数据不完整，需要8家店铺；原店铺已保留');
 const shops:CommerceShop[]=[],products:CommerceProduct[]=[];
 for(const entry of raw){
  if(!entry||typeof entry.name!=='string'||!entry.name.trim()||!Array.isArray(entry.products)||entry.products.length!==8)throw new Error('店铺商品不完整，需要每店8件；原店铺已保留');
  const shop=normalizeShops([entry],'taobao')[0];
  const generated=normalizeProducts(entry.products,'taobao');
  if(generated.length!==8)throw new Error('商品数据不完整，原店铺已保留');
  shops.push(shop);
  products.push(...generated.map(p=>({...p,shop:shop.name,shopId:shop.id,category:shop.category})));
 }
 return {shops,products};
}
export async function saveTaobaoCatalog(catalog:TaobaoCatalog){
 if(catalog.shops.length!==8||catalog.products.length!==64)throw new Error('商城数据不完整，没有覆盖旧商品');
 const ids=new Set(catalog.shops.map(s=>s.id));
 if(ids.size!==8||catalog.shops.some(s=>s.kind!=='taobao')||catalog.products.some(p=>p.kind!=='taobao'||!p.shopId||!ids.has(p.shopId)))throw new Error('商城数据校验失败，旧商品未修改');
 if(catalog.shops.some(s=>catalog.products.filter(p=>p.shopId===s.id).length!==8))throw new Error('店铺商品数量不正确');
 await mutate(s=>{
  s.shops=[...s.shops.filter(p=>p.kind!=='taobao'),...catalog.shops];
  s.products=[...s.products.filter(p=>p.kind!=='taobao'),...catalog.products];
 });notify();
}
/** Add products to one existing shop; never discard its old items or pending cart lines. */
export async function appendTaobaoProducts(shop:CommerceShop, products:CommerceProduct[]){
 if(!products.length||products.length>12||products.some(p=>p.kind!=='taobao'))throw new Error('新增商品数据不正确');
 const normalized=products.map(p=>({...p,kind:'taobao' as const,shop:shop.name,shopId:shop.id,category:shop.category}));
 await mutate(s=>{
  if(!s.shops.some(v=>v.id===shop.id&&v.kind==='taobao'))throw new Error('店铺已更新，请重新进入');
  const existing=new Set(s.products.filter(v=>v.shopId===shop.id).map(v=>v.title.trim().toLowerCase()));
  const next=normalized.filter(v=>{const key=v.title.trim().toLowerCase();if(existing.has(key))return false;existing.add(key);return true;});
  if(!next.length)throw new Error('生成的商品与店里已有商品重复，请换个关键词');
  s.products.push(...next);
 });notify();
}
/** Existing transaction asset: profiles remain independent per character and optional for old backups. */
export async function saveTaobaoAddress(ownerId:string,input:Omit<TaobaoAddress,'id'>,id?:string){
 if(!ownerId)throw new Error('请选择收货人');
 const label=input.label.trim().slice(0,24),recipientName=input.recipientName.trim().slice(0,60),phone=input.phone.trim().slice(0,40),detail=input.detail.trim().slice(0,320);
 if(!recipientName||!detail)throw new Error('请填写收件人和详细地址');
 const result=await mutate(s=>{
  const profile=s.taobaoProfiles[ownerId]||(s.taobaoProfiles[ownerId]={addresses:[]});
  const existing=id?profile.addresses.find(a=>a.id===id):undefined;
  if(id&&!existing)throw new Error('地址已变更，请重新打开');
  if(!existing&&profile.addresses.length>=40)throw new Error('地址数量已达上限');
  const address={id:existing?.id||crypto.randomUUID(),label,recipientName,phone,detail};
  if(existing)Object.assign(existing,address);
  else profile.addresses.push(address);
  if(!profile.defaultAddressId)profile.defaultAddressId=address.id;
  return address;
 });notify();return result;
}
export async function deleteTaobaoAddress(ownerId:string,id:string){
 await mutate(s=>{
  const profile=s.taobaoProfiles[ownerId];if(!profile)return;
  profile.addresses=profile.addresses.filter(a=>a.id!==id);
  if(profile.defaultAddressId===id)profile.defaultAddressId=profile.addresses[0]?.id;
 });notify();
}
export async function setDefaultTaobaoAddress(ownerId:string,id:string){
 await mutate(s=>{
  const profile=s.taobaoProfiles[ownerId];
  if(!profile?.addresses.some(a=>a.id===id))throw new Error('地址不存在');
  profile.defaultAddressId=id;
 });notify();
}

export async function saveShopProducts(products:CommerceProduct[],shop:CommerceShop){await mutate(s=>{
 if(!s.shops.some(p=>p.id===shop.id&&p.kind===shop.kind))throw new Error('店铺已刷新，请重新进入');
 s.products=[...s.products.filter(p=>p.shopId!==shop.id),...products.map(p=>({...p,shop:shop.name,shopId:shop.id,category:shop.category,kind:shop.kind}))];
 });notify();}
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
  if(!s.members[product.kind].includes(input.charId))throw new Error('该角色尚未接入此 App');
  const autonomous=input.buyer==='char'&&!input.explicitRequest;
  if(autonomous&&input.recipient==='user'){const reason=purchaseBlock(s.orders,input.charId,now);if(reason)throw new Error(reason);}
  const eta=now+(product.deliveryMinutes??(product.kind==='meituan'?35:4320))*60000;
  const order:CommerceOrder={id:crypto.randomUUID(),charId:input.charId,charName:input.charName,userName:input.userName,product,buyer:input.buyer,recipient:input.recipient,createdAt:now,eta,autonomous,requestId:input.requestId};
  if(product.kind==='taobao'){
   const owner=input.recipient==='char'?input.charId:'__user__';
   const profile=s.taobaoProfiles[owner];
   const address=profile?.addresses.find(a=>a.id===profile.defaultAddressId);
   if(address)order.deliveryAddress={...address};
  }
  s.orders.push(order);return order;
 });
 try { await publishOrderCard(order,false); await markNotified(order.id, false); notify(); } catch { /* Persisted outbox is retried by reconcileCommerce. */ }
 return order;
}
/** Cart lines live in the existing commerce asset, so old backups/shops/orders remain intact. */
export async function addTaobaoCartItem(productId:string,quantity=1){
 if(!Number.isInteger(quantity)||quantity<1||quantity>99)throw new Error('购物数量需要在1到99之间');
 await mutate(s=>{
  if(!s.products.some(p=>p.kind==='taobao'&&p.id===productId))throw new Error('商品已下架，请刷新店铺');
  const line=s.cart.find(v=>v.productId===productId);
  if(line)line.quantity=Math.min(99,line.quantity+quantity);
  else s.cart.push({productId,quantity});
 });notify();
}
export async function setTaobaoCartQuantity(productId:string,quantity:number){
 if(!Number.isInteger(quantity)||quantity<0||quantity>99)throw new Error('商品数量无效');
 await mutate(s=>{
  const idx=s.cart.findIndex(v=>v.productId===productId);
  if(idx<0)return;
  if(quantity===0)s.cart.splice(idx,1);
  else s.cart[idx].quantity=quantity;
 });notify();
}
/** A selected cart checkout is one atomic asset transaction; outbox retries failed cards. */
export async function checkoutTaobaoProducts(input:{
 charId:string;charName:string;userName:string;buyer:'user'|'char';recipient:'user'|'char';
 lines:TaobaoCartLine[];removeFromCart:boolean;addressId?:string;
},now=Date.now()):Promise<CommerceOrder[]>{
 if(!input.lines.length||input.lines.length>40)throw new Error('请选择要结算的商品');
 const ids=new Set<string>();
 const orders=await mutate(s=>{
  if(!s.members.taobao.includes(input.charId))throw new Error('该角色尚未接入淘宝');
  const created:CommerceOrder[]=[];
  for(const line of input.lines){
   if(!line||typeof line.productId!=='string'||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>99||ids.has(line.productId))
    throw new Error('购物车商品或数量不正确');
   ids.add(line.productId);
   const product=s.products.find(p=>p.id===line.productId&&p.kind==='taobao');
   if(!product)throw new Error('商品已下架，请先从购物车移除失效商品');
   if(input.removeFromCart){
    const saved=s.cart.find(v=>v.productId===line.productId);
    if(!saved||saved.quantity<line.quantity)throw new Error('购物车数量已变化，请重新结算');
   }
   created.push({
    id:crypto.randomUUID(),charId:input.charId,charName:input.charName,userName:input.userName,
    product:{...product},buyer:input.buyer,recipient:input.recipient,quantity:line.quantity,
    createdAt:now,eta:now+(product.deliveryMinutes??4320)*60000,autonomous:false,
   });
  }
  if(input.addressId){
   const owner=input.recipient==='char'?input.charId:'__user__';
   const address=s.taobaoProfiles[owner]?.addresses.find(a=>a.id===input.addressId);
   if(!address)throw new Error('所选收货地址不存在，请重新选择');
   for(const order of created)order.deliveryAddress={...address};
  }
  s.orders.push(...created);
  if(input.removeFromCart){
   for(const line of input.lines){
    const saved=s.cart.find(v=>v.productId===line.productId)!;
    saved.quantity-=line.quantity;
   }
   s.cart=s.cart.filter(v=>v.quantity>0);
  }
  return created;
 });
 for(const order of orders){
  try{await publishOrderCard(order,false);await markNotified(order.id,false);}
  catch{/* Keep the new order in durable outbox for reconcileCommerce. */}
 }
 notify();
 return orders;
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
export function orderText(o:CommerceOrder,delivered=false){const who=(v:'user'|'char')=>v==='char'?o.charName:o.userName;const quantity=o.quantity||1;return `[${o.product.kind==='meituan'?'外卖':'购物'}订单] ${who(o.buyer)}给${who(o.recipient)}买了${o.product.title}${quantity>1?` ×${quantity}`:''}，¥${(o.product.price*quantity).toFixed(2)}。${delivered?`${who(o.recipient)}已收到`:`状态：${orderStatus(o)}；预计送达：${new Date(o.eta).toLocaleString()}`}。`;}
export async function commerceContext(charId:string){const {orders,products,members}=await readCommerce();const pending=orders.filter(o=>o.charId===charId&&o.eta>Date.now());const blocked=purchaseBlock(orders,charId,Date.now());const available=products.filter(p=>members[p.kind].includes(charId));return {
 pending:pending.length?`\n【生活背景·待收货，仅知晓即可】\n${pending.map(o=>orderText(o)).join('\n')}\n无需每轮提及、查询或关心，只有话题相关或到达时自然回应。\n`:'',
 guide:available.length?`\n【生活购物权限】你可在${[...new Set(available.map(p=>p.kind==='meituan'?'美团':'淘宝'))].join('、')}给用户或自己买东西。没有具体契机不必买，也不能捏造已下单。${blocked?`给用户的主动礼物暂停：${blocked}；给自己买不受此限制。`:''}决定逛商城时先单独一行输出 <逛商城>{"query":"想找的商品关键词","kind":"taobao"}</逛商城>（kind 可为 taobao 或 meituan，也可省略；可附 shopId、offset 翻页）。先不附购物正文或心声。系统随后提供相关商品，再用 <购物>{"productId":"查询到的有效ID","recipient":"user"}</购物> 下单；recipient 可为 user 或 char。一轮最多一单，系统创建成功才算购买。\n`:'',
 };}
export async function consumeCommerceAction(charId:string,charName:string,userName:string,text:string,requestId?:string){const actions=[...text.matchAll(/<购物>\s*([\s\S]*?)\s*<\/购物>/g)];const cleaned=text.replace(/<购物>[\s\S]*?<\/购物>/g,'');if(actions.length){const data=JSON.parse(actions[0][1]);if(!['user','char'].includes(data.recipient)||typeof data.productId!=='string')throw new Error('购买参数不正确');await createCommerceOrder({charId,charName,userName,productId:data.productId,buyer:'char',recipient:data.recipient,requestId});}return cleaned;}
