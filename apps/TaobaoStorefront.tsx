import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowClockwise, CaretLeft, CaretRight, Check, MagnifyingGlass, Minus,
  Package, Plus, Receipt, ShoppingCart, SlidersHorizontal, Storefront, Trash, UserCircle, X, MapPin, PencilSimple,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { extractContent, extractJson, safeFetchJson } from '../utils/safeApi';
import {
  addTaobaoCartItem, checkoutTaobaoProducts, normalizeProducts,
  normalizeTaobaoCatalog, saveTaobaoCatalog, appendTaobaoProducts,
  deleteTaobaoAddress, saveTaobaoAddress, setDefaultTaobaoAddress,
  readCommerce, saveCommerceMembers, saveCommercePreferences,
  setTaobaoCartQuantity, type CommerceOrder, type CommerceProduct, type CommerceShop,
  type TaobaoCartLine, type TaobaoAddress, type TaobaoProfile, orderStatus,
  resolveCommerceSelection, taobaoCartLineKey, type CommerceSelectedOptions,
} from '../utils/personalCommerce';
import './taobao.css';

type Page = 'home' | 'cart' | 'orders' | 'people';
type PurchaseMode = 'user-char' | 'char-user' | 'user-user' | 'char-char';
type CheckoutLine = TaobaoCartLine;

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
  return <div className={`tb-product-visual tb-visual-${hue} ${large ? 'tb-product-visual-large' : ''}`} aria-label="商品图">
    <span className="tb-visual-glow" aria-hidden="true" /><span className="tb-visual-emoji" aria-hidden="true">{emoji}</span>

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
  const [detailOptions,setDetailOptions] = useState<CommerceSelectedOptions>({});
  const [preferences, setPreferences] = useState('');
  const edited = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [checkout, setCheckout] = useState<CheckoutLine[] | null>(null);
  const [fromCart, setFromCart] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>('user-user');
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationMode, setGenerationMode] = useState<'catalog' | 'shop'>('catalog');
  const [generationKeyword, setGenerationKeyword] = useState('');
  const [profiles, setProfiles] = useState<Record<string,TaobaoProfile>>({});
  const [profileOwner, setProfileOwner] = useState<string | null>(null);
  const [addressEdit, setAddressEdit] = useState<TaobaoAddress | 'new' | null>(null);
  const [addressDraft, setAddressDraft] = useState({ label:'家', recipientName:'', phone:'', detail:'' });
  const [addressId, setAddressId] = useState('');

  const connected = characters.filter(c => members.includes(c.id));
  const who = (id: string) => id === '__user__' ? userProfile.name || '我' : characters.find(c => c.id === id)?.name || '';
  const profile = profileOwner ? profiles[profileOwner] : undefined;
  const profileOrders = profileOwner ? orders.filter(o => profileOwner === '__user__'
    ? o.buyer === 'user' || o.recipient === 'user' : o.charId === profileOwner) : [];
  const recipientOwner = purchaseMode.endsWith('-char') ? charId : '__user__';
  const recipientProfile = profiles[recipientOwner];
  const deliveryAddressId = addressId && recipientProfile?.addresses.some(a => a.id === addressId)
    ? addressId : recipientProfile?.defaultAddressId || '';
  const openGenerator = (mode: 'catalog' | 'shop') => {
    setGenerationMode(mode);setGenerationKeyword('');setGenerationOpen(true);
  };
  const openAddress = (address?:TaobaoAddress) => {
    setAddressEdit(address || 'new');
    setAddressDraft(address ? {label:address.label,recipientName:address.recipientName,phone:address.phone,detail:address.detail}
      : {label:'家',recipientName:'',phone:'',detail:''});
  };
  const liveProducts = new Map(items.map(p => [p.id, p]));
  const allCategories = ['全部', ...new Set(shops.map(s => s.category))];
  const matchesSearch = (text: string) => !searchTerm || text.toLowerCase().includes(searchTerm.toLowerCase());
  const visibleShops = shops.filter(s => (category === '全部' || s.category === category)
    && matchesSearch(s.name + s.category + s.description));
  const visibleProducts = items.filter(p => (!shop || p.shopId === shop.id)
    && (category === '全部' || p.category === category || !!shop)
    && matchesSearch(p.title + p.detail + p.shop + (p.category || '')));
  const cartKey=(line:TaobaoCartLine)=>taobaoCartLineKey(line);
  const linePrice=(line:TaobaoCartLine)=>{const p=liveProducts.get(line.productId);if(!p)return 0;try{return resolveCommerceSelection(p,line.selectedOptions).price;}catch{return 0;}};
  const openDetail=(p:CommerceProduct,choices?:CommerceSelectedOptions)=>{setDetail(p);setQuantity(1);setDetailOptions(resolveCommerceSelection(p,choices).options);};
  const selectedDetail=detail?resolveCommerceSelection(detail,detailOptions):undefined;
  const validCart = cart.filter(line => liveProducts.has(line.productId));
  const allSelected = validCart.length > 0 && validCart.every(line => selected.includes(cartKey(line)));
  const cartUnits = cart.reduce((total, line) => total + line.quantity, 0);
  const selectedLines = validCart.filter(line => selected.includes(cartKey(line)));
  const total = selectedLines.reduce((sum, line) => sum + linePrice(line) * line.quantity, 0);

  const load = async () => {
    const s = await readCommerce();
    setShops(s.shops.filter(v => v.kind === 'taobao'));
    setItems(s.products.filter(v => v.kind === 'taobao'));
    setOrders(s.orders.filter(v => v.product.kind === 'taobao').reverse());
    setCart(s.cart);
    setMembers(s.members.taobao);
    setProfiles(s.taobaoProfiles);
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
        model: apiConfig.model, stream: false, temperature: 0.85, max_tokens: 12000,
        messages: [
          { role: 'system', content: '你负责设计真实自然的商店和商品。仅返回指定结构的完整 JSON 数组，不扮演角色、不写台词、不输出图片网址。商品名称、规格与价格自然合理。' },
          { role: 'user', content: instruction + suffix },
        ],
      }),
    }, 0, 180000);
    return extractJson(extractContent(response));
  };
  const generateCatalog = async (keyword:string) => {
    if(busy)return;
    setBusy(true);
    try {
      const context=keyword.trim()?('主题关键词：'+keyword.trim()):'主题自由发挥，随机搭配日常购物的多种品类';
      const data=await requestCatalog(`一次生成完整的淘宝商城目录：严格生成8家不同店铺，每店严格8件商品，共64件。分类涵盖服饰、数码、家居、文具、食品、饰品等至少3类，尽量符合下面的主题。\n${context}\n仅返回JSON数组，严格8个对象，每项 {"name":"店名","category":"类别","description":"店铺特色","products":[{"title":"商品名称","detail":"卖点简述","price":19.9,"deliveryMinutes":4320,"variants":[{"name":"颜色","options":[{"label":"黑色"},{"label":"白色"}]},{"name":"规格","options":[{"label":"1kg","price":19.9},{"label":"5kg","price":79.9}]}]}]}，products必须有8项。商品按类型设置0到2组真实可选规格，如耳机颜色、狗粮重量、衣服印花/尺码；每组2到5项，选项可带对应价格，若无可选规格就省略variants，不要强行添加。价格用数字，配送分钟1440到7200，不要多余文本。`);
      const batch=normalizeTaobaoCatalog(data);
      await saveTaobaoCatalog(batch);
      setShop(null);setCategory('全部');setSearchTerm('');setQuery('');setSelected([]);
      await load();
      setGenerationOpen(false);
      addToast('8家店铺和64件商品都已上新', 'success');
    } catch(e:any){addToast(e.message||'生成失败，之前的店铺已保留','error');}
    finally{setBusy(false);}
  };
  const generateExtraProducts = async (target: CommerceShop, keyword:string) => {
    if(busy)return;
    setBusy(true);
    try {
      const existing=items.filter(p=>p.shopId===target.id).map(p=>p.title).slice(-40).join('、');
      const context=keyword.trim()?('新增商品关键词：'+keyword.trim()):'自由发挥，为该店随机补充合适的商品';
      const data=await requestCatalog(`为店铺「${target.name}」额外生成8件全新商品，追加到原有商品后面，不替换、不重复。分类：${target.category}；特色：${target.description}。\n${context}\n已有商品名称（避免重复）：${existing||'暂无'}。\n只返回严格8项的JSON数组，每项 {"title":"名称","detail":"规格和卖点","price":29.9,"deliveryMinutes":4320,"variants":[{"name":"颜色","options":[{"label":"黑色"},{"label":"米白"}]}]}。按商品类型生成0到2组可选规格，如颜色、克重、印花、尺码；选项可以是带price数字的对象。没有实际可选项可省略variants。价格为数字，配送分钟1440到7200。`);
      if(!Array.isArray(data)||data.length!==8)throw new Error('本次商品没有生成完整，原商品仍在');
      const additions=normalizeProducts(data,'taobao');
      if(additions.length!==8)throw new Error('部分商品数据不完整，原商品仍在');
      await appendTaobaoProducts(target,additions);
      await load();setGenerationOpen(false);
      addToast('已为这家店新增商品','success');
    } catch(e:any){addToast(e.message||'新增商品失败，旧商品已保留','error');}
    finally{setBusy(false);}
  };
  const enterShop = (target: CommerceShop) => {
    setShop(target);setCategory('全部');setSearchTerm('');setQuery('');
  };
  const saveAddress = async () => {
    if(!profileOwner || !addressEdit || busy)return;
    setBusy(true);
    try{
      await saveTaobaoAddress(profileOwner,addressDraft,addressEdit==='new'?undefined:addressEdit.id);
      await load();setAddressEdit(null);addToast('地址已保存','success');
    }catch(e:any){addToast(e.message||'地址保存失败','error');}
    finally{setBusy(false);}
  };
  const removeAddress = async (id:string) => {
    if(!profileOwner||busy)return;
    try{await deleteTaobaoAddress(profileOwner,id);await load();addToast('地址已删除','success');}
    catch(e:any){addToast(e.message||'删除地址失败','error');}
  };
  const makeDefaultAddress = async (id:string) => {
    if(!profileOwner||busy)return;
    try{await setDefaultTaobaoAddress(profileOwner,id);await load();}
    catch(e:any){addToast(e.message||'设置默认地址失败','error');}
  };
  const toggleMember = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try { await saveCommerceMembers('taobao', members.includes(id) ? members.filter(x => x !== id) : [...members, id]); await load(); }
    catch { addToast('保存接入角色失败', 'error'); }
    finally { setBusy(false); }
  };
  const addCart = async (product: CommerceProduct) => {
    try { await addTaobaoCartItem(product.id, quantity, detailOptions); await load(); addToast(`已加入购物车 · ${quantity}件`, 'success'); }
    catch (e: any) { addToast(e.message || '购物车保存失败', 'error'); }
  };
  const changeQuantity = async (line:TaobaoCartLine,value:number) => {
    try { await setTaobaoCartQuantity(line.productId,value,line.selectedOptions);await load();if(value<=0)setSelected(old=>old.filter(id=>id!==cartKey(line))); }
    catch (e: any) { addToast(e.message || '数量修改失败', 'error'); }
  };
  const startCheckout = (lines: CheckoutLine[], cartCheckout: boolean) => {
    if (!lines.length) { addToast('请先选中想买的商品', 'error'); return; }
    if (!connected.length) { setDetail(null); setPage('people'); addToast('请先接入一位角色，才能创建订单', 'error'); return; }
    setFromCart(cartCheckout); setCheckout(lines); setPurchaseMode('user-user');setAddressId('');
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
        lines: checkout, removeFromCart: fromCart, addressId:deliveryAddressId||undefined,
      });
      setCheckout(null); setDetail(null); setSelected([]); setShop(null); setPage('orders');
      await load();
      addToast(`下单成功，已创建${created.length}笔订单`, 'success');
    } catch (e: any) { addToast(e.message || '结算失败，商品和购物车已保留', 'error'); }
    finally { setBusy(false); }
  };
  const navigate = (to: Page) => { setPage(to); setDetail(null); setCheckout(null); setSettingsOpen(false);setGenerationOpen(false);setProfileOwner(null);setAddressEdit(null); if (to === 'home') setShop(null); };

  return <div className="tb-root" style={{ paddingTop: 'var(--safe-top)' }}>
    <header className="tb-header">
      <div className="tb-header-top">
        <button type="button" className="tb-back" aria-label="返回糯米机桌面" onClick={closeApp}><CaretLeft size={19} /></button>
        <div className="tb-brand"><span className="tb-brand-badge">淘</span><b>淘宝</b></div>
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
            <button className="tb-outline-btn" disabled={busy} onClick={() => openGenerator('shop')}><ArrowClockwise size={16} /> {busy ? '上新中…' : '新增商品'}</button>
          </div>
          <div className="tb-shop-banner"><span className="tb-shop-banner-icon"><Storefront size={25} /></span><div><b>{shop.name}</b><p>{shop.category} · {shop.description}</p></div></div>
          <div className="tb-section-heading"><strong>店内好物</strong><span>{visibleProducts.length} 件商品</span></div>
        </> : <>
          <div className="tb-hero"><div><span className="tb-hero-kicker">GOOD THINGS · EVERY DAY</span><h1>随心逛<span>，</span>慢慢挑</h1><p>把喜欢的东西装进购物车 ♡</p></div><span className="tb-hero-deco" aria-hidden="true">✳</span></div>
          <div className="tb-catalog-actions">
            <span>每天都有新发现</span>
            <button disabled={busy} onClick={() => openGenerator('catalog')}><ArrowClockwise size={17} />{busy ? '正在准备…' : shops.length ? '换一批店铺' : '生成店铺'}</button>
          </div>
          {searchTerm && <div className="tb-search-summary">“{searchTerm}” 的搜索结果 <button onClick={() => { setSearchTerm(''); setQuery(''); }}>清除</button></div>}
          {shops.length > 0 && <>
            <div className="tb-section-heading"><strong>精选店铺</strong><span>逛逛新发现</span></div>
            <div className="tb-shop-scroll">{visibleShops.map((s, i) => <button key={s.id} className="tb-shop-mini" onClick={() => enterShop(s)}><span className={`tb-shop-avatar tb-avatar-${i % 4}`}><Storefront size={23} /></span><b>{s.name}</b><small>{s.category}</small></button>)}</div>
          </>}
          {shops.length > 0 && <div className="tb-category-strip">{allCategories.map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>}
          {items.length > 0 && <div className="tb-section-heading tb-recommend-title"><strong>猜你喜欢</strong><span>为你挑选的小好物</span></div>}
        </>}
        {visibleProducts.length > 0 ? <div className="tb-product-grid">{visibleProducts.map(p => <button className="tb-product-card" key={p.id} onClick={() => openDetail(p)}><ProductVisual product={p} /><div className="tb-card-copy"><b>{p.title}</b><p>{p.detail}</p><div className="tb-card-price"><span>¥<strong>{money(p.price)}</strong></span><small>送货到家</small></div></div></button>)}</div>
          : !busy && (shops.length === 0 ? <EmptyPanel icon="🛍️" title="商场还没开门" text="生成一批店铺，就可以开始逛了。" action={<button className="tb-primary-small" onClick={() => openGenerator('catalog')}>生成店铺</button>} />
            : shop ? <EmptyPanel icon="🎁" title="店里还没有商品" text="给小店上点新货。" action={<button className="tb-primary-small" onClick={() => openGenerator('shop')}>新增商品</button>} />
            : items.length === 0 ? <EmptyPanel icon="🏬" title="先去逛一家店吧" text="选一家喜欢的小店看看。" /> : <EmptyPanel icon="🔎" title="没找到相关好物" text="换个关键词或分类再试试。" />)}
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
                return <div className="tb-cart-row" key={cartKey(line)}>
                  <button className={`tb-check ${selected.includes(cartKey(line)) ? 'checked' : ''}`} aria-label={`选择${product.title}`} onClick={() => setSelected(v => v.includes(cartKey(line)) ? v.filter(id => id !== cartKey(line)) : [...v, cartKey(line)])}>{selected.includes(cartKey(line)) && <Check size={14} weight="bold" />}</button>
                  <button className="tb-cart-thumb" onClick={() => openDetail(product,line.selectedOptions)}><ProductVisual product={product} /></button>
                  <div className="tb-cart-info"><b>{product.title}</b><p>{resolveCommerceSelection(product,line.selectedOptions).summary||product.detail}</p><span className="tb-cart-price">¥{money(linePrice(line))}</span><div className="tb-cart-row-bottom"><div className="tb-counter"><button aria-label="减少数量" onClick={() => void changeQuantity(line, line.quantity - 1)}><Minus size={14} /></button><span>{line.quantity}</span><button aria-label="增加数量" onClick={() => void changeQuantity(line, line.quantity + 1)}><Plus size={14} /></button></div><button aria-label="移除商品" className="tb-remove" onClick={() => void changeQuantity(line, 0)}><Trash size={18} /></button></div></div>
                </div>;
              })}
            </section>)}
          {cart.filter(line => !liveProducts.has(line.productId)).map(line => <div className="tb-expired" key={cartKey(line)}><span>这件商品已随店铺刷新下架，不能结算</span><button onClick={() => void changeQuantity(line, 0)}>移除</button></div>)}
        </div> : <EmptyPanel icon="🛒" title="购物车还是空空的" text="看到喜欢的商品，就把它先装进来。" action={<button className="tb-primary-small" onClick={() => navigate('home')}>去逛逛</button>} />}
      </>}

      {page === 'orders' && <>
        <div className="tb-page-title"><h2>我的订单</h2><small>每一份快乐都有迹可循</small></div>
        {orders.length ? <div className="tb-order-list">{orders.map(o => <section key={o.id} className="tb-order-card">
          <div className="tb-order-top"><span><Storefront size={17} /> {o.product.shop}</span><b>{orderStatus(o)}</b></div>
          <div className="tb-order-body"><ProductVisual product={o.product} /><div><b>{o.product.title}</b><p>{Object.entries(o.selectedOptions||{}).map(([k,v])=>k+'：'+v).join(' · ')||o.product.detail}</p><span>¥{money(o.unitPrice??o.product.price)}{(o.quantity || 1) > 1 ? ` × ${o.quantity}` : ''}</span></div></div>
          <div className="tb-order-foot"><span>{o.buyer === 'char' ? o.charName : o.userName} 买给 {o.recipient === 'char' ? o.charName : o.userName}<br />预计 {new Date(o.eta).toLocaleString()} 送达</span><strong>合计 ¥{money((o.unitPrice??o.product.price) * (o.quantity || 1))}</strong></div>
        </section>)}</div> : <EmptyPanel icon="📦" title="还没有订单" text="结算后就可以在这里查看状态。" />}
      </>}

      {page === 'people' && <>
        {!profileOwner ? <>
          <div className="tb-page-title"><h2>我的淘宝</h2><small>购物伙伴与地址管理</small></div>
          <section className="tb-people-card tb-profile-index">
            <button className="tb-profile-link" onClick={() => setProfileOwner('__user__')}>
              <span className="tb-person-initial"><UserCircle size={24} /></span>
              <span><b>我的收货信息</b><small>地址管理 · {profiles.__user__?.addresses.length||0} 个地址</small></span><CaretRight size={18} />
            </button>
          </section>
          <div className="tb-section-heading"><strong>一起逛淘宝</strong><span>{members.length} 位已接入</span></div>
          <section className="tb-people-card tb-profile-index">
            {characters.map(c => <button className="tb-profile-link" key={c.id} onClick={() => setProfileOwner(c.id)}>
              <span className="tb-person-initial">{c.name.slice(0,1)}</span>
              <span><b>{c.name}</b><small>{members.includes(c.id)?'已接入':'未接入'} · {orders.filter(o=>o.charId===c.id).length} 笔订单</small></span>
              <CaretRight size={18} />
            </button>)}
            {!characters.length && <p>还没有角色，先去神经链接创建吧。</p>}
          </section>
        </> : <>
          <button className="tb-go-back tb-profile-back" onClick={() => {setProfileOwner(null);setAddressEdit(null);}}><CaretLeft size={17} /> 返回</button>
          <div className="tb-page-title"><h2>{who(profileOwner)}的淘宝</h2><small>{profileOwner === '__user__' ? '我的个人中心':'购物个人中心'}</small></div>
          {profileOwner!=='__user__' && <section className="tb-people-card tb-profile-settings">
            <label className="tb-person-row"><span className="tb-person-initial">{who(profileOwner).slice(0,1)}</span><span className="tb-person-copy"><b>接入淘宝</b><small>开启后可在聊天中选购商品</small></span>
              <input type="checkbox" checked={members.includes(profileOwner)} disabled={busy} onChange={() => void toggleMember(profileOwner)} /></label>
          </section>}
          <section className="tb-people-card">
            <div className="tb-address-header"><strong>常用收货地址</strong><button onClick={() => openAddress()}><Plus size={17}/> 新增</button></div>
            {profile?.addresses.map(a=><div className="tb-address-entry" key={a.id}>
              <MapPin size={21} className="tb-address-pin"/>
              <div><b>{a.recipientName} <small>{a.phone}</small></b><p>{a.detail}</p><div className="tb-address-tag">{profile.defaultAddressId===a.id && <span>默认</span>}{a.label&&<span>{a.label}</span>}</div>
                <div className="tb-address-controls"><button onClick={() => void makeDefaultAddress(a.id)} disabled={profile.defaultAddressId===a.id}>设为默认</button><button onClick={() => openAddress(a)}>编辑</button><button onClick={() => void removeAddress(a.id)}>删除</button></div>
              </div>
            </div>)}
            {!profile?.addresses.length && <p className="tb-address-empty">还没有保存收货地址</p>}
          </section>
          {profileOwner!=='__user__'&&<>
            <div className="tb-section-heading"><strong>他的订单</strong><span>{profileOrders.length} 笔</span></div>
            {profileOrders.length?<div className="tb-order-list">
              {profileOrders.map(o=><section key={o.id} className="tb-order-card">
                <div className="tb-order-top"><span><Storefront size={17}/>{o.product.shop}</span><b>{orderStatus(o)}</b></div>
                <div className="tb-order-body"><ProductVisual product={o.product}/><div><b>{o.product.title}</b><p>{o.product.detail}</p><span>¥{money(o.unitPrice??o.product.price)} × {o.quantity||1}</span></div></div>
                <div className="tb-order-foot"><span>{o.buyer==='char'?o.charName:o.userName} 买给 {o.recipient==='char'?o.charName:o.userName}{o.deliveryAddress&&<><br/>收货：{o.deliveryAddress.recipientName} · {o.deliveryAddress.detail}</>}</span><strong>¥{money((o.unitPrice??o.product.price)*(o.quantity||1))}</strong></div>
              </section>)}
            </div>:<EmptyPanel icon="📦" title="还没有订单" text="TA 购买或收到的商品会出现在这里。" />}
          </>}
        </>}
      </>}
    </main>

    {page === 'cart' && cart.length > 0 && <div className="tb-cart-checkout"><button className={`tb-check ${allSelected ? 'checked' : ''}`} onClick={() => setSelected(allSelected ? [] : validCart.map(cartKey))} aria-label="全选">{allSelected && <Check size={14} weight="bold" />}</button><span>全选</span><div className="tb-cart-total"><small>合计</small><b>¥{money(total)}</b></div><button disabled={!selectedLines.length} onClick={() => startCheckout(selectedLines, true)}>结算 ({selectedLines.length})</button></div>}
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


    {generationOpen && <div className="tb-overlay" onClick={() => {if(!busy)setGenerationOpen(false);}}><section className="tb-sheet tb-generator-sheet" onClick={e=>e.stopPropagation()}>
      <div className="tb-sheet-top"><div><h2>{generationMode==='catalog'?'生成新店铺':'为店铺新增商品'}</h2>
        <p>{generationMode==='catalog'?'一次生成8家店铺，每家8件商品':`为「${shop?.name||''}」追加8件商品`}</p></div>
        <button aria-label="关闭生成面板" disabled={busy} onClick={()=>setGenerationOpen(false)}><X size={23}/></button>
      </div>
      <label className="tb-field-label" htmlFor="tb-generation-keyword">关键词（可留空）</label>
      <input id="tb-generation-keyword" className="tb-generator-input" value={generationKeyword} maxLength={160}
        disabled={busy} onChange={e=>setGenerationKeyword(e.target.value)}
        placeholder={generationMode==='catalog'?'例如：毛绒玩偶、爱豆周边、日常用品':'例如：新款发夹、可爱小饰品'} />
      <p className="tb-muted">不填写就随机发挥。{generationMode==='catalog'?'会在整批数据完成后替换原店铺；历史订单不会删除。':'只添加新商品，不会覆盖店内已有商品。'}</p>
      <button className="tb-wide-primary" disabled={busy || (generationMode==='shop'&&!shop)}
        onClick={()=>{if(generationMode==='catalog')void generateCatalog(generationKeyword);else if(shop)void generateExtraProducts(shop,generationKeyword);}}>
        {busy?'正在准备商品…':generationMode==='catalog'?'生成店铺与商品':'添加到店铺'}
      </button>
    </section></div>}

    {addressEdit && profileOwner && <div className="tb-overlay" onClick={()=>{if(!busy)setAddressEdit(null);}}><section className="tb-sheet tb-address-sheet" onClick={e=>e.stopPropagation()}>
      <div className="tb-sheet-top"><div><h2>{addressEdit==='new'?'新增收货地址':'编辑收货地址'}</h2><p>{who(profileOwner)}的收货信息</p></div>
        <button aria-label="关闭地址编辑" disabled={busy} onClick={()=>setAddressEdit(null)}><X size={23}/></button></div>
      <label className="tb-field-label" htmlFor="tb-address-name">收件人</label>
      <input id="tb-address-name" value={addressDraft.recipientName} maxLength={60} onChange={e=>setAddressDraft(v=>({...v,recipientName:e.target.value}))} placeholder="姓名"/>
      <label className="tb-field-label" htmlFor="tb-address-phone">联系电话</label>
      <input id="tb-address-phone" type="tel" value={addressDraft.phone} maxLength={40} onChange={e=>setAddressDraft(v=>({...v,phone:e.target.value}))} placeholder="联系电话（可留空）"/>
      <label className="tb-field-label" htmlFor="tb-address-detail">详细地址</label>
      <textarea id="tb-address-detail" rows={3} value={addressDraft.detail} maxLength={320} onChange={e=>setAddressDraft(v=>({...v,detail:e.target.value}))} placeholder="省市区、街道、门牌号" />
      <label className="tb-field-label" htmlFor="tb-address-label">地址标签</label>
      <input id="tb-address-label" value={addressDraft.label} maxLength={24} onChange={e=>setAddressDraft(v=>({...v,label:e.target.value}))} placeholder="家 / 公司 / 学校"/>
      <button className="tb-wide-primary" disabled={busy||!addressDraft.recipientName.trim()||!addressDraft.detail.trim()} onClick={()=>void saveAddress()}>{busy?'正在保存…':'保存地址'}</button>
    </section></div>}

    {detail && !checkout && <div className="tb-detail">
      <div className="tb-detail-cover"><ProductVisual product={detail} large /><button className="tb-detail-back" aria-label="返回商品列表" onClick={() => setDetail(null)}><CaretLeft size={22} /></button><button className="tb-detail-cart" aria-label="打开购物车" onClick={() => { setDetail(null); navigate('cart'); }}><ShoppingCart size={22} />{cartUnits > 0 && <i>{cartUnits}</i>}</button></div>
      <div className="tb-detail-info"><div className="tb-detail-price">¥<strong>{money(selectedDetail?.price||detail.price)}</strong></div><h2>{detail.title}</h2><div className="tb-detail-tag"><span>好物推荐</span><span>店铺精选</span><span>随心挑选</span></div><p className="tb-detail-description">{detail.detail}</p><div className="tb-detail-delivery"><Package size={21} /><span>预计约 {Math.max(1, Math.round((detail.deliveryMinutes || 4320) / 1440))} 天送达</span><CaretRight size={16} /></div><div className="tb-detail-delivery"><Storefront size={21} /><span>{detail.shop}</span></div>
      {detail.variants?.map(group=><section key={group.name} className="tb-detail-options">
        <b>{group.name}</b>
        <div role="group" aria-label={group.name} className="tb-variant-pills">
          {group.options.map(option=><button type="button" key={option.label} className={detailOptions[group.name]===option.label?'selected':''}
            aria-pressed={detailOptions[group.name]===option.label}
            onClick={()=>setDetailOptions(old=>({...old,[group.name]:option.label}))}>
            {option.label}{option.price!==undefined&&<small>¥{money(option.price)}</small>}
          </button>)}
        </div>
      </section>)}
      <div className="tb-detail-quantity"><b>购买数量</b><div className="tb-counter"><button aria-label="减少购买数量" onClick={() => setQuantity(n => Math.max(1, n - 1))}><Minus size={16} /></button><span>{quantity}</span><button aria-label="增加购买数量" onClick={() => setQuantity(n => Math.min(99, n + 1))}><Plus size={16} /></button></div></div></div>
      <div className="tb-detail-bottom"><button className="tb-detail-home" onClick={() => setDetail(null)}><Storefront size={22} />店铺</button><button className="tb-add-cart" onClick={() => void addCart(detail)}>加入购物车</button><button className="tb-buy-now" onClick={() => startCheckout([{ productId: detail.id, quantity,selectedOptions:detailOptions }], false)}>立即购买</button></div>
    </div>}

    {checkout && <div className="tb-overlay" onClick={() => { if (!busy) setCheckout(null); }}><section className="tb-sheet tb-checkout-sheet" onClick={e => e.stopPropagation()}>
      <div className="tb-sheet-top"><div><h2>确认订单</h2><p>确认一下商品和收货信息</p></div><button aria-label="关闭结算" disabled={busy} onClick={() => setCheckout(null)}><X size={23} /></button></div>
      <div className="tb-checkout-items">{checkout.map(line => { const p = liveProducts.get(line.productId); return p && <div className="tb-checkout-line" key={cartKey(line)}><ProductVisual product={p} /><div><b>{p.title}</b><small>{p.shop} · {resolveCommerceSelection(p,line.selectedOptions).summary||'默认规格'} · ×{line.quantity}</small></div><strong>¥{money(linePrice(line) * line.quantity)}</strong></div>; })}</div>
      <label className="tb-field-label" htmlFor="tb-purchase-char">关联角色</label><select id="tb-purchase-char" value={charId} onChange={e => setCharId(e.target.value)}><option value="">请选择已接入的角色</option>{connected.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <div className="tb-field-label">谁来买，送给谁？</div><div className="tb-buy-modes">{([
        ['user-user', '我给自己买'], ['user-char', '我送给 TA'], ['char-user', '请 TA 送我'], ['char-char', 'TA 给自己买'],
      ] as const).map(([mode, label]) => <button className={purchaseMode === mode ? 'active' : ''} key={mode} onClick={() => setPurchaseMode(mode)}>{label}</button>)}</div>
      <div className="tb-field-label">收货地址 · {who(recipientOwner)}</div>
      {recipientProfile?.addresses.length ? <select aria-label="选择收货地址" value={deliveryAddressId} onChange={e=>setAddressId(e.target.value)}>
        {recipientProfile.addresses.map(a=><option key={a.id} value={a.id}>{a.label||'收货'} · {a.recipientName} · {a.detail}</option>)}
      </select> : <p className="tb-muted">还没有保存地址，可以先下单，稍后再去角色页面填写。</p>}
      <div className="tb-checkout-bottom"><span>合计 <b>¥{money(checkout.reduce((s, line) => s + linePrice(line) * line.quantity, 0))}</b></span><button disabled={busy || !charId} onClick={() => void purchase()}>{busy ? '正在下单…' : '确认下单'}</button></div>
    </section></div>}
  </div>;
}
