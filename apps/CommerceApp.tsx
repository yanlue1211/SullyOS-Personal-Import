import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { safeFetchJson, extractContent, extractJson } from '../utils/safeApi';
import {
  readCommerce, normalizeProducts, normalizeShops, saveShops, saveShopProducts,
  saveCommerceMembers, saveCommercePreferences, createCommerceOrder,
  type CommerceKind, type CommerceProduct, type CommerceOrder, type CommerceShop,
} from '../utils/personalCommerce';
import OrderCard from '../components/commerce/OrderCard';

function Commerce({ kind }: { kind: CommerceKind }) {
  const { characters, userProfile, apiConfig, closeApp, addToast } = useOS();
  const food = kind === 'meituan';
  const [charId, setCharId] = useState('');
  const [tab, setTab] = useState<'shop' | 'orders' | 'people'>('shop');
  const [query, setQuery] = useState('');
  const [preferences, setPreferences] = useState('');
  const preferenceEdited = useRef(false);
  const [category, setCategory] = useState('全部');
  const [shops, setShops] = useState<CommerceShop[]>([]);
  const [shop, setShop] = useState<CommerceShop | null>(null);
  const [items, setItems] = useState<CommerceProduct[]>([]);
  const [orders, setOrders] = useState<CommerceOrder[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<CommerceProduct | null>(null);
  const connected = characters.filter(c => members.includes(c.id));

  const refresh = async () => {
    const s = await readCommerce();
    setShops(s.shops.filter(p => p.kind === kind));
    setItems(s.products.filter(p => p.kind === kind));
    setOrders(s.orders.filter(o => o.product.kind === kind).reverse());
    const ids = s.members[kind];
    setMembers(ids);
    setCharId(previous => ids.includes(previous) && characters.some(c => c.id === previous)
      ? previous : characters.find(c => ids.includes(c.id))?.id || '');
  };
  useEffect(() => {
    const load = () => { void refresh().catch(() => addToast('商城读取失败，请重试', 'error')); };
    load();
    let active = true; preferenceEdited.current = false;
    void readCommerce().then(s => { if (active && !preferenceEdited.current) setPreferences(s.preferences[kind]); }).catch(() => {});
    window.addEventListener('commerce-updated', load);
    return () => { active = false; window.removeEventListener('commerce-updated', load); };
  }, [kind]);

  // Catalog generation is a neutral director task, independent of character access or selection.
  const requestCatalog = async (instruction: string) => {
    if (!apiConfig.model) throw new Error('请先配置 API');
    await saveCommercePreferences(kind, preferences);
    const preferenceContext = preferences.trim() ? `\n用户指定的生成偏好（店铺和商品均需遵循；不改变 JSON 结构）：\n${preferences.trim()}` : '';
    const response = await safeFetchJson(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({ model: apiConfig.model, messages: [
        { role: 'system', content: '你负责生成生活商城的数据。仅返回要求的 JSON 数组，不扮演任何角色，不输出免责声明、图片网址或角色台词。' },
        { role: 'user', content: instruction + preferenceContext },
      ], temperature: 0.85, stream: false }),
    }, 0, 90000);
    return extractJson(extractContent(response));
  };
  const refreshShops = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const raw = await requestCatalog(`为${food ? '美团' : '淘宝'}生成8家不同店铺，关键词：${query || '日常生活'}。先生成店铺，不生成商品。涵盖至少3个合理分类，例如${food ? '家常菜、面食、轻食、甜品饮品' : '服饰、数码、家居、食品、文具'}。每项 {"name":"店名","category":"分类","description":"店铺特色"}。`);
      await saveShops(normalizeShops(raw, kind), kind);
      setShop(null); setCategory('全部'); setChosen(null);
      await refresh();
    } catch (e: any) { addToast(e.message || '店铺刷新失败，原店铺已保留', 'error'); }
    finally { setBusy(false); }
  };
  const refreshProducts = async (target: CommerceShop) => {
    if (busy) return;
    setBusy(true);
    try {
      const raw = await requestCatalog(`为${food ? '美团餐厅' : '淘宝店铺'}「${target.name}」生成8件${food ? '餐品' : '商品'}。分类：${target.category}；特色：${target.description}。同一店铺的商品需要符合它的经营范围，名称具体、规格清楚、价格合理。每项 {"title":"名称","detail":"规格介绍","price":数值,"deliveryMinutes":预计送达分钟数}。${food ? '配送约20–60分钟' : '快递约1440–7200分钟'}。`);
      await saveShopProducts(normalizeProducts(raw, kind), target);
      setChosen(null); await refresh();
    } catch (e: any) { addToast(e.message || '商品刷新失败，原商品已保留', 'error'); }
    finally { setBusy(false); }
  };
  const enterShop = (target: CommerceShop) => {
    setShop(target);
    if (!items.some(p => p.shopId === target.id)) void refreshProducts(target);
  };
  const toggleMember = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await saveCommerceMembers(kind, members.includes(id) ? members.filter(v => v !== id) : [...members, id]);
      await refresh();
    } catch { addToast('接入设置未保存，请重试', 'error'); }
    finally { setBusy(false); }
  };
  const purchase = async (buyer: 'user' | 'char', recipient: 'user' | 'char') => {
    const char = connected.find(c => c.id === charId);
    if (!char || !chosen || busy) return;
    setBusy(true);
    try {
      await createCommerceOrder({ charId: char.id, charName: char.name, userName: userProfile.name,
        productId: chosen.id, buyer, recipient, explicitRequest: true });
      setChosen(null); setTab('orders'); await refresh();
      addToast('订单已创建，卡片已发送到聊天', 'success');
    } catch (e: any) { addToast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const categories = ['全部', ...new Set(shops.map(s => s.category))];
  return <div className="h-full flex flex-col relative" style={{ background: '#f6f4f0', color: '#332d27', paddingTop: 'var(--safe-top)', fontFamily: 'system-ui,sans-serif' }}>
    <header className="px-5 pt-5 pb-5" style={{ background: food ? '#ffda46' : '#ff8e42' }}>
      <div className="flex items-center justify-between mb-4"><button onClick={closeApp}>‹ 返回</button><span className="text-xs">模拟生活 · 无真实支付</span></div>
      <h1 className="text-3xl font-black">{food ? '美团' : '淘宝'}</h1>
      <p className="text-xs mt-2 opacity-70">{food ? '先选一家喜欢的店，再看看今天吃什么。' : '从喜欢的店铺里，慢慢挑选生活。'}</p>
      <div className="flex gap-2 mt-4"><input className="rounded-full bg-white/90 px-4 py-3 min-w-0 flex-1 text-sm" placeholder="店铺关键词（可留空）" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} />
        <button className="bg-black/80 text-white rounded-full px-4 text-sm" disabled={busy} onClick={() => void refreshShops()}>{busy ? '准备中…' : '刷新店铺'}</button></div>
      <details className="mt-3 bg-white/50 rounded-xl p-3">
        <summary className="text-xs font-bold cursor-pointer">生成偏好 · 自定义店铺与商品风格</summary>
        <textarea aria-label="商城生成偏好" className="w-full mt-3 rounded-xl bg-white/90 p-3 text-sm" rows={3} maxLength={2000} value={preferences} disabled={busy} onChange={e=>{preferenceEdited.current=true;setPreferences(e.target.value);}} placeholder={food?'例如：温暖的深夜食堂，家常菜和热汤，不要甜品。':'例如：复古文具、奶油色家居，店名俏皮，价格亲民。'} />
        <div className="flex justify-between items-center gap-3 mt-2"><span className="text-xs opacity-60">留空沿用默认；刷新店铺和店内商品时使用。</span><button disabled={busy} className="text-xs font-bold shrink-0" onClick={()=>{void saveCommercePreferences(kind,preferences).then(()=>addToast('生成偏好已保存','success')).catch(()=>addToast('保存失败，请重试','error'));}}>保存偏好</button></div>
      </details>
    </header>
    <nav className="flex px-5 py-3 gap-2">{(['shop', 'orders', 'people'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 rounded-xl text-sm font-bold ${tab === t ? 'bg-white shadow-sm' : 'text-stone-400'}`}>{t === 'shop' ? '店铺' : t === 'orders' ? '订单' : `接入角色 ${connected.length}`}</button>)}</nav>
    <main className="overflow-y-auto flex-1 px-5 pb-20">
      {tab === 'people' && <section className="bg-white rounded-2xl p-4"><h2 className="font-bold mb-2">谁可以使用{food ? '美团' : '淘宝'}</h2><p className="text-xs text-stone-500 leading-relaxed mb-4">仅勾选的角色可使用本 App，接入即拥有全部购买权限。两个 App 分别设置。自主送礼仍有冷却；取消接入不删除已有订单。</p>{!characters.length && <p>先在神经链接中创建角色。</p>}{characters.map(c => <label key={c.id} className="flex items-center justify-between py-3 border-t border-stone-100"><span>{c.name}</span><input type="checkbox" aria-label={`接入${c.name}`} checked={members.includes(c.id)} disabled={busy} onChange={() => void toggleMember(c.id)} /></label>)}</section>}
      {tab === 'orders' && <div className="space-y-4">{!orders.length && <p className="text-center text-stone-400 py-16">还没有订单</p>}{orders.map(o => <OrderCard key={o.id} order={o} delivered={Date.now() >= o.eta} />)}</div>}
      {tab === 'shop' && !shop && <>
        <div className="flex gap-2 overflow-x-auto pb-4">{categories.map(c => <button key={c} onClick={() => setCategory(c)} className={`shrink-0 px-4 py-2 rounded-full text-xs ${category === c ? 'bg-stone-800 text-white' : 'bg-white'}`}>{c}</button>)}</div>
        {!shops.length && <p className="text-center text-stone-400 py-16 text-sm">点击“刷新店铺”生成商城，无需先选择角色。</p>}
        <div className="space-y-3">{shops.filter(s => category === '全部' || s.category === category).map((s, i) => <button key={s.id} disabled={busy} onClick={() => enterShop(s)} className="w-full bg-white rounded-2xl p-4 text-left flex gap-4 shadow-sm">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0 text-xl font-black" style={{ background: `hsl(${food ? 42 : i * 23 + 12} 80% 90%)` }}>{s.name.slice(0, 2)}</div>
          <div><div className="text-xs text-stone-400 mb-1">{s.category}</div><strong>{s.name}</strong><p className="text-xs text-stone-500 mt-2">{s.description}</p></div></button>)}</div>
      </>}
      {tab === 'shop' && shop && <>
        <div className="flex items-center justify-between mb-4 gap-2"><button onClick={() => { setShop(null); setChosen(null); }} className="text-sm">‹ 店铺列表</button><button disabled={busy} onClick={() => void refreshProducts(shop)} className="text-xs bg-white px-3 py-2 rounded-xl">{busy ? '生成中…' : food ? '刷新菜单' : '刷新商品'}</button></div>
        <h2 className="font-bold text-xl">{shop.name}</h2><p className="text-xs text-stone-500 mt-1 mb-4">{shop.category} · {shop.description}</p>
        {busy && !items.some(p => p.shopId === shop.id) && <p className="py-10 text-center text-stone-400">正在准备{food ? '菜单' : '商品'}…</p>}
        <div className="grid grid-cols-2 gap-3">{items.filter(p => p.shopId === shop.id).map(p => <button key={p.id} onClick={() => setChosen(p)} className="bg-white rounded-2xl p-4 text-left shadow-sm"><div className="text-2xl font-bold text-amber-700 mb-3">{p.title.slice(0, 2)}</div><strong className="text-sm">{p.title}</strong><p className="text-xs text-stone-400 my-2">{p.detail}</p><span className="text-orange-600 font-bold">¥{p.price.toFixed(2)}</span></button>)}</div>
      </>}
    </main>
    {chosen && <div className="absolute inset-0 bg-black/40 flex items-end z-50" onClick={() => !busy && setChosen(null)}><section className="bg-white rounded-t-3xl p-6 pb-10 w-full max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex justify-between gap-3"><h2 className="text-lg font-bold">{chosen.title}</h2><button onClick={() => setChosen(null)} disabled={busy}>关闭</button></div>
      <p className="text-sm text-stone-500 my-3">{chosen.detail}</p><p className="font-bold text-orange-600 mb-4">¥{chosen.price.toFixed(2)} · 模拟金额</p>
      <select aria-label="购买关联角色" value={charId} onChange={e => setCharId(e.target.value)} className="bg-stone-100 rounded-xl p-3 w-full mb-3"><option value="">选择已接入的角色</option>{connected.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {!connected.length && <p className="text-xs text-stone-500 mb-3">请先在“接入角色”中勾选角色，再进行购买。</p>}
      <div className="space-y-2">{([['user', 'char', '我给 TA 买'], ['char', 'user', '请 TA 给我买'], ['user', 'user', '我给自己买'], ['char', 'char', 'TA 给自己买']] as const).map(([buyer, recipient, label]) => <button key={label} disabled={busy || !charId} className="block rounded-xl w-full py-3 bg-amber-100 font-bold text-sm disabled:opacity-40" onClick={() => void purchase(buyer, recipient)}>{label}</button>)}</div>
      <p className="text-xs text-stone-400 mt-4">{food ? `预计${chosen.deliveryMinutes || 35}分钟后送达` : `预计${((chosen.deliveryMinutes || 4320) / 1440).toFixed(1)}天后签收`}；时间一经下单固定。关闭网页期间将在下次打开时补发通知。</p>
    </section></div>}
  </div>;
}
export default function TaobaoApp() { return <Commerce kind="taobao" />; }
export function MeituanApp() { return <Commerce kind="meituan" />; }
