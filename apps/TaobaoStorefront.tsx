import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowClockwise, CaretLeft, CaretRight, Check, MagnifyingGlass, Minus,
  Package, Plus, Receipt, ShoppingCart, SlidersHorizontal, Storefront, Trash, UserCircle, X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { extractContent, extractJson, safeFetchJson } from '../utils/safeApi';
import {
  addTaobaoCartItem, checkoutTaobaoProducts, normalizeProducts, normalizeShops,
  readCommerce, saveCommerceMembers, saveCommercePreferences, saveShopProducts, saveShops,
  setTaobaoCartQuantity, type CommerceOrder, type CommerceProduct, type CommerceShop,
  type TaobaoCartLine, orderStatus,
} from '../utils/personalCommerce';
import './taobao.css';

type Page = 'home' | 'cart' | 'orders' | 'people';
type PurchaseMode = 'user-char' | 'char-user' | 'user-user' | 'char-char';
type CheckoutLine = { productId: string; quantity: number };

const money = (price: number) => price.toFixed(2).replace(/\.00$/, '');
const visuals: { keys: string[]; emoji: string }[] = [
  { keys: ['衣', '衫', '裙', '毛衣', '外套', '裤', 't恤', '服饰'], emoji: '👕' },
  { keys: ['玩偶', '娃娃', '毛绒', '公仔', '盲盒', '手办', '挂件'], emoji: '🧸' },
  { keys: ['耳机', '音响', '手机', '键盘', '鼠标', '数码'], emoji: '🎧' },
  { keys: ['项链', '耳环', '戒指', '饰品', '手链'], emoji: '💍' },
  { keys: ['鞋', '运动', '拖鞋'], emoji: '👟' },
  { keys: ['包', '背包', '提包'], emoji: '👜' },
  { keys: ['口红', '香水', '护肤', '彩妆'], emoji: '💄' },
  { keys: ['笔', '书', '本子', '文具'], emoji: '📚' },
  { keys: ['零食', '饼干', '巧克力', '蛋糕', '食品'], emoji: '🍪' },
  { keys: ['花', '植物', '盆栽', '家居'], emoji: '🪴' },
  { keys: ['杯', '茶具', '陶瓷'], emoji: '☕' },
];
function ProductVisual({ product, large = false }: { product: CommerceProduct; large?: boolean }) {
  const text = (product.title + ' ' + (product.category || '')).toLowerCase();
  const emoji = visuals.find(item => item.keys.some(key => text.includes(key)))?.emoji || '🎁';
  const hue = [...product.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 5;
  return <div className={`tb-product-visual tb-visual-${hue} ${large ? 'tb-product-visual-large' : ''}`} aria-label="商品示意图">
    <span className="tb-visual-glow" aria-hidden="true" /><span className="tb-visual-emoji" aria-hidden="true">{emoji}</span>
    <span className="tb-visual-note">模拟商品示意</span>
  </div>;
}
function EmptyPanel({ icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="tb-empty"><span className="tb-empty-icon">{icon}</span><b>{title}</b><p>{text}</p>{action}</div>;
}

export default function TaobaoStorefront() {
  const { characters, userProfile, apiConfig, closeApp, addToast } = useOS();
  const [page, setPage] = useState<Page>('home');
  const [shops, setShops] = useState<CommerceShop[]>([]);
  const [items, setItems] = useState<CommerceProduct[]>([]);
  const [orders, setOrders] = useState<CommerceOrder[]>([]);
  const [cart, setCart] = useState<TaobaoCartLine[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [charId, setCharId] = useState('');
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState('全部');
  const [shop, setShop] = useState<CommerceShop | null>(null);
  const [detail, setDetail] = useState<CommerceProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [preferences, setPreferences] = useState('');
  const edited = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [checkout, setCheckout] = useState<CheckoutLine[] | null>(null);
  const [fromCart, setFromCart] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>('user-user');

  const connected = characters.filter(c => members.includes(c.id));
  const liveProducts = new Map(items.map(p => [p.id, p]));
  const allCategories = ['全部', ...new Set(shops.map(s => s.category))];
  const matchesSearch = (text: string) => !searchTerm || text.toLowerCase().includes(searchTerm.toLowerCase());
  const visibleShops = shops.filter(s => (category === '全部' || s.category === category)
    && matchesSearch(s.name + s.category + s.description));
  const visibleProducts = items.filter(p => (!shop || p.shopId === shop.id)
    && (category === '全部' || p.category === category || !!shop)
    && matchesSearch(p.title + p.detail + p.shop + (p.category || '')));
  const validCart = cart.filter(line => liveProducts.has(line.productId));
  const allSelected = validCart.length > 0 && validCart.every(line => selected.includes(line.productId));
  const cartUnits = cart.reduce((total, line) => total + line.quantity, 0);
  const selectedLines = validCart.filter(line => selected.includes(line.productId));
  const total = selectedLines.reduce((sum, line) => sum + (liveProducts.get(line.productId)?.price || 0) * line.quantity, 0);

  const load = async () => {
    const s = await readCommerce();
    setShops(s.shops.filter(v => v.kind === 'taobao'));
    setItems(s.products.filter(v => v.kind === 'taobao'));
    setOrders(s.orders.filter(v => v.product.kind === 'taobao').reverse());
    setCart(s.cart);
    setMembers(s.members.taobao);
    setCharId(previous => s.members.taobao.includes(previous) && characters.some(c => c.id === previous)
      ? previous : characters.find(c => s.members.taobao.includes(c.id))?.id || '');
  };
  useEffect(() => {
    let alive = true;
    const sync = () => { void load().catch(() => { if (alive) addToast('淘宝数据读取失败，请重试', 'error'); }); };
    sync();
    void readCommerce().then(s => { if (alive && !edited.current) setPreferences(s.preferences.taobao); }).catch(() => {});
    window.addEventListener('commerce-updated', sync);
    return () => { alive = false; window.removeEventListener('commerce-updated', sync); };
  }, []);

  const requestCatalog = async (instruction: string) => {
    if (!apiConfig.model) throw new Error('请先在设置中配置商城可用的 API');
    await saveCommercePreferences('taobao', preferences);
    const suffix = preferences.trim() ? `\n用户偏好（店铺和商品都要遵循）：\n${preferences.trim()}` : '';
    const response = await safeFetchJson(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({
        model: apiConfig.model, stream: false, temperature: 0.85,
        messages: [
          { role: 'system', content: '生成虚拟淘宝商城目录。只返回符合要求的 JSON 数组，不扮演角色、不写角色台词、不输出图片链接。' },
          { role: 'user', content: instruction + suffix },
        ],
      }),
    }, 0, 90000);
    return extractJson(extractContent(response));
  };
  const regenerateShops = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await requestCatalog(`生成8家有特色、分类不同的淘宝模拟店铺，关键词：${query || '日常好物'}。涵盖服饰、数码、家居、文具、零食、饰品等至少3类，只生成店铺不生成商品。每项 {"name":"店铺名","category":"分类","description":"简短介绍"}。`);
      await saveShops(normalizeShops(data, 'taobao'), 'taobao');
      setShop(null); setCategory('全部'); setSearchTerm(''); setSelected([]);
      await load();
      addToast('新店铺已准备好，选一家进去逛吧', 'success');
    } catch (e: any) { addToast(e.message || '刷新店铺失败，原数据已保留', 'error'); }
    finally { setBusy(false); }
  };
  const regenerateProducts = async (target: CommerceShop) => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await requestCatalog(`为淘宝模拟店铺「${target.name}」生成8件商品。经营分类：${target.category}；特色：${target.description}。名称具体、规格清楚、定价合理，商品不偏离店铺经营范围。每项 {"title":"名称","detail":"规格介绍","price":数值,"deliveryMinutes":预计快递分钟数}。快递约1440到7200分钟。`);
      await saveShopProducts(normalizeProducts(data, 'taobao'), target);
      await load();
      addToast('商品已上新', 'success');
    } catch (e: any) { addToast(e.message || '商品上新失败，原商品已保留', 'error'); }
    finally { setBusy(false); }
  };
  const enterShop = (target: CommerceShop) => {
    setShop(target); setCategory('全部'); setSearchTerm(''); setQuery('');
    if (!items.some(p => p.shopId === target.id)) void regenerateProducts(target);
  };
  const toggleMember = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try { await saveCommerceMembers('taobao', members.includes(id) ? members.filter(x => x !== id) : [...members, id]); await load(); }
    catch { addToast('保存接入角色失败', 'error'); }
    finally { setBusy(false); }
  };
  const addCart = async (product: CommerceProduct) => {
    try { await addTaobaoCartItem(product.id, quantity); await load(); addToast(`已加入购物车 · ${quantity}件`, 'success'); }
    catch (e: any) { addToast(e.message || '购物车保存失败', 'error'); }
  };
  const changeQuantity = async (productId: string, value: number) => {
    try { await setTaobaoCartQuantity(productId, value); await load(); if (value <= 0) setSelected(old => old.filter(id => id !== productId)); }
    catch (e: any) { addToast(e.message || '数量修改失败', 'error'); }
  };
  const startCheckout = (lines: CheckoutLine[], cartCheckout: boolean) => {
    if (!lines.length) { addToast('请先选中想买的商品', 'error'); return; }
    if (!connected.length) { setDetail(null); setPage('people'); addToast('请先接入一位角色，才能创建模拟订单', 'error'); return; }
    setFromCart(cartCheckout); setCheckout(lines); setPurchaseMode('user-user');
  };
  const purchase = async () => {
    if (!checkout || busy) return;
    const char = connected.find(c => c.id === charId);
    if (!char) { addToast('请先选择接入的角色', 'error'); return; }
    const [buyer, recipient] = purchaseMode.split('-') as ['user' | 'char', 'user' | 'char'];
    setBusy(true);
    try {
      const created = await checkoutTaobaoProducts({
        charId: char.id, charName: char.name, userName: userProfile.name, buyer, recipient,
        lines: checkout, removeFromCart: fromCart,
      });
      setCheckout(null); setDetail(null); setSelected([]); setShop(null); setPage('orders');
      await load();
      addToast(`下单成功，已创建${created.length}笔模拟订单`, 'success');
    } catch (e: any) { addToast(e.message || '结算失败，商品和购物车已保留', 'error'); }
    finally { setBusy(false); }
  };
  const navigate = (to: Page) => { setPage(to); setDetail(null); setCheckout(null); setSettingsOpen(false); if (to === 'home') setShop(null); };

  return <div className="tb-root" style={{ paddingTop: 'var(--safe-top)' }}>
    <header className="tb-header">
      <div className="tb-header-top">
        <button type="button" className="tb-back" aria-label="返回糯米机桌面" onClick={closeApp}><CaretLeft size={19} /></button>
        <div className="tb-brand"><span className="tb-brand-badge">淘</span><b>淘宝</b><span className="tb-sim-tag">模拟生活</span></div>
        <div className="tb-header-actions">
          <button type="button" aria-label="生成偏好" title="生成偏好" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={22} /></button>
          <button type="button" className="tb-icon-cart" aria-label="打开购物车" onClick={() => navigate('cart')}><ShoppingCart size={23} />{cartUnits > 0 && <span>{cartUnits > 99 ? '99+' : cartUnits}</span>}</button>
        </div>
      </div>
      <form className="tb-search" onSubmit={e => { e.preventDefault(); setSearchTerm(query.trim()); setPage('home'); setShop(null); }}>
        <MagnifyingGlass size={19} weight="bold" /><input value={query} maxLength={100} onChange={e => setQuery(e.target.value)} placeholder="搜一搜今天想买的好东西" aria-label="搜索店铺和商品" />
        <button type="submit">搜索</button>
      </form>
    </header>

    <main className="tb-main" key={page}>
      {page === 'home' && <>
        {shop ? <>
          <div className="tb-shop-heading">
            <button className="tb-go-back" onClick={() => setShop(null)}><CaretLeft size={18} /> 全部店铺</button>
            <button className="tb-outline-btn" disabled={busy} onClick={() => void regenerateProducts(shop)}><ArrowClockwise size={16} /> {busy ? '上新中…' : '刷新商品'}</button>
          </div>
          <div className="tb-shop-banner"><span className="tb-shop-banner-icon"><Storefront size={25} /></span><div><b>{shop.name}</b><p>{shop.category} · {shop.description}</p></div></div>
          <div className="tb-section-heading"><strong>店内好物</strong><span>{visibleProducts.length} 件商品</span></div>
        </> : <>
          <div className="tb-hero"><div><span className="tb-hero-kicker">GOOD THINGS · EVERY DAY</span><h1>随心逛<span>，</span>慢慢挑</h1><p>把喜欢的东西装进购物车 ♡</p></div><span className="tb-hero-deco" aria-hidden="true">✳</span></div>
          <div className="tb-catalog-actions">
            <span>虚拟商城 · 不产生真实支付</span>
            <button disabled={busy} onClick={() => void regenerateShops()}><ArrowClockwise size={17} />{busy ? '正在准备…' : shops.length ? '换一批店铺' : '生成店铺'}</button>
          </div>
          {searchTerm && <div className="tb-search-summary">“{searchTerm}” 的搜索结果 <button onClick={() => { setSearchTerm(''); setQuery(''); }}>清除</button></div>}
          {shops.length > 0 && <>
            <div className="tb-section-heading"><strong>精选店铺</strong><span>逛逛新发现</span></div>
            <div className="tb-shop-scroll">{visibleShops.map((s, i) => <button key={s.id} className="tb-shop-mini" onClick={() => enterShop(s)}><span className={`tb-shop-avatar tb-avatar-${i % 4}`}><Storefront size={23} /></span><b>{s.name}</b><small>{s.category}</small></button>)}</div>
          </>}
          {shops.length > 0 && <div className="tb-category-strip">{allCategories.map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>}
          {items.length > 0 && <div className="tb-section-heading tb-recommend-title"><strong>猜你喜欢</strong><span>为你挑选的小好物</span></div>}
        </>}
        {visibleProducts.length > 0 ? <div className="tb-product-grid">{visibleProducts.map(p => <button className="tb-product-card" key={p.id} onClick={() => { setDetail(p); setQuantity(1); }}><ProductVisual product={p} /><div className="tb-card-copy"><b>{p.title}</b><p>{p.detail}</p><div className="tb-card-price"><span>¥<strong>{money(p.price)}</strong></span><small>包裹模拟配送</small></div></div></button>)}</div>
          : !busy && (shops.length === 0 ? <EmptyPanel icon="🛍️" title="商场还没开门" text="生成一批店铺，就可以开始逛了。" action={<button className="tb-primary-small" onClick={() => void regenerateShops()}>生成店铺</button>} />
            : shop ? <EmptyPanel icon="🎁" title="店里还没有商品" text="刷新商品，挑选第一件心动好物。" action={<button className="tb-primary-small" onClick={() => void regenerateProducts(shop)}>刷新商品</button>} />
            : items.length === 0 ? <EmptyPanel icon="🏬" title="先去逛一家店吧" text="点开喜欢的店铺，就会准备它的专属商品。" /> : <EmptyPanel icon="🔎" title="没找到相关好物" text="换个关键词或分类再试试。" />)}
        {busy && <div className="tb-working"><ArrowClockwise size={18} /> 正在准备商城内容，请稍候…</div>}
      </>}

      {page === 'cart' && <>
        <div className="tb-page-title"><h2>购物车 <span>({cartUnits})</span></h2><small>喜欢就先放进来</small></div>
        {cart.length ? <div className="tb-cart-list">
          {shops.concat(cart.map(line => liveProducts.get(line.productId)).filter(Boolean).map(p => ({ id: 'legacy-' + p!.shop, name: p!.shop, kind: 'taobao' as const, category: '', description: '' })))
            .filter((s, idx, arr) => arr.findIndex(x => x.name === s.name) === idx)
            .filter(s => cart.some(line => liveProducts.get(line.productId)?.shop === s.name))
            .map(s => <section className="tb-cart-shop" key={s.id}>
              <div className="tb-cart-shop-name"><Storefront size={18} /> <strong>{s.name}</strong><CaretRight size={16} /></div>
              {cart.filter(line => liveProducts.get(line.productId)?.shop === s.name).map(line => {
                const product = liveProducts.get(line.productId)!;
                return <div className="tb-cart-row" key={product.id}>
                  <button className={`tb-check ${selected.includes(product.id) ? 'checked' : ''}`} aria-label={`选择${product.title}`} onClick={() => setSelected(v => v.includes(product.id) ? v.filter(id => id !== product.id) : [...v, product.id])}>{selected.includes(product.id) && <Check size={14} weight="bold" />}</button>
                  <button className="tb-cart-thumb" onClick={() => { setDetail(product); setQuantity(1); }}><ProductVisual product={product} /></button>
                  <div className="tb-cart-info"><b>{product.title}</b><p>{product.detail}</p><span className="tb-cart-price">¥{money(product.price)}</span><div className="tb-cart-row-bottom"><div className="tb-counter"><button aria-label="减少数量" onClick={() => void changeQuantity(product.id, line.quantity - 1)}><Minus size={14} /></button><span>{line.quantity}</span><button aria-label="增加数量" onClick={() => void changeQuantity(product.id, line.quantity + 1)}><Plus size={14} /></button></div><button aria-label="移除商品" className="tb-remove" onClick={() => void changeQuantity(product.id, 0)}><Trash size={18} /></button></div></div>
                </div>;
              })}
            </section>)}
          {cart.filter(line => !liveProducts.has(line.productId)).map(line => <div className="tb-expired" key={line.productId}><span>这件商品已随店铺刷新下架，不能结算</span><button onClick={() => void changeQuantity(line.productId, 0)}>移除</button></div>)}
        </div> : <EmptyPanel icon="🛒" title="购物车还是空空的" text="看到喜欢的商品，就把它先装进来。" action={<button className="tb-primary-small" onClick={() => navigate('home')}>去逛逛</button>} />}
      </>}

      {page === 'orders' && <>
        <div className="tb-page-title"><h2>我的订单</h2><small>每一份快乐都有迹可循</small></div>
        {orders.length ? <div className="tb-order-list">{orders.map(o => <section key={o.id} className="tb-order-card">
          <div className="tb-order-top"><span><Storefront size={17} /> {o.product.shop}</span><b>{orderStatus(o)}</b></div>
          <div className="tb-order-body"><ProductVisual product={o.product} /><div><b>{o.product.title}</b><p>{o.product.detail}</p><span>¥{money(o.product.price)}{(o.quantity || 1) > 1 ? ` × ${o.quantity}` : ''}</span></div></div>
          <div className="tb-order-foot"><span>{o.buyer === 'char' ? o.charName : o.userName} 买给 {o.recipient === 'char' ? o.charName : o.userName}<br />预计 {new Date(o.eta).toLocaleString()} 送达</span><strong>合计 ¥{money(o.product.price * (o.quantity || 1))}</strong></div>
        </section>)}</div> : <EmptyPanel icon="📦" title="还没有模拟订单" text="结算后就可以在这里查看状态。" />}
      </>}

      {page === 'people' && <>
        <div className="tb-page-title"><h2>接入角色</h2><small>选择谁能来淘宝逛街</small></div>
        <div className="tb-people-card"><p>只有勾选的角色可以参与模拟购物。接入后的角色可在聊天中按现有规则自主购买，取消接入不会删除历史订单。</p>{characters.map(c => <label className="tb-person-row" key={c.id}><span className="tb-person-initial">{c.name.slice(0, 1)}</span><b>{c.name}</b><input type="checkbox" checked={members.includes(c.id)} disabled={busy} onChange={() => void toggleMember(c.id)} /></label>)}{!characters.length && <p>请先在神经链接中创建角色。</p>}</div>
      </>}
    </main>

    {page === 'cart' && cart.length > 0 && <div className="tb-cart-checkout"><button className={`tb-check ${allSelected ? 'checked' : ''}`} onClick={() => setSelected(allSelected ? [] : validCart.map(line => line.productId))} aria-label="全选">{allSelected && <Check size={14} weight="bold" />}</button><span>全选</span><div className="tb-cart-total"><small>合计</small><b>¥{money(total)}</b></div><button disabled={!selectedLines.length} onClick={() => startCheckout(selectedLines, true)}>结算 ({selectedLines.length})</button></div>}
    <nav className="tb-bottom-nav" aria-label="淘宝导航">
      {([
        ['home', Storefront, '逛逛'], ['cart', ShoppingCart, '购物车'],
        ['orders', Receipt, '订单'], ['people', UserCircle, '角色'],
      ] as const).map(([name, Icon, title]) => <button className={page === name ? 'active' : ''} key={name} onClick={() => navigate(name)}><span className="tb-nav-icon"><Icon size={24} weight={page === name ? 'fill' : 'regular'} />{name === 'cart' && cartUnits > 0 && <i>{cartUnits > 99 ? '99+' : cartUnits}</i>}</span><span>{title}</span></button>)}
    </nav>

    {settingsOpen && <div className="tb-overlay" onClick={() => setSettingsOpen(false)}><section className="tb-sheet tb-settings-sheet" onClick={e => e.stopPropagation()}>
      <div className="tb-sheet-top"><div><h2>店铺生成偏好</h2><p>小小定制一下你的淘宝世界</p></div><button aria-label="关闭生成偏好" onClick={() => setSettingsOpen(false)}><X size={23} /></button></div>
      <label className="tb-field-label" htmlFor="tb-pref">偏好描述（可留空）</label><textarea id="tb-pref" rows={5} maxLength={2000} value={preferences} disabled={busy} onChange={e => { edited.current = true; setPreferences(e.target.value); }} placeholder="例如：复古文具、奶油色家居、可爱的原创小店，价格亲民……" />
      <p className="tb-muted">刷新店铺和店内商品时使用，不会改动已经创建的订单。</p>
      <button className="tb-wide-primary" disabled={busy} onClick={() => { void saveCommercePreferences('taobao', preferences).then(() => { setSettingsOpen(false); addToast('偏好已保存', 'success'); }).catch(() => addToast('保存失败，请重试', 'error')); }}>保存并收起</button>
    </section></div>}

    {detail && !checkout && <div className="tb-detail">
      <div className="tb-detail-cover"><ProductVisual product={detail} large /><button className="tb-detail-back" aria-label="返回商品列表" onClick={() => setDetail(null)}><CaretLeft size={22} /></button><button className="tb-detail-cart" aria-label="打开购物车" onClick={() => { setDetail(null); navigate('cart'); }}><ShoppingCart size={22} />{cartUnits > 0 && <i>{cartUnits}</i>}</button></div>
      <div className="tb-detail-info"><div className="tb-detail-price">¥<strong>{money(detail.price)}</strong><span>模拟交易</span></div><h2>{detail.title}</h2><div className="tb-detail-tag"><span>好物推荐</span><span>虚拟商城</span><span>随心挑选</span></div><p className="tb-detail-description">{detail.detail}</p><div className="tb-detail-delivery"><Package size={21} /><span>模拟快递配送，预计约 {Math.max(1, Math.round((detail.deliveryMinutes || 4320) / 1440))} 天送达</span><CaretRight size={16} /></div><div className="tb-detail-delivery"><Storefront size={21} /><span>{detail.shop}</span></div>
      <div className="tb-detail-quantity"><b>购买数量</b><div className="tb-counter"><button aria-label="减少购买数量" onClick={() => setQuantity(n => Math.max(1, n - 1))}><Minus size={16} /></button><span>{quantity}</span><button aria-label="增加购买数量" onClick={() => setQuantity(n => Math.min(99, n + 1))}><Plus size={16} /></button></div></div></div>
      <div className="tb-detail-bottom"><button className="tb-detail-home" onClick={() => setDetail(null)}><Storefront size={22} />店铺</button><button className="tb-add-cart" onClick={() => void addCart(detail)}>加入购物车</button><button className="tb-buy-now" onClick={() => startCheckout([{ productId: detail.id, quantity }], false)}>立即购买</button></div>
    </div>}

    {checkout && <div className="tb-overlay" onClick={() => { if (!busy) setCheckout(null); }}><section className="tb-sheet tb-checkout-sheet" onClick={e => e.stopPropagation()}>
      <div className="tb-sheet-top"><div><h2>确认模拟订单</h2><p>不会产生真实扣费或外卖快递</p></div><button aria-label="关闭结算" disabled={busy} onClick={() => setCheckout(null)}><X size={23} /></button></div>
      <div className="tb-checkout-items">{checkout.map(line => { const p = liveProducts.get(line.productId); return p && <div className="tb-checkout-line" key={line.productId}><ProductVisual product={p} /><div><b>{p.title}</b><small>{p.shop} · ×{line.quantity}</small></div><strong>¥{money(p.price * line.quantity)}</strong></div>; })}</div>
      <label className="tb-field-label" htmlFor="tb-purchase-char">关联角色</label><select id="tb-purchase-char" value={charId} onChange={e => setCharId(e.target.value)}><option value="">请选择已接入的角色</option>{connected.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <div className="tb-field-label">谁来买，送给谁？</div><div className="tb-buy-modes">{([
        ['user-user', '我给自己买'], ['user-char', '我送给 TA'], ['char-user', '请 TA 送我'], ['char-char', 'TA 给自己买'],
      ] as const).map(([mode, label]) => <button className={purchaseMode === mode ? 'active' : ''} key={mode} onClick={() => setPurchaseMode(mode)}>{label}</button>)}</div>
      <div className="tb-checkout-bottom"><span>合计 <b>¥{money(checkout.reduce((s, line) => s + (liveProducts.get(line.productId)?.price || 0) * line.quantity, 0))}</b></span><button disabled={busy || !charId} onClick={() => void purchase()}>{busy ? '正在下单…' : '确认下单'}</button></div>
    </section></div>}
  </div>;
}
