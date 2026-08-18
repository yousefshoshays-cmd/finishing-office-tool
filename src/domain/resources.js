/* ════════════════════════════════════════════════════════════════════════════
   مكتبة الموارد — مصدر السعر الواحد
   ----------------------------------------------------------------------------
   المشكلة التي يحلّها هذا الملف:

   سعر بند «المحارة» كان رقمًا ثابتًا مكتوبًا في الكتالوج: ١٢٠ ج.م للمتر.
   حين يرتفع سعر الأسمنت أو يومية المعلّم، على المكتب أن يفتح كل بند يستخدمهما
   ويعدّله يدويًا — وأن يتذكّر أيّها يستخدم ماذا. النتيجة الحتمية بعد شهرين:
   أسعار متأخرة عن السوق، وربح يتآكل بصمت ولا يظهر إلا في نهاية المشروع.

   النموذج هنا يقلب الاتجاه:

       سعر المورد ← وصفة البند ← تكلفة الوحدة ← سعر البيع ← المقايسة

   تُدخل الوصفة مرة واحدة («متر المحارة = ٠٫١٢ شيكارة أسمنت + ٠٫٠٣ م³ رمل
   + ٠٫٠٦ يومية معلّم»)، ثم لا تلمس البند إطلاقًا. تحدّث سعر المورد وحده،
   فيتحرّك كل بند يستخدمه، وكل مستوى تشطيب، وكل مقايسة مفتوحة.

   ثلاث قواعد لا تُكسَر:
     ١) العقد الموقّع مجمّد — تحديث الأسعار لا يمسّه أبدًا.
     ٢) لا يُخترع سعر. المورد بلا سعر يبقى صفرًا معلنًا، والبند الذي يعتمد
        عليه يُعلَّم «تحليل ناقص» بدل أن يُعطي رقمًا يبدو صحيحًا وهو مخترع.
     ٣) كل تغيير سعر يُسجَّل بتاريخه — حركة السوق تُقاس لا تُتذكَّر.
   ══════════════════════════════════════════════════════════════════════════ */

import { COST_KINDS, emptyAnalysis } from "./costing.js";

/* ---------------------------------------------------------------------------
   بنية المورد
   { id, name, unit, kind, price, priceDate, supplier, note, needsReview, history[] }
   --------------------------------------------------------------------------- */

export const DEFAULT_RESOURCES = { items: {}, seededAt: "", markup: 0.25 };

export function newResource(seq, kind = "materials") {
  const prefix = { materials: "MAT", labour: "LAB", equipment: "EQP", subcontract: "SUB", other: "OTH" }[kind] || "RES";
  return {
    id: `${prefix}-${String(seq).padStart(3, "0")}`,
    name: "", unit: "", kind,
    price: 0,
    priceDate: new Date().toISOString().slice(0, 10),
    supplier: "", note: "",
    needsReview: false,
    history: [],
  };
}

export const resourceList = (lib) => Object.values(lib?.items || {});

export function resourcesByKind(lib, kind) {
  return resourceList(lib).filter(r => r.kind === kind);
}

export function getResource(lib, id) {
  return (lib?.items || {})[id] || null;
}

/* ---------------------------------------------------------------------------
   تحديث سعر مورد — مع تسجيل الحركة
   --------------------------------------------------------------------------- */
export function setResourcePrice(lib, id, price, today = new Date().toISOString().slice(0, 10)) {
  const cur = getResource(lib, id);
  if (!cur) return lib;
  const next = Number(price) || 0;
  if (Math.abs(next - (Number(cur.price) || 0)) < 1e-9) return lib;

  const history = [...(cur.history || [])];
  /* نسجّل السعر السابق بتاريخه — فيصير عندنا منحنى حقيقي لحركة السوق */
  history.push({ date: cur.priceDate || today, price: Number(cur.price) || 0 });
  if (history.length > 60) history.splice(0, history.length - 60);

  return {
    ...lib,
    items: {
      ...lib.items,
      [id]: { ...cur, price: next, priceDate: today, needsReview: false, history },
    },
  };
}

export function upsertResource(lib, resource) {
  return { ...lib, items: { ...(lib.items || {}), [resource.id]: resource } };
}

export function removeResource(lib, id) {
  const items = { ...(lib.items || {}) };
  delete items[id];
  return { ...lib, items };
}

/* ---------------------------------------------------------------------------
   تعديل جماعي بنسبة — «ارفع كل الخامات ٨٪»
   يعيد المكتبة الجديدة مع تقرير بما تغيّر فعلًا، لا بعدد ما حاولنا تغييره.
   --------------------------------------------------------------------------- */
export function bulkAdjust(lib, { kind = null, ids = null, pct = 0 }, today = new Date().toISOString().slice(0, 10)) {
  const factor = 1 + (Number(pct) || 0);
  let next = lib;
  const changed = [];
  for (const r of resourceList(lib)) {
    if (kind && r.kind !== kind) continue;
    if (ids && !ids.includes(r.id)) continue;
    const before = Number(r.price) || 0;
    if (before <= 0) continue;            // لا نضاعف صفرًا فيبقى صفرًا بلا معنى
    const after = Math.round(before * factor * 100) / 100;
    if (Math.abs(after - before) < 1e-9) continue;
    next = setResourcePrice(next, r.id, after, today);
    changed.push({ id: r.id, name: r.name, before, after, diff: after - before });
  }
  return { lib: next, changed, count: changed.length };
}

/* ---------------------------------------------------------------------------
   الوصفة: كم من كل مورد يلزم لوحدة واحدة من البند، عند مستوى تشطيب معيّن

   book.recipes[itemId][levelIdx] = [ { resourceId, qty }, ... ]
   --------------------------------------------------------------------------- */

export function getRecipe(book, itemId, levelIdx) {
  const r = book?.recipes?.[itemId]?.[levelIdx];
  return Array.isArray(r) && r.length ? r : null;
}

export function setRecipe(book, itemId, levelIdx, lines) {
  const recipes = { ...(book.recipes || {}) };
  const perItem = { ...(recipes[itemId] || {}) };
  const clean = (lines || [])
    .filter(l => l && l.resourceId && Number(l.qty) > 0)
    .map(l => ({ resourceId: l.resourceId, qty: Number(l.qty), note: l.note || "" }));
  if (clean.length) perItem[levelIdx] = clean;
  else delete perItem[levelIdx];
  if (Object.keys(perItem).length) recipes[itemId] = perItem;
  else delete recipes[itemId];
  return { ...book, recipes };
}

/* نسخ وصفة من مستوى إلى آخر بمعامل — يختصر أغلب عبء الإدخال.
   السوبر لوكس غالبًا نفس الوصفة بخامة أغلى: انسخها ثم بدّل موردًا واحدًا. */
export function copyRecipe(book, itemId, fromLevel, toLevel, factor = 1) {
  const src = getRecipe(book, itemId, fromLevel);
  if (!src) return book;
  const f = Number(factor) || 1;
  return setRecipe(book, itemId, toLevel, src.map(l => ({ ...l, qty: Math.round(l.qty * f * 10000) / 10000 })));
}

/* ---------------------------------------------------------------------------
   حساب تكلفة الوحدة من الوصفة

   يعيد دائمًا كائنًا يوضّح ما يعرفه وما لا يعرفه:
     total        التكلفة المحسوبة من الموارد المسعَّرة
     kinds        توزيعها على فئات التكلفة الخمس (يغذّي تحليل التكلفة القائم)
     missing[]    موارد بلا سعر — سبب كون الرقم ناقصًا، بالاسم
     complete     هل كل موارد الوصفة مسعَّرة؟
   --------------------------------------------------------------------------- */
export function recipeCost(lib, recipe) {
  const kinds = emptyAnalysis();
  const lines = [];
  const missing = [];
  let total = 0;

  for (const l of recipe || []) {
    const res = getResource(lib, l.resourceId);
    if (!res) { missing.push({ resourceId: l.resourceId, name: "مورد محذوف", qty: l.qty }); continue; }
    const price = Number(res.price) || 0;
    const qty = Number(l.qty) || 0;
    const cost = price * qty;
    const kind = COST_KINDS.includes(res.kind) ? res.kind : "other";

    if (price <= 0) missing.push({ resourceId: res.id, name: res.name, unit: res.unit, qty });
    kinds[kind] += cost;
    total += cost;
    lines.push({
      resourceId: res.id, name: res.name, unit: res.unit, kind,
      qty, price, cost, priced: price > 0, needsReview: !!res.needsReview,
    });
  }

  return {
    total, kinds, lines, missing,
    complete: missing.length === 0 && lines.length > 0,
    reviewPending: lines.some(l => l.needsReview),
  };
}

export function itemUnitCost(lib, book, itemId, levelIdx) {
  const recipe = getRecipe(book, itemId, levelIdx);
  if (!recipe) return null;
  return recipeCost(lib, recipe);
}

/* ---------------------------------------------------------------------------
   سعر البيع مشتقًّا من التكلفة

   الترتيب الحاكم (الأول يفوز):
     ١) تجاوز يدوي صريح للبند         — المكتب يعرف سوقه
     ٢) تكلفة الوصفة × (١ + الهامش)   — يتحرّك مع السوق تلقائيًا
     ٣) سعر الكتالوج الأصلي           — لبند لم تُدخَل له وصفة بعد
   --------------------------------------------------------------------------- */
export function markupFor(book, itemId, scope) {
  const perItem = book?.markupByItem?.[itemId];
  if (perItem !== undefined && perItem !== null && perItem !== "") return Number(perItem) || 0;
  const perScope = book?.markupByScope?.[scope];
  if (perScope !== undefined && perScope !== null && perScope !== "") return Number(perScope) || 0;
  const global = book?.markup;
  return (global === undefined || global === null || global === "") ? 0.25 : (Number(global) || 0);
}

export function derivedSellPrice(lib, book, item, levelIdx) {
  const [scope, , , , prices, id] = item;
  const catalogue = Number(prices?.[levelIdx]) || 0;

  const manual = book?.items?.[id]?.price?.[levelIdx];
  if (manual > 0) {
    return { price: Number(manual), source: "manual", cost: null, markup: null, catalogue };
  }

  /* الاشتقاق اختياري ومطفأ افتراضيًا — عن قصد.

     المكتبة الابتدائية أسعارها تقريبية، وتشغيل الاشتقاق تلقائيًا كان
     سيغيّر أسعار كل مقايسة مفتوحة في اللحظة التي يُحدَّث فيها الموقع،
     بلا أن يقرّر المكتب ذلك أو يراه. فالمكتب يراجع مكتبته أولًا، ويطالع
     تقرير الأثر (pricingImpact أدناه)، ثم يُشغّل الاشتقاق بنفسه. */
  if (book?.useDerivedPricing !== true) {
    return { price: catalogue, source: "catalogue", cost: null, markup: null, catalogue, available: !!getRecipe(book, id, levelIdx) };
  }

  const c = itemUnitCost(lib, book, id, levelIdx);
  if (c && c.total > 0) {
    const markup = markupFor(book, id, scope);
    return {
      price: Math.round(c.total * (1 + markup)),
      source: "derived",
      cost: c.total, markup, catalogue,
      complete: c.complete, missing: c.missing,
      drift: catalogue > 0 ? (Math.round(c.total * (1 + markup)) - catalogue) / catalogue : null,
    };
  }

  return { price: catalogue, source: "catalogue", cost: null, markup: null, catalogue };
}

/* ---------------------------------------------------------------------------
   صحّة المكتبة — ما يحتاج انتباه المكتب الآن
   --------------------------------------------------------------------------- */
export function libraryHealth(lib, staleDays = 90, today = new Date()) {
  const all = resourceList(lib);
  const cutoff = new Date(today.getTime() - staleDays * 86400000).toISOString().slice(0, 10);
  const unpriced = all.filter(r => !(Number(r.price) > 0));
  const needsReview = all.filter(r => r.needsReview);
  const stale = all.filter(r => Number(r.price) > 0 && !r.needsReview && (r.priceDate || "") < cutoff);
  return {
    total: all.length,
    unpriced, needsReview, stale,
    ready: all.length - unpriced.length - needsReview.length,
    byKind: Object.fromEntries(COST_KINDS.map(k => [k, all.filter(r => r.kind === k).length])),
    healthy: unpriced.length === 0 && needsReview.length === 0,
  };
}

/* ---------------------------------------------------------------------------
   حركة السوق: كم تغيّر سعر مورد منذ تاريخ معيّن
   --------------------------------------------------------------------------- */
export function priceMovement(resource, sinceDate) {
  const hist = [...(resource?.history || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const before = hist.filter(h => String(h.date) <= String(sinceDate)).pop();
  const base = before ? Number(before.price) : (hist[0] ? Number(hist[0].price) : null);
  const now = Number(resource?.price) || 0;
  if (base == null || base <= 0) return { changed: false, base: null, now, diff: null, pct: null };
  return { changed: Math.abs(now - base) > 1e-9, base, now, diff: now - base, pct: (now - base) / base };
}

export function marketMovementReport(lib, sinceDate) {
  const rows = resourceList(lib)
    .map(r => ({ ...priceMovement(r, sinceDate), id: r.id, name: r.name, unit: r.unit, kind: r.kind }))
    .filter(r => r.changed)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return {
    rows,
    risen: rows.filter(r => r.diff > 0),
    fallen: rows.filter(r => r.diff < 0),
  };
}

/* ---------------------------------------------------------------------------
   تقرير الأثر — ماذا سيتغيّر لو شغّلت الاشتقاق (أو حدّثت الأسعار)؟

   يُعرض قبل القرار لا بعده. المكتب يرى بالجنيه ما سيصير عليه كل بند،
   فيقرّر عن علم بدل أن يفاجأ بمقايسة تغيّرت وحدها.
   --------------------------------------------------------------------------- */
export function pricingImpact(lib, book, items, levels = [0, 1, 2, 3]) {
  const rows = [];
  for (const item of items) {
    const [scope, name, unit, , prices, id] = item;
    for (const lv of levels) {
      const recipe = getRecipe(book, id, lv);
      if (!recipe) continue;
      const c = recipeCost(lib, recipe);
      if (!(c.total > 0)) continue;
      const markup = markupFor(book, id, scope);
      const next = Math.round(c.total * (1 + markup));
      const now = Number(book?.items?.[id]?.price?.[lv]) > 0
        ? Number(book.items[id].price[lv])
        : (Number(prices?.[lv]) || 0);
      if (now <= 0) continue;
      rows.push({
        id, name, unit, scope, levelIdx: lv,
        now, next, diff: next - now, pct: (next - now) / now,
        cost: c.total, markup,
        complete: c.complete, missing: c.missing,
      });
    }
  }
  rows.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const up = rows.filter(r => r.diff > 0);
  const down = rows.filter(r => r.diff < 0);
  return {
    rows, up, down,
    covered: new Set(rows.map(r => r.id)).size,
    incomplete: rows.filter(r => !r.complete),
    biggest: rows[0] || null,
  };
}

/* أثر التغيير على مقايسة عميل بعينها — بالجنيه لا بالنسبة */
export function quoteImpact(lib, book, resolvedRows, itemsById) {
  let before = 0, after = 0;
  const changed = [];
  for (const r of resolvedRows) {
    if (!r.included) continue;
    const item = itemsById[r.id];
    if (!item) continue;
    const recipe = getRecipe(book, r.id, r.levelIdx);
    const lineBefore = r.qty * (Number(r.price) || 0);
    before += lineBefore;
    if (!recipe) { after += lineBefore; continue; }
    const c = recipeCost(lib, recipe);
    if (!(c.total > 0)) { after += lineBefore; continue; }
    const nextUnit = Math.round(c.total * (1 + markupFor(book, r.id, r.scope)));
    const lineAfter = r.qty * nextUnit;
    after += lineAfter;
    if (Math.abs(lineAfter - lineBefore) > 0.5) {
      changed.push({ id: r.id, name: r.name, before: lineBefore, after: lineAfter, diff: lineAfter - lineBefore });
    }
  }
  return {
    before, after, diff: after - before,
    pct: before > 0 ? (after - before) / before : 0,
    changed: changed.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
  };
}
