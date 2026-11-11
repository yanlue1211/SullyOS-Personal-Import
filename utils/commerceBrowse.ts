import { readCommerce, type CommerceProduct } from './personalCommerce';

export const COMMERCE_BROWSE_LIMIT = 8;
export const COMMERCE_BROWSE_ROUNDS = 3;
const TAG = /<逛商城>\s*([\s\S]*?)\s*<\/逛商城>/g;
export const stripCommerceBrowse = (text: string) => text.replace(TAG, '').replace(/<逛商城>[\s\S]*$/, '');
export const hasCommerceBrowse = (text: string) => /<逛商城>/.test(text);

/** Read-only, paginated lookup; permissions and products are read afresh for each query. */
export async function queryCommerceProducts(charId: string, raw: unknown) {
    const args = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const { products, members } = await readCommerce();
    const words = String(args.query || '').trim().slice(0, 120).toLowerCase().split(/\s+/).filter(Boolean);
    const kind = args.kind === 'taobao' || args.kind === 'meituan' ? args.kind : undefined;
    const rank = (p: CommerceProduct) => words.reduce((n, word) => n + Number(`${p.title} ${p.shop} ${p.category || ''} ${p.detail}`.toLowerCase().includes(word)), 0);
    const matches = products.filter(p => members[p.kind].includes(charId) && (!kind || p.kind === kind)
        && (!args.shopId || p.shopId === args.shopId) && (!words.length || rank(p) > 0))
        .sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
    const offset = Number.isFinite(Number(args.offset)) ? Math.max(0, Math.floor(Number(args.offset))) : 0;
    const page = matches.slice(offset, offset + COMMERCE_BROWSE_LIMIT);
    return {
        products: page.map(p => ({ id: p.id, kind: p.kind, shop: p.shop, title: p.title, price: p.price, detail: p.detail.slice(0, 120) })),
        total: matches.length,
        nextOffset: offset + page.length < matches.length ? offset + page.length : null,
    };
}

/** Only an explicit browse action can cause a follow-up; ordinary turns make zero calls. */
export async function resolveCommerceBrowse(input: {
    text: string; charId: string; messages: any[]; signal?: AbortSignal;
    complete: (messages: any[], round: number) => Promise<string>;
}): Promise<string> {
    let text = input.text;
    const messages = [...input.messages];
    for (let round = 0; hasCommerceBrowse(text) && round < COMMERCE_BROWSE_ROUNDS; round++) {
        input.signal?.throwIfAborted();
        const raw = [...text.matchAll(TAG)][0]?.[1];
        let result: unknown;
        try { result = await queryCommerceProducts(input.charId, JSON.parse(raw || '{}')); }
        catch { result = { error: '查询格式或商城读取失败；没有创建订单。' }; }
        // Don't replay unrelated action tags or provisional heart content from an intermediate round.
        messages.push({ role: 'assistant', content: `<逛商城>${raw || '{}'}</逛商城>` });
        messages.push({ role: 'user', content: `[商城查询结果，仅供本轮选购，不是新的用户发言]\n${JSON.stringify(result)}\n只可从返回的有效商品中选择；没有合适商品可不买。${round + 1 === COMMERCE_BROWSE_ROUNDS ? '本轮查询结束，不再查询。' : '需要时可换关键词或按 nextOffset 翻页。'}需要购买才输出购物标签，一轮最多一单；否则自然回应。不要复述目录或声称已经下单。` });
        text = await input.complete(messages, round + 1);
    }
    // A model repeating the query at the cap cannot leak protocol tags or initiate another request.
    return stripCommerceBrowse(text);
}
