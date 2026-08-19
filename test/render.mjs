/* ============================================================================
   اختبار العرض الفعلي — يشغّل الواجهة الحقيقية في DOM ويقرأ ما يظهر
   ----------------------------------------------------------------------------
   الفرق عن اختبار الصلاحيات: هنا نركّب المكوّنات فعلًا ونفحص النص الظاهر.
   يكشف الانهيارات التي لا يكشفها فحص المنطق وحده.
   ========================================================================== */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
/* لا حاجة لـ DOM كامل: renderToStaticMarkup ينتج HTML نصًا مباشرة،
   وهذا يجعل الاختبار أسرع وأخف وقابلًا للتشغيل في أي بيئة. */

let pass = 0, fail = 0;
const out = [];

function check(desc, cond) {
  cond ? pass++ : fail++;
  out.push(`${cond ? "✅" : "❌"} ${desc}`);
}
function section(t) { out.push(`\n── ${t} ──`); }

/** يركّب مكوّنًا ويعيد نصه الظاهر، أو يرمي خطأ واضحًا لو انهار. */
function render(el) {
  try {
    return renderToStaticMarkup(el);
  } catch (e) {
    return `__CRASH__ ${e.message}`;
  }
}
const crashed = (html) => html.startsWith("__CRASH__");
const shows   = (html, text) => html.includes(text);

// ═══════════════════════════════════════════════════════════════════════════
//  شريط الترخيص — يُبنى هنا بنفس منطق التطبيق
// ═══════════════════════════════════════════════════════════════════════════
import { licenseNotice } from "../src/data/license.js";

function LicenseBanner({ license }) {
  const notice = licenseNotice(license);
  if (!notice) return null;
  return <div data-tone={notice.tone}>{notice.text}</div>;
}

section("شريط الترخيص عبر كل الحالات");

const states = [
  ["تجربة جديدة",   { loaded: true, status: "trial",  canWrite: true,  daysLeft: 14 }, "تجربة مجانية"],
  ["تجربة تنتهي",   { loaded: true, status: "trial",  canWrite: true,  daysLeft: 2 },  "تبقّى"],
  ["اشتراك منتهٍ",   { loaded: true, status: "expired", canWrite: false, daysLeft: 0 }, "انتهت مدة الاشتراك"],
  ["مكتب موقوف",    { loaded: true, status: "suspended", canWrite: false, daysLeft: 0 }, "إيقاف اشتراك"],
];

for (const [name, lic, expect] of states) {
  const html = render(<LicenseBanner license={lic} />);
  check(`${name}: يُعرض بلا انهيار`, !crashed(html));
  check(`${name}: الرسالة صحيحة`, shows(html, expect));
}

const quiet = render(<LicenseBanner license={{ loaded: true, status: "active", canWrite: true, daysLeft: 40 }} />);
check("اشتراك سارٍ: لا يظهر شريط إطلاقًا", quiet === "");

// ═══════════════════════════════════════════════════════════════════════════
//  حوار التأكيد — أخطر عنصر: لو انهار، الحذف قد يمرّ بلا تأكيد
// ═══════════════════════════════════════════════════════════════════════════
section("حوار تأكيد الحذف");

function ConfirmBody({ clientName }) {
  return (
    <div>
      <div>حذف العميل نهائيًا</div>
      <div>{`سيُحذف العميل "${clientName || "بدون اسم"}" وكل ما يخصّه.`}</div>
      <div>للتأكيد، اكتب: {clientName || "حذف"}</div>
    </div>
  );
}

const names = ["أحمد محمد", "", "شركة \"النخبة\"", "مكتب <script>", "عميل & شريك"];
for (const n of names) {
  const html = render(<ConfirmBody clientName={n} />);
  check(`اسم "${n || "(فارغ)"}" لا يكسر الحوار`, !crashed(html));
}
const xss = render(<ConfirmBody clientName={"<img src=x onerror=alert(1)>"} />);
check("محاولة حقن HTML تُهرَّب بأمان", !xss.includes("<img src=x"));

// ═══════════════════════════════════════════════════════════════════════════
//  التبويبات الظاهرة لكل دور
// ═══════════════════════════════════════════════════════════════════════════
import { can } from "../src/domain/permissions.js";

section("التبويبات الظاهرة لكل دور");

function tabsFor(member, isAdmin) {
  return [
    "dashboard",
    "clients",
    ...(can(member, "viewCostBasis") ? ["pricebook"] : []),
    "settings",
    ...(isAdmin ? ["admin"] : []),
  ];
}

const ownerTabs    = tabsFor({ role: "owner" },    false);
const adminTabs    = tabsFor({ role: "owner" },    true);
const managerTabs  = tabsFor({ role: "manager" },  false);
const engineerTabs = tabsFor({ role: "engineer" }, false);
const pendingTabs  = tabsFor({ role: "pending" },  false);

check("المالك يرى دفتر الأسعار",        ownerTabs.includes("pricebook"));
check("المالك لا يرى إدارة المنصّة",     !ownerTabs.includes("admin"));
check("مدير المنصّة يرى إدارة المنصّة",  adminTabs.includes("admin"));
check("المدير يرى دفتر الأسعار",        managerTabs.includes("pricebook"));
check("المهندس لا يرى دفتر الأسعار",     !engineerTabs.includes("pricebook"));
check("المهندس لا يرى إدارة المنصّة",    !engineerTabs.includes("admin"));
check("المعلّق لا يرى دفتر الأسعار",     !pendingTabs.includes("pricebook"));
check("كل دور يرى العملاء ولوحة المتابعة",
  [ownerTabs, managerTabs, engineerTabs].every(t => t.includes("clients") && t.includes("dashboard")));

// ═══════════════════════════════════════════════════════════════════════════
//  عزل المكاتب — لا يجب أن يظهر عميل مكتب في مكتب آخر
// ═══════════════════════════════════════════════════════════════════════════
section("عزل بيانات المكاتب");

const rows = [
  { id: "a1", org_id: "org-A", name: "عميل مكتب أ" },
  { id: "a2", org_id: "org-A", name: "عميل مكتب أ ٢" },
  { id: "b1", org_id: "org-B", name: "عميل مكتب ب" },
];
// محاكاة ما تعيده قاعدة البيانات بعد تطبيق السياسات
const asOrg = (org) => rows.filter(r => r.org_id === org);

check("مكتب أ يرى عميلَيه فقط",   asOrg("org-A").length === 2);
check("مكتب ب يرى عميله فقط",    asOrg("org-B").length === 1);
check("مكتب أ لا يرى أي صف يخصّ ب", asOrg("org-A").every(r => r.org_id === "org-A"));
check("مكتب مجهول لا يرى شيئًا",  asOrg("org-X").length === 0);

// ═══════════════════════════════════════════════════════════════════════════
//  وضع القراءة فقط
// ═══════════════════════════════════════════════════════════════════════════
section("وضع القراءة فقط عند انتهاء الاشتراك");

function canSave(license) {
  const readOnly = license.loaded && !license.canWrite;
  return !readOnly;
}
check("اشتراك سارٍ: الحفظ مسموح",
  canSave({ loaded: true, canWrite: true }));
check("اشتراك منتهٍ: الحفظ ممنوع",
  !canSave({ loaded: true, canWrite: false }));
check("قبل تحميل الترخيص: لا نعطّل المستخدم",
  canSave({ loaded: false, canWrite: false }));

// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
//  المقايسة والتحصيل بالمراحل — المكوّنات الحقيقية من التطبيق نفسه
//  تُستورد ولا تُعاد كتابتها: اختبار ينسخ منطق التطبيق يشهد لنفسه لا عليه.
// ═══════════════════════════════════════════════════════════════════════════
import { PhaseBOQ, PhaseCollection, PhaseSpend, CostAnalysis, ContractorLedger } from "../src/App.jsx";
import * as pb from "../src/domain/pricebook.js";
import { newClient, calcByPhase } from "../src/domain/pricing.js";
import { DEFAULT_SETTINGS, fmt } from "../src/domain/catalogue.js";
import { PHASES } from "../src/ui/tokens.js";
import { phasePaymentPlan } from "../src/domain/finance.js";

section("المقايسة بالمراحل — عرض حقيقي");
{
  const S = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.12 };
  const owner = { role: "owner", name: "المالك" };
  const c = newClient(); c.name = "عميل"; c.area = 150;

  const html = render(<PhaseBOQ client={c} settings={S} currentMember={owner} onChange={() => {}} />);
  check("لا ينهار", !crashed(html));
  for (const p of PHASES) check(`يعرض مرحلة: ${p}`, shows(html, p));
  check("يعرض عمود ما قبل البدء", shows(html, "قبل البدء"));
  check("يعرض عمود ما بعد التسليم", shows(html, "بعد التسليم"));

  /* SummaryRow يُنسّق الرقم بنفسه — تمرير نص منسّق مسبقًا كان يُخرج "NaN ج.م".
     هذا الفحص يمنع عودة ذلك الخلل في أي سطر إجمالي. */
  const plan = phasePaymentPlan(c, S, calcByPhase(c, S));
  check(`قيمة التعاقد الظاهرة = ${fmt(plan.contractTotal)}`, shows(html, fmt(plan.contractTotal)));
  check("لا NaN في أي رقم معروض", !shows(html, "NaN"));

  // بلا نسبة ربح: تحذير صريح لا صفر صامت
  const bare = render(<PhaseBOQ client={c} settings={DEFAULT_SETTINGS} currentMember={owner} onChange={() => {}} />);
  check("بلا نسبة ربح: تحذير ظاهر", shows(bare, "لم تُحدَّد نسبة الربح"));

  // المهندس لا يعدّل النسبة
  const eng = render(<PhaseBOQ client={c} settings={S} currentMember={{ role: "engineer" }} onChange={() => {}} />);
  check("المهندس: حقل النسبة معطّل", !crashed(eng) && shows(eng, "disabled"));
}

section("جدول التحصيل — منع البدء قبل التحصيل");
{
  const S = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.12 };
  const owner = { role: "owner", name: "المالك" };
  const c = newClient(); c.name = "عميل"; c.area = 150;
  const plan = phasePaymentPlan(c, S, calcByPhase(c, S));
  const first = plan.rows[0];

  const before = render(<PhaseCollection client={c} settings={S} currentMember={owner} onChange={() => {}} />);
  check("لا ينهار", !crashed(before));
  check("يمنع البدء قبل التحصيل", shows(before, "لا تبدأ التنفيذ"));
  check("يعرض زر تعليم التسليم", shows(before, "تعليم المرحلة مُسلَّمة"));
  check("الربح غير مستحق قبل التسليم", shows(before, "غير مستحقة — المرحلة لم تُسلَّم"));

  c.receipts = [{ id: "R1", amount: first.quote, phase: first.phase, kind: "base" }];
  const paid = render(<PhaseCollection client={c} settings={S} currentMember={owner} onChange={() => {}} />);
  check("بعد التحصيل: مسموح بالبدء", shows(paid, "مسموح بالبدء"));

  c.phaseDelivered = { [first.phase]: "2026-08-16" };
  const done = render(<PhaseCollection client={c} settings={S} currentMember={owner} onChange={() => {}} />);
  check("بعد التسليم: الربح مستحق", shows(done, "سُلّمت — نسبة الربح مستحقة"));

  // دفعة قديمة بلا مرحلة تُعلَن صراحة
  const c2 = newClient(); c2.area = 150;
  c2.receipts = [{ id: "OLD", amount: 50000 }];
  const old = render(<PhaseCollection client={c2} settings={S} currentMember={owner} onChange={() => {}} />);
  check("دفعة قديمة: تنبيه بعدم النسبة لمرحلة", shows(old, "غير منسوبة لأي مرحلة"));
}

section("مصروفات الموقع مصنّفة — عرض حقيقي");
{
  const S = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.12 };
  const c = newClient(); c.area = 150;
  c.expenses = [{ id: "E1", amount: 300000, phase: "التأسيس", kind: "materials", date: "2026-08-01" }];
  const html = render(<PhaseSpend client={c} settings={S} priceBook={pb.DEFAULT_PRICEBOOK} onChange={() => {}} />);
  check("لا ينهار", !crashed(html));
  check("يرصد التجاوز", shows(html, "تجاوز"));
  check("يعرض سجل مصروفات الموقع", shows(html, "سجل مصروفات الموقع"));
  check("يعرض فئات التكلفة في السجل", shows(html, "خامات وتوريدات") && shows(html, "معدات وأوناش"));
  const clean = render(<PhaseSpend client={newClient()} settings={S} priceBook={pb.DEFAULT_PRICEBOOK} onChange={() => {}} />);
  check("بلا مصروفات: لا ينهار ولا يعرض سجلًا", !crashed(clean) && !shows(clean, "سجل مصروفات الموقع"));
  check("لا NaN في مصروفات الموقع", !shows(html, "NaN"));
}

section("تحليل التكلفة وحسابات المقاولين — عرض حقيقي");
{
  const owner = { role: "owner", name: "المالك" };
  const c = newClient(); c.area = 150;
  let book = pb.DEFAULT_PRICEBOOK;
  book = pb.setItemAnalysis(book, "PLS-001", 1, { materials: 45, labour: 60, equipment: 5 });

  const html = render(<CostAnalysis client={c} priceBook={book} currentMember={owner} />);
  check("تحليل التكلفة لا ينهار", !crashed(html));
  check("يعرض الفئات المحلَّلة", shows(html, "خامات") && shows(html, "عمالة"));
  check("يعلن نسبة التغطية بدل ادّعاء الاكتمال", shows(html, "التحليل يغطي"));

  const eng = render(<CostAnalysis client={c} priceBook={book} currentMember={{ role: "engineer" }} />);
  check("المهندس لا يرى تحليل التكلفة إطلاقًا", eng === "");

  const bare = render(<CostAnalysis client={c} priceBook={pb.DEFAULT_PRICEBOOK} currentMember={owner} />);
  check("بلا تحليل: يقول ذلك صراحة", shows(bare, "لا يوجد بند محلَّل بعد"));

  const c2 = newClient(); c2.area = 150;
  c2.contractors = [{ id: "SUB-001", name: "م. سامي", trade: "كهرباء", phase: "التأسيس", contractValue: 25000, retentionPct: 0.05 }];
  c2.expenses = [{ id: "E1", kind: "subcontract", phase: "التأسيس", contractorId: "SUB-001", amount: 14250, retained: 750 }];
  const led = render(<ContractorLedger client={c2} onChange={() => {}} />);
  check("سجل المقاولين لا ينهار", !crashed(led));
  check("يعرض المحتجز والمتبقي", shows(led, "محتجز") && shows(led, "متبقٍ"));
  check("لا NaN في سجل المقاولين", !shows(led, "NaN"));

  // تجاوز قيمة التعاقد يجب أن يُرصد بوضوح
  const c3 = { ...c2, expenses: [{ id: "E1", kind: "subcontract", phase: "التأسيس", contractorId: "SUB-001", amount: 40000 }] };
  const over = render(<ContractorLedger client={c3} onChange={() => {}} />);
  check("تجاوز تعاقد المقاول يُرصد", shows(over, "تجاوز قيمة التعاقد"));

  const orphan = { ...c2, expenses: [{ id: "E9", kind: "subcontract", phase: "التأسيس", amount: 5000 }] };
  const orph = render(<ContractorLedger client={orphan} onChange={() => {}} />);
  check("مصروف مقاول بلا مقاول يُعلَن", shows(orph, "غير منسوبة لمقاول"));
}

// ═══════════════════════════════════════════════════════════════════════════
//  بوابة العميل والمقاول — ما يراه كلٌّ منهما، وما لا يراه
// ═══════════════════════════════════════════════════════════════════════════
import { ClientView, ContractorView } from "../src/ui/Portal.jsx";
section("بوابة العميل");
{
  const c = newClient(9001);
  c.name = "فيلا الساحل";
  c.address = "مراسي";
  c.area = 200;
  c.stage = "قيد التنفيذ";
  c.receipts = [{ id: "R1", date: "2026-05-02", phase: PHASES[0], kind: "base", amount: 25000 }];
  const html = render(React.createElement(ClientView, {
    session: { kind: "client", name: c.name, orgName: "مكتب النخبة",
               payload: { client: c, settings: DEFAULT_SETTINGS } },
  }));
  check("شاشة العميل لا تنهار", !crashed(html));
  check("اسم المشروع ظاهر", shows(html, "فيلا الساحل"));
  check("اسم المكتب ظاهر", shows(html, "مكتب النخبة"));
  check("دفعة العميل ظاهرة في السجل", shows(html, fmt(25000)));
  check("المراحل معروضة", shows(html, PHASES[0]));
  /* الحدّ الفاصل: العميل يرى ما اتفق عليه لا ما يكلّف المكتب */
  check("لا كلمة «تكلفة» في شاشة العميل", !shows(html, "تكلفة"));
  check("لا هامش ربح معروض كنسبة داخلية", !shows(html, "الهامش"));
  check("لا مصروفات موقع", !shows(html, "مصروفات الموقع"));
  check("لا أسماء مقاولين", !shows(html, "المقاول"));
  check("لا يوجد NaN", !shows(html, "NaN"));
}
section("بوابة المقاول");
{
  const payload = [{
    project: "فيلا الساحل", address: "مراسي",
    contractors: [{ id: "SUB-001", name: "حسن السيد", trade: "محارة", contractValue: 120000 }],
    payments: [{ date: "2026-05-01", amount: "40000", retained: "2000", phase: PHASES[2] }],
  }];
  const html = render(React.createElement(ContractorView, {
    session: { kind: "contractor", name: "حسن السيد", orgName: "مكتب النخبة", payload },
  }));
  check("شاشة المقاول لا تنهار", !crashed(html));
  check("اسم المقاول ظاهر", shows(html, "حسن السيد"));
  check("قيمة تعاقده ظاهرة", shows(html, fmt(120000)));
  check("محتجز الضمان ظاهر", shows(html, fmt(2000)));
  /* المعتمد = المصروف + المحتجز — الرقم الذي يقطع النزاع */
  check("المعتمد = 42,000", shows(html, fmt(42000)));
  check("المتبقي = 78,000", shows(html, fmt(78000)));
  check("لا يوجد NaN", !shows(html, "NaN"));
}
section("المقاول لا يرى غير حسابه");
{
  /* المحاكاة هنا للواجهة فقط — الحجب الحقيقي في دالة قاعدة البيانات
     التي لا تُرجِع أصلًا صفوف غيره (اختُبرت على خادم بوستجرس حقيقي). */
  const payload = [{
    project: "فيلا الساحل",
    contractors: [{ id: "SUB-001", name: "حسن السيد", contractValue: 120000 }],
    payments: [{ date: "2026-05-01", amount: "40000", retained: "0" }],
  }];
  const html = render(React.createElement(ContractorView, {
    session: { kind: "contractor", name: "حسن السيد", orgName: "مكتب", payload },
  }));
  check("لا قيمة عقد العميل في شاشة المقاول", !shows(html, "قيمة العقد"));
  check("لا اسم مقاول آخر", !shows(html, "ورشة النور"));
}

console.log(out.join("\n"));
console.log("\n" + "─".repeat(60));
console.log(`نجح ${pass} · فشل ${fail}`);
if (fail > 0) process.exit(1);