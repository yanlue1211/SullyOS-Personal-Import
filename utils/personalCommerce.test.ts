// @vitest-environment jsdom
import {beforeEach,it,expect} from 'vitest';
import {DB} from './db';
import {normalizeProducts,saveProducts,createCommerceOrder,readCommerce,reconcileCommerce,orderStatus,commerceContext,consumeCommerceAction,saveCommerceMembers,saveCommercePreferences,commerceContext as getContext,orderText,normalizeShops,saveShops,saveShopProducts} from './personalCommerce';
let productId:string;
beforeEach(async()=>{await DB.deleteDB();const p=normalizeProducts([{title:'热汤面',shop:'小面馆',price:22,detail:'清汤'}],'meituan');await saveProducts(p,'meituan');productId=p[0].id;await saveCommerceMembers('meituan',['a','b']);});
const input=()=>({charId:'a',charName:'甲',userName:'我',productId,buyer:'char' as const,recipient:'user' as const});
it('serializes concurrent autonomous gifts across characters and replays each delivery once',async()=>{
 const now=Date.now();const r=await Promise.allSettled([createCommerceOrder({...input(),requestId:'one'},now),createCommerceOrder({...input(),charId:'b',requestId:'two'},now)]);
 expect(r.filter(v=>v.status==='fulfilled')).toHaveLength(1);const {orders}=await readCommerce();expect(orders).toHaveLength(1);expect(orders[0].eta-now).toBe(35*60000);
 await reconcileCommerce(now+36*60000);await reconcileCommerce(now+36*60000);const msgs=await DB.getMessagesByCharId(orders[0].charId);expect(msgs.filter(m=>(m.metadata as any)?.scoreCard?.type==='commerce_order')).toHaveLength(2);
});
it('keeps repeated reply execution idempotent and explicit user requests available during cooldown',async()=>{
 const a=await createCommerceOrder({...input(),requestId:'same'});const b=await createCommerceOrder({...input(),requestId:'same'});expect(a.id).toBe(b.id);
 await expect(createCommerceOrder({...input(),explicitRequest:true})).resolves.toBeDefined();expect((await readCommerce()).orders).toHaveLength(2);
});
it('keeps pending context brief and removes it after arrival without deleting the order',async()=>{
 const o=await createCommerceOrder({...input(),explicitRequest:true},Date.now()-36*60000);expect(orderStatus(o)).toBe('已送达');expect((await commerceContext('a')).pending).toBe('');expect((await readCommerce()).orders).toHaveLength(1);
});
it('rejects invented product IDs and malformed action data without saving an order',async()=>{
 await expect(consumeCommerceAction('a','甲','我','<购物>{"productId":"fake","recipient":"user"}</购物>')).rejects.toThrow('商品');expect((await readCommerce()).orders).toHaveLength(0);
});
it('normalizes prices and rejects unusable catalogs',()=>{
 expect(()=>normalizeProducts([{title:'坏价格',price:-1}],'taobao')).toThrow();expect(normalizeProducts([{title:'杯子',price:19.999}],'taobao')[0].price).toBe(20);
});

it('enforces per-app membership in context and order execution, including explicit requests',async()=>{
 await saveCommerceMembers('meituan',[]);
 expect((await commerceContext('a')).guide).toBe('');
 await expect(createCommerceOrder({...input(),explicitRequest:true})).rejects.toThrow('尚未接入');
 await saveCommerceMembers('taobao',['a']);
 await expect(createCommerceOrder({...input(),explicitRequest:true})).rejects.toThrow('尚未接入');
 await saveCommerceMembers('meituan',['a']);
 expect((await commerceContext('a')).guide).toContain(productId);
 const order=await createCommerceOrder({...input(),explicitRequest:true});
 expect(orderText(order)).not.toMatch(/模拟|真实支付|平台物流/);
 expect(orderText(order,true)).not.toContain('模拟');
 await saveCommerceMembers('meituan',[]);
 expect((await commerceContext('a')).pending).toContain('热汤面');
 await expect(createCommerceOrder({...input(),explicitRequest:true})).rejects.toThrow('尚未接入');
});
it('saves categorized shops and menus independently without changing historical orders',async()=>{
 const order=await createCommerceOrder({...input(),explicitRequest:true});
 const shops=normalizeShops([{name:'面馆',category:'面食',description:'汤面'}],'meituan');
 await saveShops(shops,'meituan');
 await saveShopProducts(normalizeProducts([{title:'牛肉面',price:28}],'meituan'),shops[0]);
 const state=await readCommerce();expect(state.shops[0].category).toBe('面食');
 expect(state.products[0].shopId).toBe(shops[0].id);expect(state.products[0].shop).toBe('面馆');
 expect(state.orders[0].product.title).toBe(order.product.title);
});
it('migrates the old flat catalog into stable stores without enrolling every character',async()=>{
 await DB.saveAsset('personal_commerce_v1',JSON.stringify({products:[{id:'legacy-product',kind:'taobao',title:'杯子',shop:'杯子铺',price:20,detail:''}],orders:[]}));
 const first=await readCommerce(),second=await readCommerce();
 expect(first.members).toEqual({taobao:[],meituan:[]});
 expect(first.shops[0].id).toBe(second.shops[0].id);expect(first.products[0].shopId).toBe(first.shops[0].id);
 expect((await commerceContext('a')).guide).toBe('');
});

it('saves generation preferences separately for the two apps without injecting them into role shopping rules',async()=>{
 await saveCommercePreferences('taobao','复古书店');await saveCommercePreferences('meituan','夜宵热汤');
 const s=await readCommerce();expect(s.preferences).toEqual({taobao:'复古书店',meituan:'夜宵热汤'});
 expect((await commerceContext('a')).guide).not.toContain('夜宵热汤');
});
