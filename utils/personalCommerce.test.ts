// @vitest-environment jsdom
import {beforeEach,it,expect} from 'vitest';
import {DB} from './db';
import {normalizeProducts,saveProducts,createCommerceOrder,readCommerce,reconcileCommerce,orderStatus,commerceContext,consumeCommerceAction} from './personalCommerce';
let productId:string;
beforeEach(async()=>{await DB.deleteDB();const p=normalizeProducts([{title:'热汤面',shop:'小面馆',price:22,detail:'清汤'}],'meituan');await saveProducts(p,'meituan');productId=p[0].id;});
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
