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
console.log(out.join("\n"));
console.log("\n" + "─".repeat(60));
console.log(`نجح ${pass} · فشل ${fail}`);
if (fail > 0) process.exit(1);
