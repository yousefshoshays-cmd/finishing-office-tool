import { ITEMS } from "./catalogue.js";

/* ============================= دفتر أسعار المكتب =============================
   الكتالوج في catalogue.js هو الافتراضي المدفون في الكود — لا يُعدَّل من الواجهة.
   دفتر الأسعار طبقة يملكها المكتب فوقه: تكلفة فعلية، سعر بيع، مورّد، تاريخ.

   لماذا التكلفة؟ لأن النظام قبل هذا كان يعرف بكم تبيع ولا يعرف بكم تشتري،
   فلم يكن ممكنًا معرفة الهامش على أي بند — ولا على المشروع كله.

   البنية:
   {
     items:  { "FIN-014": { cost:[..4], price:[..4], supplier, updatedAt, note } },
     custom: [ { id:"CUS-001", scope, name, unit, qtyPerArea, cost:[..4], price:[..4] } ],
     minMargin: 0.20
   }
   كل ما في items اختياري — أي حقل غائب يعود لافتراضي الكتالوج. */

export const DEFAULT_PRICEBOOK = { items: {}, custom: [], minMargin: 0.20 };

/* نسبة تكلفة افتراضية حين لا يُدخل المكتب تكلفة بعد.
   ليست تخمينًا للربح — هي مجرد نقطة بداية تُستبدل بأول تحديث حقيقي،
   ومعلَّمة بـ estimated حتى لا تُقرأ كرقم موثوق. */
const ASSUMED_COST_RATIO = 0.68;

export function newCustomItem(book) {
  const n = (book.custom || []).length + 1;
  return {
    id: `CUS-${String(n).padStart(3, "0")}`,
    scope: "التشطيبات المعمارية والتنفيذ",
    name: "",
    unit: "م²",
    qtyPerArea: 1,           // الكمية = المساحة × هذا المعامل
    cost: [0, 0, 0, 0],
    price: [0, 0, 0, 0],
    supplier: "",
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

/* البنود المتاحة = كتالوج النظام + بنود المكتب المخصصة، بنفس الشكل [scope,name,unit,qtyFn,prices,id] */
export function catalogueWithCustom(book) {
  const custom = (book?.custom || [])
    .filter(c => c.name && c.name.trim())
    .map(c => [c.scope, c.name, c.unit, (a) => a * (Number(c.qtyPerArea) || 0), c.price, c.id]);
  return [...ITEMS, ...custom];
}

/* السعر والتكلفة الساريان لبند عند مستوى معيّن */
export function bookEntry(book, item) {
  const [, , , , prices, id] = item;
  const ov = (book?.items || {})[id] || {};
  const custom = (book?.custom || []).find(c => c.id === id);
  return {
    price: ov.price || custom?.price || prices,
    cost: ov.cost || custom?.cost || null,
    supplier: ov.supplier || custom?.supplier || "",
    updatedAt: ov.updatedAt || custom?.updatedAt || "",
    hasRealCost: !!(ov.cost || custom?.cost),
  };
}

export function costAt(book, item, levelIdx) {
  const e = bookEntry(book, item);
  if (e.cost && e.cost[levelIdx] > 0) return { value: Number(e.cost[levelIdx]), estimated: false };
  const p = e.price[levelIdx] || 0;
  return { value: p * ASSUMED_COST_RATIO, estimated: true };
}

/* الهامش على بند واحد. sellPrice يُمرَّر من resolveItem لأنه قد يحمل تجاوزًا للعميل. */
export function itemMargin(book, item, levelIdx, sellPrice) {
  const { value: cost, estimated } = costAt(book, item, levelIdx);
  const price = Number(sellPrice) || 0;
  const profit = price - cost;
  return {
    cost, price, profit,
    ratio: price > 0 ? profit / price : 0,
    estimated,
  };
}

/* هامش المشروع كله — الرقم الذي كان غائبًا تمامًا.
   يُحسب على البنود المُضمَّنة فقط، ويُعلَّم إن كان أي جزء منه مبنيًا على تكلفة مقدّرة. */
export function projectMargin(book, resolvedRows, itemsById) {
  let revenue = 0, cost = 0, estimatedPart = 0;
  const weak = [];
  for (const r of resolvedRows) {
    if (!r.included) continue;
    const item = itemsById[r.id];
    if (!item) continue;
    const m = itemMargin(book, item, r.levelIdx, r.price);
    const lineRevenue = r.qty * m.price;
    const lineCost = r.qty * m.cost;
    revenue += lineRevenue;
    cost += lineCost;
    if (m.estimated) estimatedPart += lineRevenue;
    if (!m.estimated && m.ratio < (book?.minMargin ?? 0.20) && lineRevenue > 0) {
      weak.push({ id: r.id, name: r.name, ratio: m.ratio, revenue: lineRevenue });
    }
  }
  const profit = revenue - cost;
  return {
    revenue, cost, profit,
    ratio: revenue > 0 ? profit / revenue : 0,
    estimatedShare: revenue > 0 ? estimatedPart / revenue : 0,
    weakItems: weak.sort((a, b) => b.revenue - a.revenue),
  };
}

/* البنود التي لم تُحدَّث منذ مدة — أسعار السوق في مصر تتحرك بسرعة */
export function staleItems(book, days = 180, today = new Date()) {
  const cutoff = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const item of catalogueWithCustom(book)) {
    const e = bookEntry(book, item);
    if (!e.updatedAt || e.updatedAt < cutoff) {
      out.push({ id: item[5], name: item[1], updatedAt: e.updatedAt || null });
    }
  }
  return out;
}

export function updateBookItem(book, id, patch) {
  const items = { ...(book.items || {}) };
  items[id] = { ...(items[id] || {}), ...patch, updatedAt: new Date().toISOString().slice(0, 10) };
  return { ...book, items };
}
