import {
  newClient, resolveItem, calcClient, migrateClient, progressFromVisits,
  ownsClient, buildContractSnapshot, amendContract, effectiveTotals,
} from "../src/domain/pricing.js";
import { ITEMS, DEFAULT_SETTINGS, fmt } from "../src/domain/catalogue.js";
import { can, roleLabel } from "../src/domain/permissions.js";

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

console.log(`\n${"─".repeat(40)}\nنجح ${pass} · فشل ${fail}`);
process.exit(fail ? 1 : 0);
