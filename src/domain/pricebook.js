import { ITEMS } from "./catalogue.js";

/* ════════════════════════════════════════════════════════════════
   دفتر أسعار المكتب

   النظام قبل هذا كان يعرف بكم تبيع ولا يعرف بكم تشتري. الدفتر يضيف
   الطبقة الناقصة: تكلفة فعلية لكل بند عند كل مستوى، فيُحسب الهامش.

   قرار جوهري: التكلفة غير المُدخلة تبقى null ولا تُقدَّر أبدًا.
   افتراض نسبة تكلفة يعطي هامشًا يبدو دقيقًا وهو مخترع — وهذا أسوأ
   من لا شيء، لأن قرار التسعير سيُبنى عليه. الرقم الصادق هنا
   هو "غير معروف" مع عدّاد يوضح كم بندًا ينقصه.
   ════════════════════════════════════════════════════════════════ */

export const DEFAULT_PRICEBOOK = { items: {}, custom: [], minMargin: 0.20 };

export function newCustomItem(book) {
  const n = (book.custom || []).length + 1;
  return {
    id: `CUS-${String(n).padStart(3, "0")}`,
    scope: "التشطيبات المعمارية والتنفيذ",
    name: "", unit: "م²",
    qtyPerArea: 1,                 // الكمية = المساحة × هذا المعامل
    cost: [0, 0, 0, 0], price: [0, 0, 0, 0],
    supplier: "", updatedAt: new Date().toISOString().slice(0, 10),
  };
}

/* البنود المتاحة = كتالوج النظام + بنود المكتب، بنفس شكل [scope,name,unit,qtyFn,prices,id] */
export function catalogueWithCustom(book) {
  const custom = (book?.custom || [])
    .filter(c => c.name && c.name.trim())
    .map(c => [c.scope, c.name, c.unit, (a) => a * (Number(c.qtyPerArea) || 0), c.price, c.id]);
  return [...ITEMS, ...custom];
}

export function bookEntry(book, item) {
  const [, , , , prices, id] = item;
  const ov = (book?.items || {})[id] || {};
  const custom = (book?.custom || []).find(c => c.id === id);
  const cost = ov.cost || custom?.cost || null;
  return {
    price: ov.price || custom?.price || prices,
    cost,
    supplier: ov.supplier || custom?.supplier || "",
    updatedAt: ov.updatedAt || custom?.updatedAt || "",
  };
}

/* التكلفة عند مستوى: رقم حقيقي أو null. لا تقدير. */
export function costAt(book, item, levelIdx) {
  const e = bookEntry(book, item);
  const v = e.cost?.[levelIdx];
  return v > 0 ? Number(v) : null;
}

export function itemMargin(book, item, levelIdx, sellPrice) {
  const cost = costAt(book, item, levelIdx);
  const price = Number(sellPrice) || 0;
  if (cost == null) return { known: false, cost: null, price, profit: null, ratio: null };
  return { known: true, cost, price, profit: price - cost, ratio: price > 0 ? (price - cost) / price : 0 };
}

export function marginHealth(ratio, minMargin = 0.20) {
  if (ratio == null) return "unknown";
  if (ratio < 0) return "loss";
  if (ratio < minMargin) return "thin";
  return "ok";
}

/* هامش المشروع. يفصل بوضوح بين ما تعرف تكلفته وما لا تعرفه:
   coveredRevenue هو الجزء المحسوب فعلًا، و ratio يخصه وحده. */
export function projectMargin(book, resolvedRows, itemsById) {
  let revenue = 0, coveredRevenue = 0, cost = 0;
  const unknown = [], weak = [];
  for (const r of resolvedRows) {
    if (!r.included) continue;
    const item = itemsById[r.id];
    if (!item) continue;
    const lineRevenue = r.qty * (Number(r.price) || 0);
    revenue += lineRevenue;
    const m = itemMargin(book, item, r.levelIdx, r.price);
    if (!m.known) { unknown.push({ id: r.id, name: r.name, revenue: lineRevenue }); continue; }
    coveredRevenue += lineRevenue;
    cost += r.qty * m.cost;
    if (m.ratio < (book?.minMargin ?? 0.20) && lineRevenue > 0) {
      weak.push({ id: r.id, name: r.name, ratio: m.ratio, revenue: lineRevenue });
    }
  }
  return {
    revenue,
    coveredRevenue,
    cost,
    profit: coveredRevenue > 0 ? coveredRevenue - cost : null,
    ratio: coveredRevenue > 0 ? (coveredRevenue - cost) / coveredRevenue : null,
    coverage: revenue > 0 ? coveredRevenue / revenue : 0,   // كم من المشروع تعرف تكلفته
    complete: unknown.length === 0 && revenue > 0,
    unknownItems: unknown.sort((a, b) => b.revenue - a.revenue),
    weakItems: weak.sort((a, b) => b.revenue - a.revenue),
  };
}

/* أسعار السوق في مصر تتحرك بسرعة — البند المنسي يخسر بصمت */
export function staleItems(book, days = 180, today = new Date()) {
  const cutoff = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const item of catalogueWithCustom(book)) {
    const e = bookEntry(book, item);
    if (!e.updatedAt || e.updatedAt < cutoff) out.push({ id: item[5], name: item[1], updatedAt: e.updatedAt || null });
  }
  return out;
}

export function updateBookItem(book, id, patch) {
  const items = { ...(book.items || {}) };
  items[id] = { ...(items[id] || {}), ...patch, updatedAt: new Date().toISOString().slice(0, 10) };
  return { ...book, items };
}
