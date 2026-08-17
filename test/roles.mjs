/* ============================================================================
   اختبار الأدوار والصلاحيات
   ----------------------------------------------------------------------------
   يشغّل منطق الصلاحيات على كل دور ويتحقّق مما يُسمح به وما يُمنع.
   الغرض: ألّا نكتشف أن مهندسًا يستطيع حذف عميل بعد أن يفعلها في مكتب زبون.
   يعمل بلا متصفح، فيمكن تشغيله في أي وقت: npm run test:roles
   ========================================================================== */

import { can, PERMISSIONS, ROLES, roleLabel } from "../src/domain/permissions.js";
import { licenseNotice } from "../src/data/license.js";
import { orgHealth, activityNote } from "../src/data/admin.js";

let pass = 0, fail = 0;
const results = [];

function check(desc, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  results.push(`${ok ? "✅" : "❌"} ${desc}${ok ? "" : `  (توقّعنا ${expected} فجاء ${actual})`}`);
}

function section(t) { results.push(`\n── ${t} ──`); }

const owner    = { role: "owner",    name: "المالك" };
const manager  = { role: "manager",  name: "مدير مشاريع" };
const engineer = { role: "engineer", name: "مهندس" };
const pending  = { role: "pending",  name: "بانتظار الموافقة" };
const anon     = null;

// ═══════════════════════════════════════════════════════════════════════════
section("المالك — صلاحيات كاملة");
for (const action of Object.keys(PERMISSIONS)) {
  check(`المالك يستطيع: ${action}`, can(owner, action), true);
}

// ═══════════════════════════════════════════════════════════════════════════
section("مدير المشاريع — كل شيء عدا الحذف وإدارة الفريق");
check("يرى كل العملاء",        can(manager, "viewAllClients"), true);
check("يعدّل سعر الوحدة",      can(manager, "editUnitPrice"),  true);
check("يرى أساس التكلفة",      can(manager, "viewCostBasis"),  true);
check("ينقل لمرحلة التعاقد",   can(manager, "advanceToSigned"), true);
check("لا يحذف عميلًا",        can(manager, "deleteClient"),   false);
check("لا يدير الفريق",        can(manager, "manageTeam"),     false);

// ═══════════════════════════════════════════════════════════════════════════
section("المهندس — عملاؤه فقط، وبلا أسعار التكلفة");
check("لا يرى كل العملاء",     can(engineer, "viewAllClients"), false);
check("لا يعدّل سعر الوحدة",   can(engineer, "editUnitPrice"),  false);
check("لا يرى أساس التكلفة",   can(engineer, "viewCostBasis"),  false);
check("لا ينقل لمرحلة التعاقد", can(engineer, "advanceToSigned"), false);
check("لا يحذف عميلًا",        can(engineer, "deleteClient"),   false);
check("لا يدير الفريق",        can(engineer, "manageTeam"),     false);
check("يعدّل بيانات العميل",   can(engineer, "editClientData"), true);
check("يسجّل زيارة موقع",      can(engineer, "logSiteVisit"),   true);

// ═══════════════════════════════════════════════════════════════════════════
section("بانتظار الموافقة — لا شيء إطلاقًا");
for (const action of Object.keys(PERMISSIONS)) {
  check(`ممنوع: ${action}`, can(pending, action), false);
}

// ═══════════════════════════════════════════════════════════════════════════
section("بلا هوية — لا شيء إطلاقًا");
for (const action of Object.keys(PERMISSIONS)) {
  check(`ممنوع: ${action}`, can(anon, action), false);
}

// ═══════════════════════════════════════════════════════════════════════════
section("حالات ملتوية");
check("دور مخترع لا يُمنح شيئًا", can({ role: "superadmin" }, "deleteClient"), false);
check("إجراء غير معرّف يُرفض",    can(owner, "dropDatabase"), false);
check("كائن فارغ يُرفض",          can({}, "editClientData"), false);
check("دور فارغ يُرفض",           can({ role: "" }, "editClientData"), false);
check("دور null يُرفض",           can({ role: null }, "editClientData"), false);
check("كل الأدوار لها مسمّى",     Object.keys(ROLES).every(r => !!roleLabel(r)), true);

// ═══════════════════════════════════════════════════════════════════════════
section("بوابة الترخيص");
const lic = (o) => ({ loaded: true, status: "trial", canWrite: true, daysLeft: 14, ...o });

check("تجربة طويلة: تنبيه معلوماتي",
  licenseNotice(lic({ daysLeft: 14 }))?.tone, "info");
check("تجربة تقارب الانتهاء: تحذير",
  licenseNotice(lic({ daysLeft: 5 }))?.tone, "warn");
check("تجربة على وشك الانتهاء: إنذار",
  licenseNotice(lic({ daysLeft: 2 }))?.tone, "error");
check("اشتراك منتهٍ: إنذار",
  licenseNotice(lic({ canWrite: false, status: "expired" }))?.tone, "error");
check("مكتب موقوف: إنذار",
  licenseNotice(lic({ status: "suspended", canWrite: false }))?.tone, "error");
check("اشتراك سارٍ طويل: بلا تنبيه",
  licenseNotice(lic({ status: "active", daysLeft: 25 })), null);
check("الوضع المحلي: بلا تنبيه",
  licenseNotice({ loaded: true, status: "local" }), null);
check("قبل التحميل: بلا تنبيه",
  licenseNotice({ loaded: false }), null);

// ═══════════════════════════════════════════════════════════════════════════
section("تصنيف المكاتب في لوحة الإدارة");
check("موقوف",        orgHealth({ status: "suspended", daysLeft: 20 }).key, "suspended");
check("منتهٍ",         orgHealth({ status: "active", daysLeft: 0 }).key,    "expired");
check("عاجل (٣ أيام)", orgHealth({ status: "active", daysLeft: 2 }).key,    "urgent");
check("تجربة",         orgHealth({ status: "trial", daysLeft: 10 }).key,    "trial");
check("مشترك",         orgHealth({ status: "active", daysLeft: 20 }).key,   "active");
check("الإيقاف يتقدّم على الأيام المتبقية",
  orgHealth({ status: "suspended", daysLeft: 300 }).tone, "danger");

section("مؤشّر النشاط");
check("لم يبدأ", activityNote({ lastActive: null }), "لم يبدأ الاستخدام");
check("نشط اليوم", activityNote({ lastActive: new Date().toISOString() }), "نشط اليوم");
check("خامل طويلًا",
  activityNote({ lastActive: new Date(Date.now() - 40 * 86400000).toISOString() }),
  "خامل 40 يومًا");

// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
//  حارس ضد تسريب البيانات بين المكاتب
//  يفحص ملفات الهجرة نفسها: أي سياسة على جدول حسّاس لا تذكر my_org()
//  هي باب مفتوح. هذا العطل حدث فعلًا مرة، ولن يمرّ ثانية.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from "fs";

section("حارس العزل بين المكاتب");

/* الملف مُسمّى صراحة لا "آخر ملف أبجديًا": إضافة هجرة 010 لأي ميزة
   كانت ستجعلها هي "الأخيرة" فيفشل هذا الحارس وهو سليم، أو الأسوأ —
   ينجح على ملف لا علاقة له بالسياسات فيعطي طمأنينة كاذبة. */
const migDir = "migrations/";
const AUTHORITATIVE = "ALL_IN_ONE.sql";
const files = readdirSync(migDir).filter(f => f.endsWith(".sql"));
check("ملف الهجرة المرجعي موجود", files.includes(AUTHORITATIVE), true);
const finalSql = readFileSync(migDir + AUTHORITATIVE, "utf8");

check("آخر هجرة تمسح كل السياسات القديمة ديناميكيًا",
  /drop policy if exists %I/.test(finalSql) && /pg_policies/.test(finalSql), true);
check("آخر هجرة تعيد بناء سياسة kv مقيّدة بالمكتب",
  /kv_read_own_org[\s\S]*my_org\(\)/.test(finalSql), true);
check("الكتابة في kv تتطلب ترخيصًا ساريًا",
  /kv_write_own_org[\s\S]*org_can_write\(\)/.test(finalSql), true);
check("عمود org_id في kv إلزامي",
  /alter table kv\s+alter column org_id set not null/.test(finalSql), true);
check("الصور معزولة بمجلد المكتب",
  /photos_read_own_org[\s\S]*foldername/.test(finalSql), true);
check("توجد دالة فحص تسريب", /function public\.leak_check/.test(finalSql), true);

const app = readFileSync("src/App.jsx", "utf8");
check("تسجيل الخروج يمسح ذاكرة المكتب", /clearOrgCache\(\)/.test(app), true);
check("تسجيل الخروج يفرّغ قائمة العملاء", /clearOrgCache\(\)[\s\S]{0,200}setClients\(\[\]\)/.test(app), true);

const photos = readFileSync("src/data/photos.js", "utf8");
check("مسار الصور يبدأ بمعرّف المكتب", /\$\{orgId\}\/\$\{clientId\}/.test(photos), true);

console.log(results.join("\n"));
console.log("\n" + "─".repeat(60));
console.log(`نجح ${pass} · فشل ${fail}`);
if (fail > 0) process.exit(1);
