import { useSyncExternalStore } from "react";

/* ════════════════════════════════════════════════════════════════════════
   طبقة اللغة — العربية أصلًا، والإنجليزية خيارًا
   ------------------------------------------------------------------------
   القرار الهندسي: المفتاح هو النص العربي نفسه، لا رمز مخترع مثل
   `clients.title`. السبب أن الأداة كُتبت كلها بالعربية أصلًا؛ فلو جعلنا
   المفتاح رمزًا لوجب تعديل آلاف السطور دفعة واحدة وكسر ما يعمل.
   بهذه الطريقة:
     • أي نص لم يُترجم بعد يظهر بالعربية بدل أن يظهر فارغًا أو برمز غريب.
     • إضافة ترجمة جديدة = سطر واحد في القاموس، بلا لمس الشاشات.

   الاتجاه (RTL/LTR) واللغة يُطبَّقان على عنصر <html> نفسه، فينقلب تخطيط
   الصفحة كاملًا تلقائيًا لأن التنسيقات تستخدم الخصائص المنطقية
   (inline-start/inline-end) لا اليمين واليسار الصريحين.
   ════════════════════════════════════════════════════════════════════════ */

const KEY = "boq_lang";
let current = "ar";
const listeners = new Set();

try {
  const saved = localStorage.getItem(KEY);
  if (saved === "en" || saved === "ar") current = saved;
} catch { /* التخزين المحلي قد يكون معطّلًا — العربية هي الافتراضي */ }

export function getLang() { return current; }

export function setLang(lang) {
  const next = lang === "en" ? "en" : "ar";
  if (next === current) return;
  current = next;
  try { localStorage.setItem(KEY, next); } catch {}
  applyDocumentLang();
  listeners.forEach(fn => fn());
}

export function applyDocumentLang() {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.setAttribute("lang", current);
  el.setAttribute("dir", current === "en" ? "ltr" : "rtl");
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* خطّاف اللغة — يعيد تصيير أي مكوّن يستدعيه عند التبديل */
export function useLang() {
  return useSyncExternalStore(subscribe, getLang, () => "ar");
}

export function dirOf(lang = current) { return lang === "en" ? "ltr" : "rtl"; }

/* الترجمة: النص العربي مفتاحًا */
export function t(ar) {
  if (current === "ar") return ar;
  const key = String(ar);
  return Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : ar;
}

/* خطّاف يعيد دالة الترجمة مرتبطة باللغة الحالية (للاستخدام داخل المكوّنات) */
export function useT() {
  useLang();
  return t;
}

/* العملة — رمزها يختلف بين اللغتين */
export function currency() { return current === "en" ? "EGP" : "ج.م"; }

/* ════════════════════════ القاموس ════════════════════════
   التغطية: هيكل الواجهة كاملًا، المراحل، الحالات، النطاقات،
   المستويات، الأزرار، ومصطلحات المال والمقايسة.
   بنود الكتالوج نفسها تبقى بالعربية حتى يضيف المكتب أسماءها
   الإنجليزية — وهي بيانات مكتب لا نصوص واجهة. */
export const EN = {
  /* الهيكل */
  "نظام متابعة العملاء والتسعير": "Client & Pricing System",
  "إدارة المكتب": "Office",
  "العملاء": "Clients",
  "المقاولون": "Contractors",
  "لوحة المتابعة": "Dashboard",
  "الإعدادات": "Settings",
  "الفريق": "Team",
  "الاشتراك": "Subscription",
  "لوحة الإدارة": "Admin",
  "دفتر الأسعار": "Price book",
  "مكتبة الموارد": "Resource library",
  "التقارير": "Reports",
  "الأقسام الرئيسية": "Main sections",
  "أقسام فرعية": "Sub-sections",

  /* الحالة والاتصال */
  "مزامنة سحابية مفعّلة": "Cloud sync on",
  "محلي (بدون مزامنة)": "Local only",
  "وضع تجريبي مبسط (بدون صلاحيات)": "Demo mode",
  "تبديل": "Switch",
  "خروج": "Sign out",
  "العربية": "العربية",
  "English": "English",

  /* المراحل */
  "التصميم والتسعير المبدئي": "Design & initial pricing",
  "التعديلات المعمارية": "Architectural alterations",
  "التأسيس": "First fix",
  "التشطيب النهائي": "Final finishes",
  "الفرش والأثاث": "Furniture & FF&E",
  "التصميم": "Design",
  "التعديلات": "Alterations",
  "التشطيب": "Finishes",
  "الفرش": "FF&E",
  "المرحلة": "Phase",
  "المراحل": "Phases",

  /* الحالات */
  "عميل محتمل": "Lead",
  "قيد التصميم": "In design",
  "تم التعاقد": "Contracted",
  "قيد التنفيذ": "In construction",
  "تم التسليم": "Delivered",

  /* النطاقات */
  "تصميم": "Design",
  "تعديلات معمارية (هدم وبناء)": "Alterations (demolition & building)",
  "التشطيبات المعمارية والتنفيذ": "Architectural finishes",
  "الكهرباء": "Electrical",
  "السباكة والتكييف": "Plumbing & HVAC",

  /* المستويات */
  "اقتصادي": "Economy",
  "متوسط": "Standard",
  "لوكس": "Premium",
  "سوبر لوكس": "Signature",

  /* بطاقة المشروع */
  "المساحة": "Area",
  "المهندس": "Architect",
  "المهندس المسؤول": "Lead architect",
  "الإنجاز": "Progress",
  "العنوان": "Location",
  "بدون عنوان": "No location",
  "بدون اسم": "Untitled",
  "تقديري": "Estimate",
  "متعاقد": "Contracted",
  "العميل": "Client",
  "المشروع": "Project",
  "الحالة": "Status",
  "التاريخ": "Date",
  "أضف صورة المشروع": "Add project image",
  "صورة الغلاف": "Cover image",
  "رفع صورة": "Upload image",

  /* الأفعال */
  "عميل جديد": "New project",
  "عميل فارغ": "Blank project",
  "إضافة": "Add",
  "حفظ": "Save",
  "إلغاء": "Cancel",
  "حذف": "Delete",
  "تعديل": "Edit",
  "إغلاق": "Close",
  "تصدير": "Export",
  "طباعة": "Print",
  "رجوع": "Back",
  "بحث": "Search",
  "تأكيد": "Confirm",
  "تحديث": "Refresh",
  "نسخ": "Copy",

  /* الفرز والتصفية */
  "كل المراحل": "All stages",
  "الأحدث أولاً": "Newest first",
  "الأقدم أولاً": "Oldest first",
  "الأعلى قيمة": "Highest value",
  "الأقل قيمة": "Lowest value",
  "الاسم (أ-ي)": "Name (A–Z)",
  "بحث بالاسم أو المهندس المسؤول...": "Search by project or architect…",

  /* المال */
  "الإجمالي": "Total",
  "إجمالي العملاء": "Projects",
  "إجمالي قيمة خط الأعمال": "Pipeline value",
  "قيمة العقد": "Contract value",
  "المحصّل": "Collected",
  "المتبقي": "Outstanding",
  "المستحق الآن": "Due now",
  "الربح": "Profit",
  "نسبة الربح": "Profit margin",
  "المصروفات": "Expenses",
  "الدفعات": "Payments",
  "الحساب الجاري": "Current account",
  "المقايسة": "Bill of quantities",
  "مقايسة المرحلة": "Phase BOQ",
  "تحليل الأسعار": "Price analysis",
  "مصروفات الموقع": "Site expenses",
  "الخامات": "Materials",
  "العمالة": "Labour",
  "مقاولو الباطن": "Subcontractors",
  "المعدات": "Equipment",
  "أخرى": "Other",
  "الكمية": "Quantity",
  "الوحدة": "Unit",
  "سعر الوحدة": "Unit rate",
  "البند": "Item",
  "الوصف": "Description",
  "الإشراف": "Supervision",
  "الطوارئ": "Contingency",
  "ضريبة القيمة المضافة": "VAT",

  /* حالات فارغة */
  "لا يوجد بيانات بعد": "No data yet",
  "لا يوجد عملاء بعد": "No projects yet",
  "لا يوجد عملاء بعد. اضغط \"عميل جديد\" للبدء.": "No projects yet — press “New project” to begin.",
  "لا يوجد عملاء مطابقين لهذا البحث/الفلتر.": "No projects match this search.",
  "أحدث العملاء": "Recent projects",
  "نظرة عامة على خط العملاء": "Pipeline overview",
  "مشاريع المكتب — اضغط أي مشروع لفتح تفاصيله": "Office projects — select one to open it",
  "قيمة خط الأعمال حسب المرحلة": "Pipeline value by stage",
  "نمو خط الأعمال آخر 6 أشهر": "Pipeline growth · last 6 months",
  "توزيع خط الأعمال حسب المرحلة (بعدد العملاء)": "Pipeline distribution by stage",
  "جاري التحميل…": "Loading…",
};
