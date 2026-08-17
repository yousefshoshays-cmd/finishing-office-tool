import {
  newClient, resolveItem, calcClient, calcByPhase, migrateClient, progressFromVisits,
  ownsClient, buildContractSnapshot, amendContract, effectiveTotals,
} from "../src/domain/pricing.js";
import { ITEMS, DEFAULT_SETTINGS, fmt, phaseOf, ITEM_PHASE } from "../src/domain/catalogue.js";
import { PHASES } from "../src/ui/tokens.js";
import { can, roleLabel } from "../src/domain/permissions.js";
import * as pb from "../src/domain/pricebook.js";
import * as fin from "../src/domain/finance.js";
import * as rm from "../src/domain/rooms.js";
import * as tpl from "../src/domain/templates.js";
import * as sg from "../src/domain/suggest.js";
import * as imp from "../src/domain/importSchedule.js";
import * as led from "../src/export/ledger.js";
import * as ct from "../src/domain/costing.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log((cond ? "✅" : "❌") + " " + msg); };

/* البنود تُشار إليها بمعرّفها لا بموضعها: إدراج بند جديد في الكتالوج
   لا يجوز أن يكسر اختبارًا سليمًا. */
const ITEM = ITEMS.find(it => it[5] === "FIN-001");   // [scope, name, unit, qtyFn, prices, id]
const ID = ITEM[5], NAME = ITEM[1];

console.log("── ٣. معرّف ثابت لكل بند ──");
ok(ITEMS.every(i => /^[A-Z]{3}-\d{3}$/.test(i[5])), "كل البنود لها معرّف بصيغة موحّدة");
ok(new Set(ITEMS.map(i => i[5])).size === ITEMS.length, "لا تكرار في المعرّفات");

console.log("\n── ٤. هجرة الخرائط الخمس إلى سجل واحد ──");
const legacy = { ...newClient(), area: 150,
  itemPrice: { [NAME]: 1100 }, itemPriceDate: { [NAME]: "2026-08-01" }, itemLevel: { [NAME]: "لوكس" } };
delete legacy.items;
const m = migrateClient(legacy);
ok(m.items[ID]?.price === 1100, "السعر انتقل للمعرّف الصحيح");
ok(m.items[ID]?.level === "لوكس", "المستوى انتقل");
ok(m.itemPrice !== undefined, "الحقول القديمة لم تُمسح (هجرة غير مُدمّرة)");
ok(resolveItem(m, ITEM, 150).price === 1100, "التسعير يقرأ من السجل الجديد");
ok(migrateClient(m) === m, "الهجرة لا تتكرر");

console.log("\n── ٣ب. مناعة ضد تغيير اسم البند ──");
const renamed = [...ITEM]; renamed[1] = "أرضيات بورسلين (اسم معدّل)";
ok(resolveItem(m, renamed, 150).price === 1100, "التجاوز صمد رغم تغيّر الاسم");

console.log("\n── ٥. إظهار طبقة التجاوز ──");
const r = resolveItem(m, ITEM, 150);
ok(r.overrides.includes("سعر") && r.overrides.includes("مستوى"), "الطبقات الفعّالة معلنة: " + r.overrides.join("+"));
ok(r.scopeLevel === "متوسط", "إعداد الفئة معروض للمقارنة");

console.log("\n── ٦. التقدّم مشتق لا سقّاطة ──");
const visits = [
  { date: "2026-07-01", percent: 30, createdAt: "2026-07-01T09:00:00Z" },
  { date: "2026-07-20", percent: 90, createdAt: "2026-07-20T09:00:00Z" },
];
ok(progressFromVisits(visits).percent === 90, "يأخذ أحدث زيارة");
visits[1].percent = 50;
ok(progressFromVisits(visits).percent === 50, "التصحيح للأسفل ينعكس (كان يعلق على 90)");
ok(progressFromVisits([visits[0]]).percent === 30, "حذف الزيارة يُرجع الرقم");
ok(progressFromVisits([]).percent === 0, "بلا زيارات = صفر");

console.log("\n── ٢. ربط المهندس بالمعرّف ──");
const eng = { id: "u-1", name: "محمد أحمد", role: "engineer" };
const c1 = { engineerId: "u-1", engineer: "محمد أحمد" };
ok(ownsClient(c1, eng), "يرى عميله");
ok(ownsClient({ ...c1, engineer: "م. محمد أحمد" }, eng), "تغيير الاسم لا يُفقده العميل");
ok(!ownsClient({ engineerId: "u-2", engineer: "محمد أحمد" }, eng), "اسم مطابق + معرّف مختلف = ممنوع");

console.log("\n── ١ و ٧. تجميد العقد والإعدادات ──");
const c = { ...newClient(), area: 150 };
const live = calcClient(c, DEFAULT_SETTINGS);
const snap = buildContractSnapshot(c, DEFAULT_SETTINGS, "يوسف");
const signed = { ...c, stage: "تم التعاقد", contract: snap };
ok(Math.round(snap.totals.grandTotal) === Math.round(live.grandTotal), "اللقطة تطابق الحساب وقت التوقيع");

signed.items = { [ID]: { price: 99999 } };               // تغيّر سعر السوق بعد التوقيع
const after = effectiveTotals(signed, DEFAULT_SETTINGS);
ok(Math.round(after.grandTotal) === Math.round(live.grandTotal), "رقم العقد لم يتغيّر رغم تعديل السعر");
ok(after.frozen === true, "معلَّم كمجمّد");

const hiVat = { ...DEFAULT_SETTINGS, vatPct: 0.25 };     // تغيّرت الضريبة العامة
ok(Math.round(effectiveTotals(signed, hiVat).grandTotal) === Math.round(live.grandTotal),
   "تغيير الضريبة العامة لا يمس عقدًا موقّعًا");
ok(effectiveTotals(c, hiVat).grandTotal > live.grandTotal, "لكن العميل غير المتعاقد يتأثر طبعًا");

const am = amendContract(snap, signed, DEFAULT_SETTINGS, "يوسف");
ok(am.version === 2 && am.totals.grandTotal > live.grandTotal, "الملحق إصدار 2 بأرقام محدّثة");
ok(snap.version === 1, "الأصل لم يُمس");

console.log("\n── الصلاحيات ──");
for (const rl of ["engineer","manager","owner"])
  console.log(`   ${roleLabel(rl).padEnd(12)} سعر:${can({role:rl},"editUnitPrice")?"✅":"❌"} كل العملاء:${can({role:rl},"viewAllClients")?"✅":"❌"} مسح:${can({role:rl},"deleteClient")?"✅":"❌"}`);
ok(!can(null,"editUnitPrice") && !can({role:"admin"},"deleteClient"), "دور ملفّق أو غائب مرفوض");


console.log("\n── دفتر الأسعار: الهامش ──");
{
  const byId = Object.fromEntries(ITEMS.map(i => [i[5], i]));
  const c2 = { ...newClient(), area: 100 };
  const rows = ITEMS.map(i => resolveItem(c2, i, 100));

  let book = { ...pb.DEFAULT_PRICEBOOK };
  const m0 = pb.projectMargin(book, rows, byId);
  ok(m0.ratio === null, "بلا تكاليف: الهامش غير معروف — لا رقم مخترع");
  ok(m0.coverage === 0 && m0.unknownItems.length > 0, `التغطية 0% و${m0.unknownItems.length} بندًا ينقصه تكلفة`);
  ok(m0.profit === null, "الربح غير معروف أيضًا");

  // ندخل تكلفة بند واحد فقط
  const id = ITEM[5];
  book = pb.updateBookItem(book, id, { cost: [200, 300, 500, 800] });
  const m1 = pb.projectMargin(book, rows, byId);
  ok(m1.ratio !== null && m1.coverage > 0 && m1.coverage < 1,
     `تكلفة بند واحد ← تغطية ${(m1.coverage*100).toFixed(1)}% والهامش يخص المغطّى فقط`);
  ok(!m1.complete, "معلَّم كغير مكتمل");

  const mi = pb.itemMargin(book, ITEM, 1, 550);
  ok(mi.known && mi.cost === 300 && Math.abs(mi.ratio - (250/550)) < 1e-9,
     `هامش البند: 550 - 300 = 250 (${(mi.ratio*100).toFixed(1)}%)`);
  ok(pb.marginHealth(mi.ratio) === "ok", "هامش صحي");
  ok(pb.marginHealth(0.05) === "thin" && pb.marginHealth(-0.1) === "loss" && pb.marginHealth(null) === "unknown",
     "تصنيف الهامش: ضعيف/خسارة/غير معروف");

  ok(pb.staleItems(book).length === ITEMS.length - 1, "البنود غير المحدّثة مرصودة");

  let b2 = { ...pb.DEFAULT_PRICEBOOK, custom: [{ ...pb.newCustomItem(pb.DEFAULT_PRICEBOOK), name: "حوض رخام مصنّع", unit: "عدد", qtyPerArea: 0.02, price: [0,4000,0,0], cost: [0,2600,0,0] }] };
  const withCustom = pb.catalogueWithCustom(b2);
  ok(withCustom.length === ITEMS.length + 1, "بند مخصص أُضيف للكتالوج");
  const cm = pb.itemMargin(b2, withCustom[withCustom.length-1], 1, 4000);
  ok(cm.known && Math.abs(cm.ratio - 0.35) < 1e-9, "هامش البند المخصص 35%");
}


console.log("\n── ٢. أوامر التغيير والتحصيل (finance) ──");
{
  const c3 = { ...newClient(), area: 150, stage: "تم التعاقد" };
  c3.contract = buildContractSnapshot(c3, DEFAULT_SETTINGS, "يوسف");
  const base = c3.contract.totals.grandTotal;

  const v = { ...fin.newVariation(c3.id, 1), status: "approved",
    lines: [{ name: "رخام بدل بورسلين", qty: 40, price: 1200 }] };
  ok(Math.abs(fin.variationTotal(v) - 48000) < 1, `أمر تغيير = ${fmt(fin.variationTotal(v))}`);

  c3.variations = [v];
  const cv = fin.contractValue(c3);
  ok(Math.abs(cv.total - (base + 48000)) < 1, `قيمة العقد = ${fmt(base)} + ${fmt(48000)} = ${fmt(cv.total)}`);

  const pending = { ...fin.newVariation(c3.id, 2), status: "sent",
    lines: [{ name: "إضافة مقترحة", qty: 1, price: 99999 }] };
  c3.variations = [v, pending];
  const cv2 = fin.contractValue(c3);
  ok(Math.abs(cv2.total - (base + 48000)) < 1, "المعلّق لا يدخل قيمة العقد");
  ok(cv2.pendingCount === 1 && Math.abs(cv2.pendingValue - 99999) < 1, "لكنه معروض كمعلّق للمتابعة");

  c3.receipts = [{ ...fin.newReceipt(c3.id, 1), amount: 100000, date: "2026-07-01" }];
  const plan = fin.paymentPlan(c3);
  ok(Math.abs(plan.collected - 100000) < 1, `المحصّل ${fmt(plan.collected)}`);
  ok(Math.abs(plan.outstanding - (cv2.total - 100000)) < 1, `المتبقي ${fmt(plan.outstanding)}`);

  const rows3 = ITEMS.map(i => resolveItem(c3, i, 150));
  c3.expenses = [{ ...fin.newExpense(c3.id, 1), amount: 50000, itemId: ITEM[5] }];
  const bv = fin.budgetVariance(c3, rows3);
  ok(bv !== null && typeof bv === "object", "انحراف الميزانية يُحسب (فعلي مقابل مخطط)");
  const cash = fin.projectCashPosition(c3, rows3);
  ok(cash !== null && typeof cash === "object", "الموقف النقدي يُحسب");
}

console.log("\n── ٤. جدول الغرف (rooms) ──");
{
  const rooms = [
    { ...rm.newRoom(1), name: "صالة", type: "صالة", length: 6, width: 5 },
    { ...rm.newRoom(2), name: "حمام", type: "حمام", length: 2, width: 2 },
  ];
  const q = rm.deriveQuantities(rooms);
  ok(Math.abs(q.floorArea - 34) < 0.01, `مساحة الأرضيات ${q.floorArea} م² (30 + 4)`);
  ok(q.bathrooms === 1, "عدد الحمامات مرصود");
  ok(Math.abs(q.dryPerimeter - 22) < 0.01, `سكيرتنج للجاف فقط: ${q.dryPerimeter} م — الحمام مستثنى`);
  const wetExpected = 2 * (2 + 2) * rm.DEFAULT_CEILING_H;
  ok(Math.abs(q.wetWallArea - wetExpected) < 0.01, `سيراميك حوائط الرطب ${q.wetWallArea} م²`);

  const sug = rm.suggestedQuantities(rooms);
  ok(Object.keys(sug).length > 0, `${Object.keys(sug).length} بندًا كميته مشتقة من الغرف`);
  ok(Object.keys(sug).every(id => /^[A-Z]{3}-\d{3}$/.test(id)), "الربط بأكواد ثابتة لا بأسماء");

  const res = rm.applySuggestions({ ...newClient(), area: 34 }, rooms);
  ok(Object.keys(res.client.items).length === res.applied.length, `طُبّق ${res.applied.length} بندًا`);

  // كمية أدخلها المستخدم يدويًا لا تُدهس
  const manual = { ...newClient(), area: 34, items: { [res.applied[0]]: { qty: 999 } } };
  const res2 = rm.applySuggestions(manual, rooms);
  ok(res2.client.items[res.applied[0]].qty === 999 && res2.skipped.includes(res.applied[0]),
     "الكمية اليدوية محمية من الدهس");
  const res3 = rm.applySuggestions(manual, rooms, { force: true });
  ok(res3.client.items[res.applied[0]].qty !== 999, "إلا عند الإجبار الصريح");
}

console.log("\n── ٦. القوالب ──");
{
  ok(tpl.TEMPLATES.length > 0, `${tpl.TEMPLATES.length} قوالب جاهزة`);
  for (const t of tpl.TEMPLATES) {
    const errs = tpl.validateTemplate(t);
    ok(errs.length === 0, `قالب سليم: ${t.name}` + (errs.length ? ` — ${errs.join("، ")}` : ""));
  }
  const c5 = tpl.clientFromTemplate(tpl.TEMPLATES[0]);
  ok(calcClient(c5, DEFAULT_SETTINGS).grandTotal > 0,
     `"${tpl.TEMPLATES[0].name}" ينتج مقايسة ${fmt(calcClient(c5, DEFAULT_SETTINGS).grandTotal)} ج.م فورًا`);
  const designOnly = tpl.TEMPLATES.find(t => t.exclude?.length > 0);
  if (designOnly) {
    const c6 = tpl.clientFromTemplate(designOnly);
    ok(Object.values(c6.scopeIncluded).some(v => v === false), `"${designOnly.name}" يستبعد نطاقات فعلًا`);
  }
}

console.log("\n── اقتراح الأسعار من التاريخ ──");
{
  /* البند مرجعه معرّفه لا موضعه في المصفوفة — إدراج بند جديد في الكتالوج
     كان يكسر هذا الاختبار وهو سليم، لأن ITEMS[12] كان يشير لبند آخر. */
  const ITEM = ITEMS.find(it => it[5] === "FIN-001");
  const ID = ITEM[5], book = pb.DEFAULT_PRICEBOOK;
  const mk = (id, price, date) => ({ ...newClient(), id, name: "م"+id, items: { [ID]: { price, priceDate: date } } });

  ok(!sg.suggestPrice([], ITEM, 1, book).hasSuggestion, "بلا تاريخ: لا اقتراح");
  ok(!sg.suggestPrice([mk("a",700,"2026-07-01")], ITEM, 1, book).hasSuggestion,
     "مشروع واحد: لا اقتراح — رقم واحد ليس نمطًا");

  const hist = [mk("a",700,"2026-07-01"), mk("b",720,"2026-07-10"), mk("c",710,"2026-07-20")];
  const s1 = sg.suggestPrice(hist, ITEM, 1, book);
  ok(s1.hasSuggestion && s1.suggested === 710, `الوسيط = ${s1.suggested} من 3 مشاريع`);
  ok(s1.min === 700 && s1.max === 720, "المدى معروض للحكم");

  // شاذ واحد لا يجرّ الاقتراح — وهذا الفرق بين الوسيط والمتوسط
  const withOutlier = [...hist, mk("d",50,"2026-07-25")];
  const s2 = sg.suggestPrice(withOutlier, ITEM, 1, book);
  const mean = (700+720+710+50)/4;
  ok(s2.suggested === 705 && s2.suggested > mean, `خصم شاذ 50: الوسيط ${s2.suggested} صمد (المتوسط كان ${Math.round(mean)})`);

  ok(s1.staleCatalogue === true && s1.catalogue === 550, `انحراف عن الكتالوج ${(s1.drift*100).toFixed(0)}% ← تنبيه`);
  const drift = sg.catalogueDriftReport(hist, ITEMS, book, 1);
  ok(drift.length === 1 && drift[0].id === ID, "تقرير الانحراف يرصد البند");

  const bad = { ...newClient(), id: "x", area: 150, items: { [ID]: { price: 5500 } } };
  const out = sg.priceOutliers(bad, ITEMS, hist, book);
  ok(out.length === 1 && out[0].entered === 5500, `شذوذ إدخال مرصود: 5500 مقابل ${out[0].reference}`);
  const okc = { ...newClient(), id: "y", area: 150, items: { [ID]: { price: 715 } } };
  ok(sg.priceOutliers(okc, ITEMS, hist, book).length === 0, "سعر معقول لا يُنبَّه عليه");
}

console.log("\n── استيراد جدول الغرف (BIM) ──");
{
  // مخرجات Revit نموذجية: إنجليزية، مساحة بلا أبعاد
  const revit = imp.parseCSV('Room Name,Department,Area\n"Living 01",Living,30\n"Bathroom 1",Toilet,4.5\n"Master Bed",Bedroom,18\n');
  const r1 = imp.parseSchedule(revit);
  ok(r1.rooms.length === 3, `3 غرف من مخرجات Revit`);
  ok(r1.rooms[1].type === "حمام", `"Bathroom 1" ← ${r1.rooms[1].type}`);
  ok(r1.rooms[0].type === "صالة" && r1.rooms[2].type === "غرفة نوم", "الأنواع مستنتَجة من الأسماء الإنجليزية");
  ok(r1.rooms.every(r => r.derivedDimensions), "الأبعاد مشتقة من المساحة");
  ok(r1.warnings.some(w => w.includes("مربعة")), "والمستخدم مُنبَّه لذلك صراحةً");
  ok(Math.abs(rm.deriveQuantities(r1.rooms).floorArea - 52.5) < 0.1, "المساحة الإجمالية دقيقة 52.5 م²");

  // جدول عربي بأبعاد صريحة
  const ar = imp.parseCSV('اسم الغرفة,النوع,الطول,العرض\nصالة,صالة,6,5\nحمام,حمام,2,2\n');
  const r2 = imp.parseSchedule(ar);
  ok(r2.rooms.length === 2 && !r2.rooms[0].derivedDimensions, "أعمدة عربية بأبعاد صريحة");
  ok(Math.abs(rm.deriveQuantities(r2.rooms).dryPerimeter - 22) < 0.01, "المحيط دقيق 22 م");

  ok(imp.parseSchedule(imp.parseCSV('اسم\nصالة\n')).rooms.length === 0, "بلا مساحة: يرفض بوضوح");
  ok(imp.parseCSV('a,"b,c",d\n')[0].length === 3, "فاصلة داخل حقل مقتبس تُعالَج");
}

console.log("\n── دفتر الأستاذ ──");
{
  const c = { ...newClient(), id: "L1", name: "عميل أ", area: 150, stage: "تم التعاقد" };
  c.contract = buildContractSnapshot(c, DEFAULT_SETTINGS, "يوسف");
  c.variations = [{ ...fin.newVariation(c.id,1), status:"approved", date:"2026-07-05", title:"رخام",
                    lines:[{name:"رخام",qty:10,price:1200}] }];
  c.receipts = [{ ...fin.newReceipt(c.id,1), amount:200000, date:"2026-07-10" }];
  c.expenses = [{ ...fin.newExpense(c.id,1), amount:80000, date:"2026-07-12", vendor:"مورّد رخام" }];

  const rows = led.ledgerEntries([c]);
  ok(rows.length === 4, `4 حركات: عقد + تغيير + تحصيل + مصروف`);
  ok(rows[0].date <= rows[rows.length-1].date, "مرتّبة زمنيًا");
  ok(rows.find(r => r.type === "مصروف").credit === -80000, "المصروف سالب في عمود النقد");
  ok(rows.find(r => r.type === "تحصيل").credit === 200000, "التحصيل موجب");

  const sum = led.ledgerSummary([c]);
  ok(Math.abs(sum.netCash - 120000) < 1, `الصافي النقدي ${fmt(sum.netCash)} = 200,000 − 80,000`);
  ok(Math.abs(sum.contracted - (c.contract.totals.grandTotal + 12000)) < 1, "المتعاقد يشمل التغيير المعتمد");

  const csv = led.ledgerCSV([c]);
  ok(csv.startsWith("\uFEFF"), "CSV يبدأ بـ BOM ليقرأ إكسل العربية");
  ok(csv.split("\r\n").length === 5, "سطر عناوين + 4 حركات");
}


/* ═══════════════════════════════════════════════════════════════════════════
   المقايسة بالمراحل الخمس + التحصيل قبل البدء والربح بعد التسليم
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\n── المقايسة موزّعة على المراحل ──");
{
  const S = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.12 };
  const c = newClient(); c.area = 150;
  const bp = calcByPhase(c, S);

  ok(PHASES.length === 5, `المراحل خمس: ${PHASES.join(" · ")}`);
  ok(ITEMS.every(it => PHASES.includes(phaseOf(it[5], it[0]))),
     "كل بند في الكتالوج منسوب لمرحلة معروفة");
  ok(ITEMS.every(it => ITEM_PHASE[it[5]]),
     "كل بند له مرحلة صريحة بالمعرّف — لا اعتماد على الافتراضي");

  /* الاختبار الحاسم: التقسيم على المراحل لا يخلق ولا يفقد جنيهًا واحدًا.
     لو انكسر، فالعميل يُطالَب بمجموع مراحل ≠ إجمالي عقده. */
  const whole = calcClient(c, S);
  ok(Math.abs(bp.grandTotal - whole.grandTotal) < 1e-6,
     `مجموع المراحل = الإجمالي بالضبط (${fmt(bp.grandTotal)} ج.م، فارق ${(bp.grandTotal - whole.grandTotal).toExponential(1)})`);
  ok(Math.abs(bp.net - whole.subtotal) < 1e-6, "مجموع ما قبل الضريبة مطابق أيضًا");
  ok(Math.abs(bp.vat - whole.vat) < 1e-6, "مجموع الضريبة مطابق أيضًا");

  // كل بند يظهر مرة واحدة فقط في كل المراحل — لا تكرار ولا سقوط
  const seen = bp.phases.flatMap(p => p.lines.map(l => l.id));
  ok(seen.length === ITEMS.length && new Set(seen).size === ITEMS.length,
     `كل بند يظهر مرة واحدة (${seen.length} من ${ITEMS.length})`);

  // التوزيع الفعلي الذي يميّز المراحل عن النطاقات
  const ph = (id) => phaseOf(id, "");
  ok(ph("PLS-001") === "التأسيس", "المحارة والبياض في مرحلة التأسيس");
  ok(ph("ELE-001") === "التأسيس" && ph("ELE-003") === "التشطيب النهائي",
     "الكهرباء تنقسم: التمديدات تأسيس والإنارة تشطيب");
  ok(ph("MEP-002") === "التأسيس" && ph("MEP-004") === "التشطيب النهائي",
     "السباكة تنقسم: الصرف تأسيس والتكييف تشطيب");
  ok(ph("STR-004") === "التأسيس" && ph("STR-001") === "التعديلات المعمارية",
     "الردم تأسيس والتكسير تعديلات معمارية");
  ok(ph("CUS-001") === "التشطيب النهائي", "بند مكتب مخصّص بلا مرحلة ← التشطيب افتراضيًا");

  // بند المحارة الجديد يدخل الحساب فعلًا
  const base = bp.phases.find(p => p.phase === "التأسيس");
  ok(base.lines.some(l => l.id === "PLS-001" && l.included && l.total > 0),
     `بند المحارة محسوب: ${fmt(base.lines.find(l => l.id === "PLS-001").total)} ج.م`);
}

console.log("\n── التحصيل قبل البدء والربح بعد التسليم ──");
{
  const S = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.12 };
  const c = newClient(); c.area = 150;
  const bp = calcByPhase(c, S);
  let plan = fin.phasePaymentPlan(c, S, bp);

  ok(Math.abs(plan.contractTotal - (plan.quoteTotal + plan.profitTotal)) < 1e-6,
     "قيمة التعاقد = المقايسة + الربح");
  ok(plan.rows.every(r => !r.mayStart || r.empty),
     "لا مرحلة مسموح ببدئها قبل تحصيل أي شيء");
  ok(plan.profitDueNow === 0, "لا ربح مستحق قبل أي تسليم");

  const first = plan.rows[0];
  ok(first.statusLabel === "بانتظار التحصيل قبل البدء", `حالة المرحلة الأولى: ${first.statusLabel}`);

  /* المستحق الآن ≠ المتبقي كله: المكتب يطالب بقيمة المرحلة التالية فقط،
     لا بقيمة مشروع لم يبدأ. */
  ok(Math.abs(plan.dueNow - first.quote) < 1 && plan.dueNow < plan.outstanding,
     `المستحق الآن ${fmt(plan.dueNow)} = المرحلة الأولى فقط، لا ${fmt(plan.outstanding)}`);

  // تحصيل جزئي لا يفتح البدء
  c.receipts = [{ id: "R0", amount: first.quote / 2, phase: first.phase, kind: "base" }];
  plan = fin.phasePaymentPlan(c, S, bp);
  ok(!plan.rows[0].mayStart, "تحصيل نصف القيمة لا يسمح بالبدء");

  // تحصيل كامل يفتحه
  c.receipts = [{ id: "R1", amount: first.quote, phase: first.phase, kind: "base" }];
  plan = fin.phasePaymentPlan(c, S, bp);
  ok(plan.rows[0].mayStart && plan.rows[0].status === "ready", "التحصيل الكامل يسمح بالبدء");
  ok(plan.rows[0].profitRemaining > 0 && plan.profitDueNow === 0,
     "الربح ما زال غير مستحق — المرحلة لم تُسلَّم");
  ok(Math.abs(plan.dueNow - plan.rows[1].quote) < 1,
     "المستحق انتقل تلقائيًا للمرحلة التالية");

  // التسليم يُنشئ الاستحقاق
  c.phaseDelivered = fin.markPhaseDelivered(c, first.phase, "2026-08-16");
  plan = fin.phasePaymentPlan(c, S, bp);
  ok(plan.rows[0].status === "profitDue" && Math.abs(plan.profitDueNow - plan.rows[0].profitDue) < 1,
     `بعد التسليم: ربح مستحق ${fmt(plan.profitDueNow)} ج.م`);

  // تحصيل الربح يُكمل المرحلة
  c.receipts.push({ id: "R2", amount: plan.rows[0].profitDue, phase: first.phase, kind: "profit" });
  plan = fin.phasePaymentPlan(c, S, bp);
  ok(plan.rows[0].status === "done" && plan.profitDueNow === 0, "بعد تحصيل الربح: المرحلة مكتملة");

  // إلغاء التسليم يسحب الاستحقاق — الاستحقاق مربوط بالتسليم لا بالوقت
  c.phaseDelivered = fin.unmarkPhaseDelivered(c, first.phase);
  plan = fin.phasePaymentPlan(c, S, bp);
  ok(!plan.rows[0].profitClaimable, "إلغاء التسليم يسحب استحقاق الربح");
}

console.log("\n── نسبة الربح: رقم المكتب لا رقم النظام ──");
{
  const c = newClient(); c.area = 150;
  const bare = { ...DEFAULT_SETTINGS };
  ok((bare.agreedProfitPct || 0) === 0, "النسبة صفر افتراضيًا — النظام لا يخترع ربحًا");

  let plan = fin.phasePaymentPlan(c, bare, calcByPhase(c, bare));
  ok(plan.pctMissing && plan.profitTotal === 0, "بلا نسبة: الربح صفر والنظام يعلن النقص صراحة");
  ok(Math.abs(plan.contractTotal - plan.quoteTotal) < 1e-6, "قيمة التعاقد = المقايسة وحدها");

  const S = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.10 };
  ok(Math.abs(fin.agreedProfitPct(c, S) - 0.10) < 1e-9, "بلا تخصيص: تُستخدم نسبة المكتب");
  c.agreedProfitPct = 0.18;
  ok(Math.abs(fin.agreedProfitPct(c, S) - 0.18) < 1e-9, "تخصيص العميل يتقدّم على نسبة المكتب");
  c.agreedProfitPct = 0;
  ok(fin.agreedProfitPct(c, S) === 0, "صفر صريح للعميل يُحترم ولا يُستبدل بنسبة المكتب");
}

console.log("\n── نسب الدفعات القديمة والمصروفات بالمرحلة ──");
{
  const S = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.12 };
  const c = newClient(); c.area = 150;
  const bp = calcByPhase(c, S);

  /* دفعة سُجّلت قبل نظام المراحل: تُحسب في الإجمالي وتُعلن غير موزّعة،
     ولا تُنسب بالتخمين لمرحلة لم يُدفع عنها. */
  c.receipts = [{ id: "OLD", amount: 50000 }];
  const plan = fin.phasePaymentPlan(c, S, bp);
  ok(plan.unallocated === 50000 && plan.collected === 50000, "دفعة قديمة: محسوبة وغير موزّعة");
  ok(plan.rows.every(r => r.paidBase === 0), "لم تُنسب لأي مرحلة بالتخمين");
  ok(!plan.rows[0].mayStart, "ولا تفتح البدء في مرحلة لم تُدفع");

  // المصروفات: صريحة بالمرحلة، أو مشتقة من البند، أو غير منسوبة
  c.expenses = [
    { id: "E1", amount: 30000, phase: "التأسيس" },
    { id: "E2", amount: 10000, itemId: "FIN-001" },
    { id: "E3", amount: 5000 },
  ];
  const bud = fin.phaseBudget(c, bp);
  const at = (n) => bud.lines.find(l => l.phase === n).spent;
  ok(at("التأسيس") === 30000, "مصروف بمرحلة صريحة");
  ok(at("التشطيب النهائي") === 10000, "مصروف مرتبط ببند ← مرحلة البند تلقائيًا");
  ok(bud.unassigned === 5000 && bud.spent === 45000, "مصروف بلا بند ولا مرحلة يُعلَن لا يُخفى");
  ok(bud.lines.every(l => l.planned >= 0) && bud.planned > 0, "المخطط لكل مرحلة من بنود المقايسة");
  ok(!bud.lines.find(l => l.phase === "التأسيس").overrun, "30 ألف داخل ميزانية التأسيس");

  c.expenses.push({ id: "E4", amount: 200000, phase: "التأسيس" });
  const bud2 = fin.phaseBudget(c, bp);
  ok(bud2.lines.find(l => l.phase === "التأسيس").overrun && bud2.overruns.length === 1,
     "تجاوز ميزانية التأسيس يُرصد فورًا");
}


console.log("\n── جدول الغرف يغذّي المحارة والدهان ──");
{
  const rooms = [
    { ...rm.newRoom(1), type: "غرفة نوم", length: 4, width: 3.5, height: 3, count: 2 },
    { ...rm.newRoom(2), type: "حمام",     length: 2, width: 1.8, height: 3, count: 2 },
  ];
  const d = rm.deriveQuantities(rooms);
  ok(d.wallArea > 0, `مساحة الحوائط الكلية ${d.wallArea} م²`);
  ok(Math.abs(d.plasterArea - (d.wallArea + d.ceilingArea)) < 0.01,
     `سطح المحارة = حوائط ${d.wallArea} + أسقف ${d.ceilingArea} = ${d.plasterArea} م²`);
  ok(d.plasterArea > d.wetWallArea, "سطح المحارة أكبر من الحوائط الرطبة وحدها");

  const sug = rm.suggestedQuantities(rooms);
  ok(sug["PLS-001"] === d.plasterArea, "المحارة تأخذ كميتها من جدول الغرف");
  ok(sug["FIN-006"] === d.plasterArea, "الدهانات تأخذ نفس السطح المُحضَّر");

  const res = rm.applySuggestions({ ...newClient(), rooms }, rooms);
  ok(Number(res.client.items["PLS-001"].qty) === d.plasterArea, "الاقتراح يُطبَّق على بند المحارة فعلًا");
  ok(res.applied.includes("PLS-001") && res.applied.includes("FIN-006"), "البندان مُدرجان في قائمة المُطبَّق");
}

/* ═══════════════════════════════════════════════════════════════════════════
   تحليل السعر ومصروفات الموقع — التصنيف الواحد مستعملًا مرّتين
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\n── تحليل سعر البند ──");
{
  let book = pb.DEFAULT_PRICEBOOK;
  ok(ct.COST_KINDS.length === 5, `خمس فئات: ${ct.COST_KINDS.map(k => ct.KIND_SHORT[k]).join(" · ")}`);
  ok(!ct.isAnalysed({}) && !ct.isAnalysed(ct.emptyAnalysis()),
     "كائن كل قيمه أصفار ليس تحليلًا — حقل فارغ لا تقدير");

  book = pb.setItemAnalysis(book, "PLS-001", 1, { materials: 45, labour: 60, equipment: 5 });
  const an = pb.itemAnalysis(book, "PLS-001", 1);
  ok(an && ct.analysisTotal(an) === 110, `تكلفة المحارة = 45+60+5 = ${ct.analysisTotal(an)}`);

  /* التكلفة المسطّحة تتبع التحليل تلقائيًا — مصدر واحد للحقيقة،
     وإلا عرض النظام هامشين مختلفين لنفس البند. */
  const item = ITEMS.find(i => i[5] === "PLS-001");
  ok(pb.costAt(book, item, 1) === 110, "costAt يقرأ من التحليل لا من الرقم القديم");
  ok((book.items["PLS-001"].cost || [])[1] === 110, "الرقم المسطّح تزامن مع التحليل");
  ok(pb.itemMargin(book, item, 1, 120).cost === 110, "الهامش يُحسب من التحليل");

  ok(pb.itemAnalysis(book, "PLS-001", 0) === null, "المستوى غير المحلَّل يبقى null لا صفرًا");
  ok(pb.costAt(book, item, 0) === null, "ولا تُخترع له تكلفة");

  const shares = ct.analysisShares(an);
  ok(Math.abs(shares.labour - 60 / 110) < 1e-9, `العمالة ${(shares.labour * 100).toFixed(0)}% من تكلفة المحارة`);
  ok(ct.dominantKind(an) === "labour", "الفئة الأكبر: عمالة");

  book = pb.clearItemAnalysis(book, "PLS-001", 1);
  ok(pb.itemAnalysis(book, "PLS-001", 1) === null, "حذف التحليل يعمل");
}

console.log("\n── تجميع التحليل بالبند والمرحلة ──");
{
  const c = newClient(); c.area = 150;
  let book = pb.DEFAULT_PRICEBOOK;
  book = pb.setItemAnalysis(book, "PLS-001", 1, { materials: 45, labour: 60, equipment: 5 });
  book = pb.setItemAnalysis(book, "ELE-001", 1, { materials: 95, subcontract: 70 });
  const list = pb.catalogueWithCustom(book);
  const byId = Object.fromEntries(list.map(i => [i[5], i]));
  const rows = list.map(i => resolveItem(c, i, 150));
  const a = pb.costAnalysis(book, rows, byId);

  ok(a.lines.length === 2, "بندان محلَّلان فقط يدخلان التحليل");
  ok(a.coverage > 0 && a.coverage < 1, `التغطية ${(a.coverage * 100).toFixed(0)}% — لا ادّعاء اكتمال`);
  ok(!a.complete && a.unanalysed.length > 0, "البنود غير المحلَّلة تُعلَن بأسمائها");
  ok(a.unanalysed[0].revenue >= a.unanalysed[a.unanalysed.length - 1].revenue,
     "غير المحلَّلة مرتّبة بالأثر المالي — الأهم أولًا");

  /* المستويان متسقان: مجموع المراحل = الإجمالي، ومجموع الفئات = الإجمالي */
  const sumPhases = a.phases.reduce((s, p) => s + p.analysed, 0);
  ok(Math.abs(sumPhases - a.totalCost) < 1e-6, "مجموع المراحل = إجمالي التكلفة المحلَّلة");
  ok(Math.abs(ct.analysisTotal(a.byKind) - a.totalCost) < 1e-6, "مجموع الفئات = إجمالي التكلفة");
  const sumLines = a.lines.reduce((s, l) => s + l.cost, 0);
  ok(Math.abs(sumLines - a.totalCost) < 1e-6, "مجموع البنود = إجمالي التكلفة");

  const plaster = a.lines.find(l => l.id === "PLS-001");
  ok(plaster.cost === 110 * plaster.qty, `تكلفة بند المحارة = 110 × ${plaster.qty} = ${fmt(plaster.cost)}`);
  ok(plaster.kinds.labour === 60 * plaster.qty, "الفئة تُضرب في الكمية لا تُنسخ");

  const base = a.phases.find(p => p.phase === "التأسيس");
  ok(base.analysed > 0 && base.unanalysed > 0, "المرحلة تفصل المحلَّل عن غير المحلَّل");
}

console.log("\n── حسابات مقاولي الباطن ──");
{
  const c = newClient(); c.area = 150;
  c.contractors = [{ ...fin.newContractor(c.id, 1, "التأسيس"), name: "أسطى محمود", trade: "محارة", contractValue: 60000 }];
  c.expenses = [
    { id: "E1", kind: "subcontract", phase: "التأسيس", contractorId: "SUB-001", amount: 38000, retained: 2000 },
  ];
  let L = fin.contractorLedger(c);
  const k = L.rows[0];
  ok(k.paid === 38000 && k.retained === 2000, "المصروف والمحتجز منفصلان");
  ok(k.certified === 40000, "المعتمد = المصروف + المحتجز — المحتجز عمل نُفّذ واستُحق");
  ok(k.remaining === 20000, `المتبقي ${fmt(k.remaining)} = 60,000 − 40,000`);
  ok(!k.overCertified && !k.settled, "لم يتجاوز ولم يُستوفَ بعد");

  c.expenses.push({ id: "E2", kind: "subcontract", phase: "التأسيس", contractorId: "SUB-001", amount: 25000 });
  L = fin.contractorLedger(c);
  ok(L.rows[0].overCertified && L.rows[0].remaining < 0,
     `تجاوز التعاقد يُرصد: صُرف ${fmt(L.rows[0].certified)} مقابل تعاقد ${fmt(60000)}`);
  ok(L.overCertified.length === 1, "المتجاوزون في قائمة مستقلة للتنبيه");

  c.expenses.push({ id: "E3", kind: "subcontract", phase: "التأسيس", amount: 5000 });
  L = fin.contractorLedger(c);
  ok(L.orphanTotal === 5000 && L.orphanPayments.length === 1,
     "مصروف مقاول بلا مقاول معرّف يُعلَن لا يُوزَّع بالتخمين");
  ok(L.rows[0].paid === 63000, "ولا يُضاف لحساب مقاول آخر");
}

console.log("\n── مصروفات الموقع بنفس فئات التسعير ──");
{
  const c = newClient(); c.area = 150;
  let book = pb.DEFAULT_PRICEBOOK;
  book = pb.setItemAnalysis(book, "PLS-001", 1, { materials: 45, labour: 60, equipment: 5 });
  const list = pb.catalogueWithCustom(book);
  const rows = list.map(i => resolveItem(c, i, 150));
  const plan = pb.costAnalysis(book, rows, Object.fromEntries(list.map(i => [i[5], i])));

  c.expenses = [
    { id: "E1", kind: "materials", phase: "التأسيس", itemId: "PLS-001", amount: 25000 },
    { id: "E2", kind: "labour",    phase: "التأسيس", itemId: "PLS-001", amount: 31000 },
    { id: "E3", kind: "equipment", phase: "التأسيس", amount: 9000 },     // ونش: بلا بند
    { id: "E4", kind: "materials", amount: 4000 },                        // بلا مرحلة
  ];

  const spend = fin.siteSpendByKind(c);
  ok(spend.byKind.equipment === 9000 && spend.byKind.labour === 31000, "المصروف مبوّب بالفئة");
  ok(spend.unassigned === 4000, "المصروف بلا مرحلة يُعلَن ولا يُنسب");
  ok(spend.indirect["التأسيس"] === 9000, "الونش مصروف غير مباشر على المرحلة");
  ok(spend.direct["PLS-001"] === 56000, "المصروف المرتبط ببند يُنسب له مباشرة");

  const pva = fin.plannedVsActual(c, plan);
  const base = pva.phases.find(p => p.phase === "التأسيس");
  const kMat = base.kinds.find(k => k.kind === "materials");
  const kEq  = base.kinds.find(k => k.kind === "equipment");
  ok(kMat.planned === 45 * 480 && kMat.spent === 25000, `خامات: مخطط ${fmt(kMat.planned)} فعلي ${fmt(kMat.spent)}`);
  ok(kEq.overrun && kEq.diff < 0, `المعدات تجاوزت: ${fmt(-kEq.diff)} ج.م فوق المخطط`);
  /* إجمالي المشروع يشمل المصروف بلا مرحلة (المال صُرف فعلًا)، بينما صفوف
     المراحل لا تشمله. الفارق مُعلَن في pva.unassigned لا مخفيًا. */
  const matTotal = pva.totals.find(t => t.kind === "materials");
  ok(matTotal.spent === 29000, "إجمالي الخامات يشمل المصروف بلا مرحلة (25,000 + 4,000)");
  ok(kMat.spent === 25000, "بينما صف المرحلة لا يشمله");
  ok(pva.unassigned === 4000, "والفارق مُعلَن صراحة لا مخفيًا");
  ok(pva.worstKind && pva.worstKind.kind === "materials"
     && (pva.worstKind.spent - pva.worstKind.planned) === 7400,
     `أسوأ فئة بالقيمة: خامات (+${fmt(7400)}) لا معدات (+${fmt(6600)})`);
  ok(base.comparable, "المرحلة قابلة للمقارنة لأن بنودها محلَّلة");

  const empty = fin.plannedVsActual({ expenses: [{ id: "X", kind: "labour", phase: "التعديلات المعمارية", amount: 900 }] }, plan);
  const noPlan = empty.phases.find(p => p.phase === "التعديلات المعمارية");
  ok(!noPlan.comparable, "مرحلة بلا تحليل تُعلَن غير قابلة للمقارنة بدل عرض فارق مخترع");

  /* توزيع الونش: بالتناسب مع القيمة المخططة، لا بالتساوي */
  const ia = fin.itemActualCost(c, plan);
  const line = ia.lines.find(l => l.id === "PLS-001");
  ok(line.directSpend === 56000, "المصروف المباشر كما هو");
  ok(Math.abs(line.indirectShare - 9000) < 1e-6,
     "بند واحد محلَّل في المرحلة ← يحمل الونش كاملًا");
  ok(Math.abs(line.actual - 65000) < 1e-6, "التكلفة الفعلية = مباشر + نصيب غير مباشر");
  ok(line.overrun && line.actualProfit < (line.revenue - line.planned),
     "الربح الفعلي أقل من المخطط بعد تحميل الونش");
}

console.log("\n── توزيع المصروف غير المباشر ──");
{
  const d = ct.distributeIndirect(1000, [{ id: "a", weight: 75 }, { id: "b", weight: 25 }]);
  ok(d.shares[0].share === 750 && d.shares[1].share === 250,
     "التوزيع بالتناسب: 75% و25% لا 50/50");
  ok(d.undistributed === 0, "لا متبقٍ");

  const none = ct.distributeIndirect(500, [{ id: "a", weight: 0 }]);
  ok(none.undistributed === 500 && none.shares[0].share === 0,
     "بلا أوزان: يُعلَن غير موزّع بدل اختراع نسبة");

  const zero = ct.distributeIndirect(0, [{ id: "a", weight: 10 }]);
  ok(zero.shares[0].share === 0 && zero.undistributed === 0, "صفر مصروف = صفر توزيع");
}

console.log(`\n${"─".repeat(44)}\nنجح ${pass} · فشل ${fail}`);
process.exit(fail ? 1 : 0);
