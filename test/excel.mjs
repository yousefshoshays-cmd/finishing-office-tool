/* ============================================================================
   اختبار ملف الإكسل الفعلي — لا شكله بل أرقامه
   ----------------------------------------------------------------------------
   المقايسة تخرج للعميل كملف إكسل، فالخطأ فيها خطأ تعاقدي لا خطأ عرض.
   هذا الاختبار يبني الملف فعلًا، يقرأه خليةً خلية، ويتأكد أن:
     • الأوراق الثلاث موجودة
     • كل مرحلة لها ترويسة وقيمة مستحقة
     • مجموع قيم المراحل في الورقة = الإجمالي النهائي المكتوب فيها
     • جدول التحصيل يفصل ما قبل البدء عمّا بعد التسليم
   يعمل بلا متصفح: npm run test:excel
   ========================================================================== */

import { buildBOQWorkbook } from "../src/export/excel.js";
import { newClient, calcClient } from "../src/domain/pricing.js";
import { DEFAULT_SETTINGS, fmt } from "../src/domain/catalogue.js";
import { PHASES } from "../src/ui/tokens.js";
import * as pb from "../src/domain/pricebook.js";
import { KIND_LABEL } from "../src/domain/costing.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log((cond ? "✅" : "❌") + " " + msg); };

/* كل قيم الورقة نصًا، لتفتيش المحتوى بلا اعتماد على أرقام صفوف ثابتة */
function cellValues(ws) {
  const out = [];
  ws.eachRow(row => row.eachCell(c => { if (c.value !== null && c.value !== undefined) out.push(c.value); }));
  return out;
}
const texts = (ws) => cellValues(ws).filter(v => typeof v === "string");
const nums = (ws) => cellValues(ws).filter(v => typeof v === "number");

(async () => {
  const S = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.12 };
  const c = newClient();
  c.name = "أحمد محمود"; c.area = 150; c.address = "التجمع الخامس";
  c.receipts = [
    { id: "R1", amount: 34143, phase: "التصميم والتسعير المبدئي", kind: "base" },
  ];
  c.phaseDelivered = { "التصميم والتسعير المبدئي": "2026-08-10" };
  c.expenses = [
    { id: "E1", amount: 40000, phase: "التأسيس" },
    { id: "E2", amount: 22000, itemId: "FIN-001" },
  ];

  const wb = await buildBOQWorkbook(c, S, { includeCost: true });
  const names = wb.worksheets.map(w => w.name);

  console.log("── أوراق الملف ──");
  /* بلا تحليل أسعار: لا تُبنى ورقة "تحليل التكلفة" — ورقة فارغة أسوأ من غيابها */
  ok(names.length === 4, `أربع أوراق بلا تحليل أسعار: ${names.join(" · ")}`);
  ok(names[0] === "المقايسة بالمراحل", "الورقة الأولى هي المقايسة");
  ok(names.includes("جدول التحصيل"), "ورقة جدول التحصيل موجودة");
  ok(names.includes("الفعلي مقابل المخطط"), "ورقة المصروفات موجودة عند وجود مصروفات");
  ok(!names.includes("تحليل التكلفة"), "لا ورقة تحليل تكلفة بلا بند محلَّل واحد");

  console.log("\n── ورقة المقايسة ──");
  const boq = wb.getWorksheet("المقايسة بالمراحل");
  const boqText = texts(boq);
  for (const [i, p] of PHASES.entries()) {
    ok(boqText.some(t => t === `المرحلة ${i + 1} — ${p}`), `ترويسة المرحلة ${i + 1}: ${p}`);
    ok(boqText.some(t => t === `◆ قيمة المرحلة ${i + 1} المستحقة`), `سطر قيمة المرحلة ${i + 1}`);
  }
  ok(boqText.some(t => t === "محارة وبياض أساسي للحوائط والأسقف"), "بند المحارة يظهر في الملف");
  ok(boqText.some(t => t === "النطاق"), "عمود النطاق موجود بجانب المرحلة");

  /* الاختبار الحاسم في الملف نفسه: مجموع ما تحت كل مرحلة = الإجمالي النهائي.
     لو انكسر، فالعميل يستلم ملفًا مجموع مراحله لا يساوي ما يوقّع عليه. */
  const whole = calcClient(c, S);
  const phaseValues = [];
  boq.eachRow(row => {
    let label = null;
    row.eachCell(cell => {
      if (typeof cell.value === "string" && cell.value.startsWith("◆ قيمة المرحلة")) label = cell.value;
      else if (label !== null && typeof cell.value === "number") { phaseValues.push(cell.value); label = null; }
    });
  });
  const sum = phaseValues.reduce((a, b) => a + b, 0);
  ok(phaseValues.length === 5, `قيم المراحل الخمس مقروءة من الملف: ${phaseValues.map(v => fmt(v)).join(" + ")}`);
  ok(Math.abs(sum - Math.round(whole.grandTotal)) <= 3,
     `مجموع المراحل في الملف ${fmt(sum)} = الإجمالي ${fmt(whole.grandTotal)} (فارق تقريب ${Math.abs(sum - Math.round(whole.grandTotal))} ج.م)`);
  ok(nums(boq).includes(Math.round(whole.grandTotal)), "الإجمالي النهائي مكتوب كما يحسبه النظام");

  console.log("\n── ورقة التحصيل ──");
  const col = wb.getWorksheet("جدول التحصيل");
  const colText = texts(col);
  ok(colText.some(t => t === "يُحصَّل قبل البدء"), "عمود ما قبل البدء");
  ok(colText.some(t => t === "الربح بعد التسليم"), "عمود الربح بعد التسليم");
  ok(PHASES.every(p => colText.includes(p)), "المراحل الخمس كلها مدرجة في جدول التحصيل");
  ok(colText.some(t => t.includes("سُلّمت 2026-08-10")), "تاريخ تسليم المرحلة ظاهر");
  ok(colText.some(t => t.includes("بانتظار التحصيل قبل البدء")), "حالة مرحلة غير محصّلة ظاهرة");
  ok(colText.some(t => t === "إجمالي قيمة التعاقد"), "سطر إجمالي التعاقد");
  ok(colText.some(t => t === "المستحق الآن"), "سطر المستحق الآن");
  ok(!colText.some(t => t.includes("لم تُحدَّد نسبة الربح")), "لا تحذير — النسبة محدّدة");

  console.log("\n── ورقة المصروفات ──");
  const varSheet = wb.getWorksheet("الفعلي مقابل المخطط");
  const varText = texts(varSheet);
  ok(varText.some(t => t === "المصروف الفعلي"), "عمود المصروف الفعلي");
  ok(nums(varSheet).includes(40000), "مصروف التأسيس المسجّل يظهر");
  ok(nums(varSheet).includes(22000), "المصروف المرتبط ببند نُسب لمرحلته");

  console.log("\n── ورقتا تحليل التكلفة ومصروفات الموقع ──");
  let book = pb.DEFAULT_PRICEBOOK;
  book = pb.setItemAnalysis(book, "PLS-001", 1, { materials: 45, labour: 60, equipment: 5 });
  book = pb.setItemAnalysis(book, "ELE-001", 1, { materials: 95, subcontract: 70 });
  const cFull = { ...c };
  cFull.contractors = [{ id: "SUB-001", name: "أسطى محمود", trade: "محارة", phase: "التأسيس", contractValue: 60000 }];
  cFull.expenses = [
    { id: "E1", kind: "materials",  phase: "التأسيس", itemId: "PLS-001", amount: 25000, vendor: "مورد" },
    { id: "E2", kind: "subcontract",phase: "التأسيس", contractorId: "SUB-001", amount: 38000, retained: 2000 },
    { id: "E3", kind: "equipment",  phase: "التأسيس", amount: 9000, vendor: "ونش" },
  ];

  const wbc = await buildBOQWorkbook(cFull, S, { includeCost: true, priceBook: book });
  const sheetNames = wbc.worksheets.map(w => w.name);
  ok(sheetNames.includes("تحليل التكلفة"), "ورقة تحليل التكلفة موجودة");
  ok(sheetNames.includes("مصروفات الموقع"), "ورقة مصروفات الموقع موجودة");

  const ca = wbc.getWorksheet("تحليل التكلفة");
  const caText = texts(ca);
  ok(Object.values(KIND_LABEL).every(l => caText.includes(l)), "الفئات الخمس أعمدة في تحليل التكلفة");
  ok(caText.some(t => t.includes("التحليل يغطي")), "نسبة التغطية معلنة في العنوان");
  ok(caText.some(t => t.includes("بلا تحليل تكلفة")), "البنود غير المحلَّلة معلنة لا مخفية");
  ok(nums(ca).includes(52800), "تكلفة المحارة المحسوبة (110 × 480) في الملف");

  const ss = wbc.getWorksheet("مصروفات الموقع");
  const ssText = texts(ss);
  ok(ssText.some(t => t === "مخطط") && ssText.some(t => t === "فعلي"), "عمودا المخطط والفعلي");
  ok(ssText.some(t => t.includes("❌ تجاوز")), "التجاوز مُعلَّم");
  ok(ssText.some(t => t === "حسابات مقاولي الباطن"), "قسم المقاولين موجود");
  ok(ssText.some(t => t === "أسطى محمود"), "المقاول باسمه");
  ok(ssText.some(t => t === "محتجز الضمان لدى المكتب"), "محتجز الضمان سطر مستقل");
  ok(nums(ss).includes(2000), "قيمة المحتجز في الملف");
  ok(nums(ss).includes(20000), "متبقي المقاول = 60,000 − (38,000 + 2,000)");

  console.log("\n── حجب أرقام الموردين عمّن لا يراها ──");
  const wbEng = await buildBOQWorkbook(cFull, S, { priceBook: book });   // بلا includeCost — الافتراض
  ok(wbEng.worksheets.length === 2, "بلا صلاحية التكلفة: ورقتان فقط (المقايسة والتحصيل)");
  const engText = wbEng.worksheets.flatMap(w => texts(w));
  ok(!engText.some(t => t === "تحليل التكلفة" || t === "حسابات مقاولي الباطن"),
     "لا تحليل تكلفة ولا حسابات مقاولين");
  ok(!engText.some(t => t === "أسطى محمود"), "ولا أسماء المقاولين");
  ok(!wbEng.worksheets.flatMap(w => nums(w)).includes(38000), "ولا مبالغهم");

  console.log("\n── بلا نسبة ربح ولا مصروفات ──");
  const c2 = newClient(); c2.name = "بلا نسبة"; c2.area = 120;
  const wb2 = await buildBOQWorkbook(c2, { ...DEFAULT_SETTINGS });
  ok(wb2.worksheets.length === 2, "ورقتان فقط بلا مصروفات — لا ورقة فارغة تُربك العميل");
  ok(texts(wb2.getWorksheet("جدول التحصيل")).some(t => t.includes("لم تُحدَّد نسبة الربح")),
     "تحذير صريح عند غياب نسبة الربح بدل صفر صامت");

  console.log(`\n${"─".repeat(44)}\nنجح ${pass} · فشل ${fail}`);
  process.exit(fail ? 1 : 0);
})();
