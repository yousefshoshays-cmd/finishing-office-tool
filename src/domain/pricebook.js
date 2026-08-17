import { ITEMS } from "./catalogue.js";
import { PHASES } from "../ui/tokens.js";
import {
  COST_KINDS, emptyAnalysis, isAnalysed, analysisTotal, normalizeAnalysis, addAnalysis,
} from "./costing.js";

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

/* ═══════════════════ تحليل سعر البند ═══════════════════
   التكلفة لم تعد رقمًا واحدًا مبهمًا، بل مفكّكة إلى فئاتها:
   خامات + عمالة + مقاول باطن + معدات + نثريات — لكل مستوى تشطيب.

   البنية: book.analysis[itemId][levelIdx] = { materials, labour, ... }
   والتوافق مع القديم كامل: البند المحلَّل تكلفته = مجموع فئاته،
   والبند غير المحلَّل يظل يقرأ رقمه المسطّح من cost[] كما كان. */

export function itemAnalysis(book, id, levelIdx) {
  const a = book?.analysis?.[id]?.[levelIdx];
  return isAnalysed(a) ? normalizeAnalysis(a) : null;
}

export function setItemAnalysis(book, id, levelIdx, patch) {
  const analysis = { ...(book.analysis || {}) };
  const perItem = { ...(analysis[id] || {}) };
  const current = normalizeAnalysis(perItem[levelIdx]);
  const next = normalizeAnalysis({ ...current, ...patch });
  perItem[levelIdx] = next;
  analysis[id] = perItem;

  /* التكلفة المسطّحة تُحدَّث من التحليل حتى لا يفترق الرقمان:
     مصدر واحد للحقيقة يمنع أن يعرض النظام هامشين مختلفين لنفس البند. */
  const items = { ...(book.items || {}) };
  const rec = { ...(items[id] || {}) };
  const cost = [...(rec.cost || [0, 0, 0, 0])];
  cost[levelIdx] = analysisTotal(next);
  rec.cost = cost;
  rec.updatedAt = new Date().toISOString().slice(0, 10);
  items[id] = rec;

  return { ...book, analysis, items };
}

export function clearItemAnalysis(book, id, levelIdx) {
  const analysis = { ...(book.analysis || {}) };
  if (!analysis[id]) return book;
  const perItem = { ...analysis[id] };
  delete perItem[levelIdx];
  if (Object.keys(perItem).length === 0) delete analysis[id];
  else analysis[id] = perItem;
  return { ...book, analysis };
}

/* التكلفة عند مستوى: رقم حقيقي أو null. لا تقدير.
   التحليل — إن وُجد — يتقدّم على الرقم المسطّح لأنه أدقّ وأحدث. */
export function costAt(book, item, levelIdx) {
  const id = item[5];
  const analysed = itemAnalysis(book, id, levelIdx);
  if (analysed) return analysisTotal(analysed);
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

/* ═══════════════════ تجميع التحليل: بالبند ثم بالمرحلة ═══════════════════
   المستويان معًا كما طلبهما المكتب: الدقة عند البند، والنظرة السريعة
   عند المرحلة. الأرقام واحدة — الثانية مجموع الأولى، لا حساب مستقل. */
export function costAnalysis(book, resolvedRows, itemsById) {
  const byPhase = {};
  const byKind = emptyAnalysis();
  const lines = [];
  let analysedValue = 0, unanalysedValue = 0;
  const unanalysed = [];

  for (const p of PHASES) {
    byPhase[p] = { phase: p, total: 0, analysed: 0, unanalysed: 0, kinds: emptyAnalysis(), items: [] };
  }

  for (const r of resolvedRows) {
    if (!r.included) continue;
    const item = itemsById[r.id];
    if (!item) continue;
    const bucket = byPhase[r.phase] || byPhase[PHASES[3]];
    const lineRevenue = r.qty * (Number(r.price) || 0);

    const unit = itemAnalysis(book, r.id, r.levelIdx);
    if (!unit) {
      /* بند بلا تحليل: يُعلَن ولا يُقدَّر. تقدير نسبة خامات/عمالة له
         يعطي تقريرًا يبدو مكتملًا وهو مخترع — وقرار الشراء سيُبنى عليه. */
      unanalysedValue += lineRevenue;
      bucket.unanalysed += lineRevenue;
      bucket.total += lineRevenue;
      unanalysed.push({ id: r.id, name: r.name, phase: r.phase, revenue: lineRevenue });
      continue;
    }

    const lineKinds = emptyAnalysis();
    addAnalysis(lineKinds, unit, r.qty);          // تحليل الوحدة × الكمية
    const lineCost = analysisTotal(lineKinds);

    addAnalysis(byKind, lineKinds, 1);
    addAnalysis(bucket.kinds, lineKinds, 1);
    bucket.analysed += lineCost;
    bucket.total += lineCost;
    analysedValue += lineRevenue;

    const line = {
      id: r.id, name: r.name, phase: r.phase, unit: r.unit, qty: r.qty,
      level: r.level, levelIdx: r.levelIdx,
      unitAnalysis: unit, unitCost: analysisTotal(unit),
      kinds: lineKinds, cost: lineCost,
      revenue: lineRevenue,
      profit: lineRevenue - lineCost,
      ratio: lineRevenue > 0 ? (lineRevenue - lineCost) / lineRevenue : null,
    };
    lines.push(line);
    bucket.items.push(line);
  }

  const totalCost = analysisTotal(byKind);
  return {
    lines,
    phases: PHASES.map(p => byPhase[p]),
    byKind,
    totalCost,
    analysedValue,
    unanalysedValue,
    coverage: (analysedValue + unanalysedValue) > 0
      ? analysedValue / (analysedValue + unanalysedValue) : 0,
    complete: unanalysed.length === 0 && lines.length > 0,
    unanalysed: unanalysed.sort((a, b) => b.revenue - a.revenue),
  };
}

/* البنود التي يأكل فيها بند واحد نصيبًا خطيرًا من فئة بعينها —
   مثلًا ٧٠٪ من عمالة المشروع كلها في بند واحد. */
export function kindConcentration(analysis, threshold = 0.5) {
  const out = [];
  for (const k of COST_KINDS) {
    const total = analysis.byKind[k] || 0;
    if (total <= 0) continue;
    for (const l of analysis.lines) {
      const v = l.kinds[k] || 0;
      if (v / total >= threshold) out.push({ kind: k, id: l.id, name: l.name, share: v / total, value: v });
    }
  }
  return out.sort((a, b) => b.share - a.share);
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
