import {
  newClient, resolveItem, calcClient, migrateClient, progressFromVisits,
  ownsClient, buildContractSnapshot, amendContract, effectiveTotals,
} from "../src/domain/pricing.js";
import { ITEMS, DEFAULT_SETTINGS, fmt } from "../src/domain/catalogue.js";
import { can, roleLabel } from "../src/domain/permissions.js";
import * as pb from "../src/domain/pricebook.js";
import * as fin from "../src/domain/finance.js";
import * as rm from "../src/domain/rooms.js";
import * as tpl from "../src/domain/templates.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log((cond ? "✅" : "❌") + " " + msg); };

const ITEM = ITEMS[12];              // [scope, name, unit, qtyFn, prices, id]
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
  const id = ITEMS[12][5];
  book = pb.updateBookItem(book, id, { cost: [200, 300, 500, 800] });
  const m1 = pb.projectMargin(book, rows, byId);
  ok(m1.ratio !== null && m1.coverage > 0 && m1.coverage < 1,
     `تكلفة بند واحد ← تغطية ${(m1.coverage*100).toFixed(1)}% والهامش يخص المغطّى فقط`);
  ok(!m1.complete, "معلَّم كغير مكتمل");

  const mi = pb.itemMargin(book, ITEMS[12], 1, 550);
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
  c3.expenses = [{ ...fin.newExpense(c3.id, 1), amount: 50000, itemId: ITEMS[12][5] }];
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

console.log(`\n${"─".repeat(44)}\nنجح ${pass} · فشل ${fail}`);
process.exit(fail ? 1 : 0);
