import { ITEMS, SPECS, DEFAULT_SETTINGS, phaseOf } from "./catalogue.js";
import { LEVELS, SCOPES, STAGES, PHASES } from "../ui/tokens.js";
import { derivedSellPrice } from "./resources.js";

/* النطاقات التي تحمل أتعاب الإشراف والاحتياطي. التصميم والفرش خارجها:
   الأول أتعاب أصلًا، والثاني توريد لا إشراف عليه. */
export const EXEC_SCOPES = [
  "تعديلات معمارية (هدم وبناء)",
  "التشطيبات المعمارية والتنفيذ",
  "الكهرباء",
  "السباكة والتكييف",
];


export function newClient() {
  const id = "c" + Date.now() + Math.floor(Math.random() * 1000);
  return {
    id,
    name: "",
    phone: "",
    address: "",
    area: 150,
    stage: "عميل محتمل",
    style: "",
    notes: "",
    createdAt: new Date().toISOString().slice(0, 10),
    folderLink: "",
    engineer: "",        // للعرض فقط — المرجع الحقيقي engineerId
    engineerId: "",      // معرّف ثابت: تغيير اسم المهندس لا يُفقده عملاءه
    progressPercent: 0,  // مشتق من الزيارات، لا يُكتب يدويًا (انظر progressFromVisits)
    lastVisitAt: "",
    contract: null,      // لقطة مجمّدة تُنشأ عند "تم التعاقد"
    scopeLevel: Object.fromEntries(SCOPES.map(s => [s, "متوسط"])),
    scopeIncluded: Object.fromEntries(SCOPES.map(s => [s, s !== "الفرش والأثاث"])),
    // سجل واحد لكل بند مفهرس بمعرّف ثابت بدل خمس خرائط متوازية بالاسم:
    // { "FIN-014": { level, included, qty, price, priceDate } }
    items: {},
  };
}

/* Resolve one catalogue item's effective state for a given client — this is the single
   source of truth used everywhere (live totals, the editable BOQ table, and every export)
   so per-item overrides always stay consistent across the whole app. */
/* ============================= هجرة البيانات القديمة =============================
   النسخة القديمة كانت تحفظ خمس خرائط متوازية مفهرسة باسم البند العربي:
   itemLevel / itemIncluded / itemQty / itemPrice / itemPriceDate.
   أي تعديل على نص الاسم في الكتالوج كان يُفقد التجاوزات بصمت.

   الآن سجل واحد لكل بند مفهرس بمعرّف ثابت (FIN-014 مثلًا).
   الهجرة تحدث مرة واحدة عند أول قراءة، ولا تمسح الحقول القديمة —
   تبقى كما هي حتى نتأكد من سلامة التحويل. */

const NAME_TO_ID = Object.fromEntries(ITEMS.map(it => [it[1], it[5]]));

/*  الافتراضات التي لا يعمل الحساب بدونها.

    درس من عطل حقيقي: سجلّ مشروع بلا scopeLevel/scopeIncluded كان
    يُسقط بوابة العميل كاملةً برسالة «Cannot read ... تصميم».
    ومن أين يأتي سجلّ ناقص؟ من نسخة احتياطية قديمة، أو استيراد،
    أو سجلّ كُتب بإصدار سابق. الحساب يفترض وجودهما، فإن غابا انهار.

    الحلّ هنا لا هناك: من يقرأ السجلّ يضمن اكتماله مرة واحدة،
    بدل أن يتحصّن كل حاسب على حدة — ولن يتحصّن كلّهم.  */
function withScopeDefaults(c) {
  if (!c) return c;
  const needLevel    = !c.scopeLevel    || typeof c.scopeLevel    !== "object";
  const needIncluded = !c.scopeIncluded || typeof c.scopeIncluded !== "object";
  if (!needLevel && !needIncluded) return c;
  return {
    ...c,
    scopeLevel:    needLevel    ? Object.fromEntries(SCOPES.map(s => [s, "متوسط"])) : c.scopeLevel,
    scopeIncluded: needIncluded ? Object.fromEntries(SCOPES.map(s => [s, s !== "الفرش والأثاث"])) : c.scopeIncluded,
  };
}

export function migrateClient(client) {
  if (!client || client.items) return withScopeDefaults(client);   // مهاجَر بالفعل
  const items = {};
  const put = (name, key, value) => {
    const id = NAME_TO_ID[name];
    if (!id) return;                            // بند حُذف من الكتالوج
    (items[id] ||= {})[key] = value;
  };
  for (const [n, v] of Object.entries(client.itemLevel     || {})) put(n, "level", v);
  for (const [n, v] of Object.entries(client.itemIncluded  || {})) put(n, "included", v);
  for (const [n, v] of Object.entries(client.itemQty       || {})) put(n, "qty", v);
  for (const [n, v] of Object.entries(client.itemPrice     || {})) put(n, "price", v);
  for (const [n, v] of Object.entries(client.itemPriceDate || {})) put(n, "priceDate", v);
  return withScopeDefaults({ ...client, items });
}

const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k)
  && o[k] !== "" && o[k] !== null && o[k] !== undefined;

/* ctx اختياري: { lib, book } — حين يُمرَّر ويكون الاشتقاق مُشغَّلًا،
   يأتي سعر الوحدة من موارد المكتب لا من رقم الكتالوج الثابت.
   بدونه يعمل النظام كما كان تمامًا — لا شيء ينكسر. */
export function resolveItem(client, item, area, ctx = null) {
  const [scope, name, unit, qtyFn, prices, id] = item;
  const rec = (client.items || {})[id] || {};

  const included = has(rec, "included") ? rec.included : client.scopeIncluded[scope];
  const level = rec.level || client.scopeLevel[scope] || "متوسط";
  const levelIdx = LEVELS.indexOf(level);

  const hasQtyOverride = has(rec, "qty");
  const qty = hasQtyOverride ? Number(rec.qty) : qtyFn(area);

  let basePrice = prices[levelIdx];
  let priceSource = "catalogue";
  if (ctx?.lib && ctx?.book) {
    const d = derivedSellPrice(ctx.lib, ctx.book, item, levelIdx);
    if (d.source === "derived") { basePrice = d.price; priceSource = "derived"; }
  }
  const hasPriceOverride = has(rec, "price");
  const price = hasPriceOverride ? Number(rec.price) : basePrice;

  // أي طبقة تجاوز فعّالة؟ تُعرض للمستخدم حتى لا يحتار لماذا لم يتغير البند
  const overrides = [];
  if (rec.level) overrides.push("مستوى");
  if (has(rec, "included")) overrides.push("تضمين");
  if (hasQtyOverride) overrides.push("كمية");
  if (hasPriceOverride) overrides.push("سعر");

  return {
    id, scope, name, unit, included, level, levelIdx, qty, price, basePrice, priceSource,
    phase: phaseOf(id, scope),
    total: included ? qty * price : 0,
    hasQtyOverride, hasPriceOverride, isCustomLevel: !!rec.level,
    priceDate: rec.priceDate || "",
    overrides,
    scopeLevel: client.scopeLevel[scope],
  };
}


export function calcClient(client, settings, ctx = null) {
  const area = Number(client.area) || 0;
  const byScope = {};
  SCOPES.forEach(s => (byScope[s] = 0));
  ITEMS.forEach((item) => {
    const r = resolveItem(client, item, area, ctx);
    byScope[r.scope] += r.total;
  });
  const execTotal = EXEC_SCOPES.reduce((sum, s) => sum + byScope[s], 0);
  const supervision = execTotal * settings.supervisionPct;
  const contingency = (execTotal + supervision) * settings.contingencyPct;
  const execWithExtras = execTotal + supervision + contingency;
  const subtotal = execWithExtras + byScope["تصميم"] + byScope["الفرش والأثاث"];
  const vat = subtotal * settings.vatPct;
  const grandTotal = subtotal + vat;
  return { byScope, execTotal, supervision, contingency, execWithExtras, subtotal, vat, grandTotal };
}

/* ═══════════════════ المقايسة موزّعة على المراحل الخمس ═══════════════════
   نفس أرقام calcClient بالضبط، لكن مقسّمة على مراحل التنفيذ بدل النطاقات.

   الإشراف والاحتياطي والضريبة لا تُقسَّم بالتساوي ولا بالتناسب التقريبي —
   تُحسب لكل مرحلة من بنودها هي. وبما أن الثلاثة دوال خطّية في قيمة بنود
   التنفيذ، فمجموع المراحل يساوي الإجمالي العام بالجنيه لا بالتقريب.
   (اختبار في test/business.mjs يثبت هذه المساواة ولا يسمح بانحرافها.) */
export function calcByPhase(client, settings, items = ITEMS, ctx = null) {
  const area = Number(client.area) || 0;
  const rows = items.map(it => resolveItem(client, it, area, ctx));

  const phases = PHASES.map(phase => {
    const lines = rows.filter(r => r.phase === phase);
    const included = lines.filter(r => r.included);
    const base = included.reduce((s, r) => s + r.total, 0);
    const execPortion = included
      .filter(r => EXEC_SCOPES.includes(r.scope))
      .reduce((s, r) => s + r.total, 0);
    const supervision = execPortion * settings.supervisionPct;
    const contingency = (execPortion + supervision) * settings.contingencyPct;
    const net = base + supervision + contingency;      // قبل الضريبة
    const vat = net * settings.vatPct;
    return {
      phase, lines, base, execPortion, supervision, contingency, net, vat,
      quote: net + vat,                                 // ما يُقدَّم للعميل عن هذه المرحلة
      itemCount: included.length,
      empty: included.length === 0,
    };
  });

  return {
    phases,
    grandTotal: phases.reduce((s, p) => s + p.quote, 0),
    net: phases.reduce((s, p) => s + p.net, 0),
    vat: phases.reduce((s, p) => s + p.vat, 0),
  };
}

/* ============================= تجميد المقايسة عند التعاقد =============================
   قبل هذا، العقد كان يُولَّد لحظيًا من البيانات الحالية. يعني أن تعديل سعر
   السوق بعد التوقيع كان يغيّر أرقام عقد موقّع بأثر رجعي — وهو خلل تجاري خطير.

   الآن: عند الوصول إلى "تم التعاقد" تُلتقط لقطة كاملة (بنود + كميات + أسعار
   + نسب الضريبة والإشراف السارية وقتها). العقد يُطبع من اللقطة لا من الحي.
   أي تعديل لاحق ينشئ ملحقًا برقم إصدار جديد ولا يمس الأصل. */

export function buildContractSnapshot(client, settings, actorName = "", ctx = null) {
  const area = Number(client.area) || 0;
  const lines = ITEMS.map(it => resolveItem(client, it, area, ctx))
    .filter(r => r.included)
    .map(r => ({
      id: r.id, name: r.name, scope: r.scope, unit: r.unit,
      level: r.level, qty: r.qty, price: r.price, total: r.total,
    }));
  return {
    version: 1,
    signedAt: new Date().toISOString().slice(0, 10),
    signedBy: actorName,
    area,
    settings: { ...settings },      // نسخة، لا مرجع — تعديل الإعدادات لاحقًا لا يمسها
    lines,
    totals: calcClient(client, settings, ctx),
  };
}

export function amendContract(prev, client, settings, actorName = "", ctx = null) {
  const next = buildContractSnapshot(client, settings, actorName, ctx);
  next.version = (prev?.version || 1) + 1;
  next.amendedFrom = prev?.signedAt || null;
  return next;
}

/* الأرقام المعتمدة: من اللقطة إن وُجدت، وإلا من الحساب الحي.
   كل عرض للسعر بعد التعاقد يجب أن يمر من هنا. */
export function effectiveTotals(client, settings) {
  if (client.contract?.totals) {
    return { ...client.contract.totals, frozen: true, signedAt: client.contract.signedAt, version: client.contract.version };
  }
  return { ...calcClient(client, settings), frozen: false };
}

/* ============================= التقدّم مشتق لا مخزّن =============================
   قبل هذا كانت النسبة "سقّاطة": تُنسخ من الزيارة فقط إذا كانت أكبر من الحالية.
   فإدخال 90% بالخطأ ثم تصحيحه إلى 50% كان يُبقي 90 للأبد، وحذف الزيارة
   لم يكن يُرجع الرقم. الآن يُحسب دائمًا من أحدث زيارة فعلية. */

export function progressFromVisits(visits) {
  if (!visits || visits.length === 0) return { percent: 0, lastVisitAt: "" };
  const sorted = [...visits].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const latest = sorted[0];
  return { percent: Number(latest.percent) || 0, lastVisitAt: latest.date || "" };
}

/* ربط المهندس: الاسم للعرض، والمعرّف هو المرجع.
   البيانات القديمة تُربط مرة واحدة بمطابقة الاسم. */
export function linkEngineer(client, team) {
  if (client.engineerId || !client.engineer) return client;
  const match = (team || []).find(m => m.name === client.engineer);
  return match ? { ...client, engineerId: match.id } : client;
}

export function ownsClient(client, member) {
  if (!member) return false;
  if (client.engineerId) return client.engineerId === member.id;
  return client.engineer === member.name;   // احتياطي لبيانات لم تُربط بعد
}
