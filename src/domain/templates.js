import { SCOPES, LEVELS } from "../ui/tokens.js";
import { newClient } from "./pricing.js";

/* ============================= قوالب المشاريع =============================
   أغلب مشاريع المكتب متشابهة. ضبط 40 بندًا يدويًا في كل مرة إهدار،
   ومصدر تفاوت بين مقايسة وأخرى لنفس نوع العمل.

   القالب يحدد مستوى كل نطاق وما يُضمَّن، ويُنشئ مقايسة كاملة فورًا. */

export const TEMPLATES = [
  {
    id: "apt-mid",
    name: "شقة سكنية — تشطيب متوسط",
    area: 150,
    levels: { "تصميم": "متوسط", "تعديلات معمارية (هدم وبناء)": "متوسط",
              "التشطيبات المعمارية والتنفيذ": "متوسط", "الكهرباء": "متوسط",
              "السباكة والتكييف": "متوسط", "الفرش والأثاث": "اقتصادي" },
    exclude: ["الفرش والأثاث"],
  },
  {
    id: "apt-lux",
    name: "شقة سكنية — تشطيب لوكس",
    area: 200,
    levels: { "تصميم": "لوكس", "تعديلات معمارية (هدم وبناء)": "لوكس",
              "التشطيبات المعمارية والتنفيذ": "لوكس", "الكهرباء": "لوكس",
              "السباكة والتكييف": "لوكس", "الفرش والأثاث": "لوكس" },
    exclude: [],
  },
  {
    id: "villa",
    name: "فيلا — سوبر لوكس",
    area: 400,
    levels: Object.fromEntries(SCOPES.map(s => [s, "سوبر لوكس"])),
    exclude: [],
  },
  {
    id: "office",
    name: "مكتب إداري",
    area: 120,
    levels: { "تصميم": "متوسط", "تعديلات معمارية (هدم وبناء)": "اقتصادي",
              "التشطيبات المعمارية والتنفيذ": "متوسط", "الكهرباء": "لوكس",
              "السباكة والتكييف": "اقتصادي", "الفرش والأثاث": "متوسط" },
    exclude: [],
  },
  {
    id: "design-only",
    name: "تصميم فقط (بدون تنفيذ)",
    area: 150,
    levels: Object.fromEntries(SCOPES.map(s => [s, "لوكس"])),
    exclude: SCOPES.filter(s => s !== "تصميم"),
  },
];

export function clientFromTemplate(tpl) {
  const c = newClient();
  c.area = tpl.area;
  c.templateId = tpl.id;
  c.scopeLevel = Object.fromEntries(SCOPES.map(s => [s, tpl.levels[s] || "متوسط"]));
  c.scopeIncluded = Object.fromEntries(SCOPES.map(s => [s, !tpl.exclude.includes(s)]));
  return c;
}

/* التحقق من سلامة القوالب — يمنع قالبًا بمستوى غير موجود من المرور بصمت */
export function validateTemplate(tpl) {
  const errors = [];
  for (const s of SCOPES) {
    const lv = tpl.levels[s];
    if (lv && !LEVELS.includes(lv)) errors.push(`مستوى غير معروف "${lv}" في "${s}"`);
  }
  for (const s of tpl.exclude) if (!SCOPES.includes(s)) errors.push(`نطاق غير معروف "${s}"`);
  if (!(tpl.area > 0)) errors.push("مساحة غير صالحة");
  return errors;
}
