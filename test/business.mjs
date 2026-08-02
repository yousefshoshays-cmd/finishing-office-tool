import { ITEMS, DEFAULT_SETTINGS, fmt } from "../src/domain/catalogue.js";
import { newClient, resolveItem, buildContractSnapshot } from "../src/domain/pricing.js";
import { DEFAULT_PRICEBOOK, updateBookItem, itemMargin, projectMargin,
         staleItems, catalogueWithCustom, newCustomItem } from "../src/domain/pricebook.js";
import { newVariation, variationTotal, contractValue, paymentPlan,
         budgetVariance, projectCashPosition } from "../src/domain/finance.js";
import { deriveQuantities, suggestedQuantities, applySuggestions, newRoom } from "../src/domain/rooms.js";
import { TEMPLATES, clientFromTemplate, validateTemplate } from "../src/domain/templates.js";

let pass=0, fail=0;
const ok=(c,m)=>{c?pass++:fail++;console.log((c?"✅":"❌")+" "+m);};
const byId = Object.fromEntries(ITEMS.map(i=>[i[5],i]));
const rows = (c,book) => catalogueWithCustom(book||DEFAULT_PRICEBOOK).map(i=>resolveItem(c,i,c.area));

console.log("── ١. دفتر الأسعار والهامش ──");
let book = { ...DEFAULT_PRICEBOOK };
const FIN1 = byId["FIN-001"];
let m = itemMargin(book, FIN1, 1, 550);
ok(m.estimated === true, "بلا تكلفة مُدخلة → الهامش معلَّم كمقدَّر");

book = updateBookItem(book, "FIN-001", { cost: [200,300,450,700], supplier: "الشرق للسيراميك" });
m = itemMargin(book, FIN1, 1, 550);
ok(!m.estimated && m.cost === 300, "التكلفة الحقيقية تُقرأ");
ok(Math.abs(m.ratio - 250/550) < 1e-9, `الهامش ${(m.ratio*100).toFixed(1)}% محسوب صحيحًا`);

const c = { ...newClient(), area: 150 };
const pm = projectMargin(book, rows(c), byId);
ok(pm.revenue > 0 && pm.profit > 0, `إيراد ${fmt(pm.revenue)} · ربح ${fmt(pm.profit)} · هامش ${(pm.ratio*100).toFixed(1)}%`);
ok(pm.estimatedShare > 0.5, `${(pm.estimatedShare*100).toFixed(0)}% من الإيراد مبني على تكلفة مقدّرة — يُنبَّه عليه`);

book = updateBookItem(book, "FIN-002", { cost: [340,360,380,400] });   // هامش ضعيف عمدًا
const pm2 = projectMargin(book, rows(c), byId);
ok(pm2.weakItems.some(w => w.id === "FIN-002"), "بند تحت الحد الأدنى للهامش يُرصد");

ok(staleItems(book).length === ITEMS.length - 2, "البنود غير المحدَّثة تُحصى (2 فقط محدَّثان)");

const withCustom = { ...book, custom: [{ ...newCustomItem(book), name:"ديكور جبس مخصص", qtyPerArea:0.3, price:[100,200,300,400], cost:[60,120,180,240] }] };
ok(catalogueWithCustom(withCustom).length === ITEMS.length + 1, "بند مخصص يدخل الكتالوج بلا مبرمج");

console.log("\n── ٤. جدول الغرف ──");
const rooms = [
  { ...newRoom(1), name:"صالة", type:"صالة", length:6, width:5 },
  { ...newRoom(2), name:"نوم", type:"غرفة نوم", length:4, width:3.5, count:2 },
  { ...newRoom(3), name:"حمام", type:"حمام", length:2.5, width:2, count:2 },
];
const d = deriveQuantities(rooms);
ok(Math.abs(d.floorArea - (30+28+10)) < 0.01, `مساحة الأرضيات ${d.floorArea} م² مشتقة`);
ok(d.bathrooms === 2, "عدد الحمامات مستنتج");
ok(d.dryPerimeter > 0 && d.wetWallArea > 0, "محيط الجاف ومساحة حوائط الرطب محسوبان");

const sug = suggestedQuantities(rooms);
ok(sug["FIN-001"] === d.floorArea, "أرضيات ← مساحة الغرف");
ok(sug["FIN-002"] === d.wetWallArea, "سيراميك حوائط ← حوائط الحمامات");

const manual = { ...c, items: { "FIN-001": { qty: 999 } } };
const r1 = applySuggestions(manual, rooms);
ok(r1.client.items["FIN-001"].qty === 999 && r1.skipped.includes("FIN-001"), "لا يدهس كمية أدخلها المستخدم");
ok(applySuggestions(manual, rooms, {force:true}).client.items["FIN-001"].qty === d.floorArea, "إلا بطلب صريح");

console.log("\n── ٢. أوامر التغيير ──");
const signed = { ...c, stage:"تم التعاقد", contract: buildContractSnapshot(c, DEFAULT_SETTINGS, "يوسف"), variations: [] };
const base = signed.contract.totals.grandTotal;
const vo = { ...newVariation(signed.id, 1), reason:"العميل طلب رخام بدل بورسلين",
             lines:[{ itemId:"FIN-001", name:"فرق رخام", unit:"م²", qty:68, price:700 }] };
ok(variationTotal(vo) === 47600, "قيمة أمر التغيير 47,600");

signed.variations = [vo];
ok(contractValue(signed).total === base, "المسودة لا تُحتسب في القيمة التعاقدية");
signed.variations = [{ ...vo, status:"sent" }];
ok(contractValue(signed).pendingValue === 47600 && contractValue(signed).total === base, "المعلّق يُعرض ولا يُحتسب");
signed.variations = [{ ...vo, status:"approved" }];
ok(Math.abs(contractValue(signed).total - (base + 47600)) < 0.5, "المعتمد فقط يرفع القيمة");
ok(signed.contract.totals.grandTotal === base, "لقطة العقد الأصلية لم تُمس");

console.log("\n── ٣. التحصيل والصرف ──");
signed.receipts = [{ amount: 150000 }, { amount: 100000 }];
const pay = paymentPlan(signed);
ok(pay.collected === 250000, "المحصَّل 250,000");
ok(Math.abs(pay.outstanding - (pay.total - 250000)) < 0.5, `المتبقي ${fmt(pay.outstanding)}`);
ok(pay.rows[0].settled === true, "الدفعة الأولى مسدَّدة");
ok(pay.nextDue !== null, `الدفعة المستحقة التالية: ${pay.nextDue.label}`);
ok(pay.rows.reduce((s,r)=>s+r.due,0) - pay.total < 0.5, "مجموع نسب الدفعات = القيمة التعاقدية");

signed.expenses = [
  { itemId:"FIN-001", amount: 120000 },
  { itemId:"", amount: 15000 },
];
const bv = budgetVariance(signed, rows(signed));
const line = bv.lines.find(l=>l.id==="FIN-001");
ok(line.spent === 120000, "الصرف منسوب للبند الصحيح");
ok(bv.unassigned === 15000, "مصروف بلا بند يُرصد منفصلًا");
ok(typeof line.overrun === "boolean", `البند ${line.overrun?"متجاوز":"داخل"} المخطط (${(line.ratio*100).toFixed(0)}%)`);

const cash = projectCashPosition(signed, rows(signed));
ok(cash.netCash === 250000 - 135000, `السيولة الفعلية ${fmt(cash.netCash)}`);
ok(cash.projectedProfit === cash.contractValue - cash.spent, "الربح المتوقع = التعاقدي − المصروف");

console.log("\n── ٦. القوالب ──");
ok(TEMPLATES.every(t => validateTemplate(t).length === 0), `كل القوالب الـ${TEMPLATES.length} صالحة`);
const villa = clientFromTemplate(TEMPLATES.find(t=>t.id==="villa"));
ok(villa.area === 400 && villa.scopeLevel["الكهرباء"] === "سوبر لوكس", "قالب الفيلا يضبط المستويات");
const dOnly = clientFromTemplate(TEMPLATES.find(t=>t.id==="design-only"));
ok(dOnly.scopeIncluded["تصميم"] && !dOnly.scopeIncluded["الكهرباء"], "قالب التصميم فقط يستبعد التنفيذ");
const t1 = resolveItem(villa, ITEMS[0], villa.area).total;
ok(t1 > 0, "القالب ينتج مقايسة فورًا");

console.log(`\n${"─".repeat(42)}\nنجح ${pass} · فشل ${fail}`);
process.exit(fail?1:0);
