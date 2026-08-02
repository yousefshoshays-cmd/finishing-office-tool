import { ROOM_TYPES, DEFAULT_CEILING_H } from "./rooms.js";

/* ════════════════════════════════════════════════════════════════
   استيراد جدول الغرف من نموذج BIM

   لماذا لا محرر ثلاثي الأبعاد داخل الأداة؟ لأن Revit و SketchUp
   يفعلان ذلك أفضل بمراحل، وبناء نسخة فقيرة منهما يعني أداة تُستخدم
   مرة ثم تُهجر. الفجوة ليست في الرسم، بل في أن جدول الغرف (Room
   Schedule) الذي أنتجه النموذج يُعاد إدخاله يدويًا في المقايسة.

   هذا الملف يجسر تلك الفجوة: صدّر Room Schedule من Revit إلى CSV
   أو Excel، واستورده هنا. أسماء الأعمدة تُتعرَّف بالعربية والإنجليزية
   لأن مخرجات Revit إنجليزية غالبًا بينما جداول المكتب عربية.
   ════════════════════════════════════════════════════════════════ */

/* مرادفات أسماء الأعمدة — مطبّعة بحروف صغيرة وبلا مسافات */
const COLUMN_ALIASES = {
  name:   ["name", "roomname", "room", "الاسم", "اسمالغرفة", "الغرفة", "المساحةاسم"],
  type:   ["type", "roomtype", "department", "النوع", "نوعالغرفة", "التصنيف"],
  area:   ["area", "roomarea", "المساحة", "مساحة", "المساحةم2", "sqm"],
  length: ["length", "الطول", "طول"],
  width:  ["width", "العرض", "عرض"],
  height: ["height", "unboundedheight", "ceilingheight", "الارتفاع", "ارتفاع"],
  count:  ["count", "qty", "quantity", "العدد", "الكمية"],
};

/* تخمين نوع الغرفة من اسمها — Revit يسمّي "Bathroom 1" لا "حمام" */
const TYPE_HINTS = [
  [/حمام|toilet|bath|wc|رطب/i, "حمام"],
  [/مطبخ|kitchen/i, "مطبخ"],
  [/صال|living|reception|لوبي/i, "صالة"],
  [/ريسبشن/i, "ريسبشن"],
  [/نوم|bed|master/i, "غرفة نوم"],
  [/ممر|corridor|hall|passage/i, "ممر"],
  [/بلكون|balcon|terrace|تراس/i, "بلكونة"],
];

export function normalizeHeader(h) {
  return String(h ?? "").toLowerCase().replace(/[\s_\-()]/g, "").replace(/م²|m2|m²/g, "");
}

export function mapColumns(headers) {
  const norm = headers.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = norm.findIndex(h => aliases.some(a => h === a || h.includes(a)));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

export function guessType(name, declared) {
  if (declared && ROOM_TYPES[String(declared).trim()]) return String(declared).trim();
  const hay = `${declared || ""} ${name || ""}`;
  for (const [re, type] of TYPE_HINTS) if (re.test(hay)) return type;
  return "غرفة نوم";   // الافتراض الأكثر شيوعًا وأقلها ضررًا (جاف، بسكيرتنج)
}

function num(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/* الصفوف مصفوفة مصفوفات، أولها العناوين */
export function parseSchedule(rows) {
  const warnings = [];
  if (!rows || rows.length < 2) {
    return { rooms: [], warnings: ["الملف فارغ أو لا يحوي صفوف بيانات"], mapped: {} };
  }

  const headers = rows[0];
  const map = mapColumns(headers);

  if (map.name == null) warnings.push("لم يُعثر على عمود اسم الغرفة — ستُرقَّم تلقائيًا");
  if (map.area == null && (map.length == null || map.width == null)) {
    return {
      rooms: [], mapped: map,
      warnings: ["لا يوجد عمود مساحة ولا (طول وعرض) — لا يمكن اشتقاق الكميات"],
    };
  }

  const rooms = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c == null || String(c).trim() === "")) continue;

    const name = map.name != null ? String(r[map.name] ?? "").trim() : "";
    const declared = map.type != null ? r[map.type] : "";
    let length = map.length != null ? num(r[map.length]) : 0;
    let width = map.width != null ? num(r[map.width]) : 0;
    const area = map.area != null ? num(r[map.area]) : 0;

    /* Revit يصدّر المساحة غالبًا دون الأبعاد. نشتق أبعادًا مكافئة
       لغرفة مربعة — المساحة تبقى دقيقة، والمحيط تقريبي. نُعلن ذلك. */
    let derived = false;
    if ((!length || !width) && area > 0) {
      length = width = Math.sqrt(area);
      derived = true;
    }
    if (!(length > 0 && width > 0)) { skipped++; continue; }

    const count = map.count != null ? Math.max(1, num(r[map.count]) || 1) : 1;
    const height = map.height != null && num(r[map.height]) > 0 ? num(r[map.height]) : DEFAULT_CEILING_H;

    rooms.push({
      id: `imp-${i}`,
      name: name || `غرفة ${rooms.length + 1}`,
      type: guessType(name, declared),
      length: Math.round(length * 100) / 100,
      width: Math.round(width * 100) / 100,
      height,
      count,
      derivedDimensions: derived,
    });
  }

  if (skipped) warnings.push(`${skipped} صفًا بلا مساحة صالحة — تم تجاهلها`);
  const derivedCount = rooms.filter(r => r.derivedDimensions).length;
  if (derivedCount) {
    warnings.push(`${derivedCount} غرفة بلا أبعاد — اشتُقّت من المساحة كغرفة مربعة. المساحات دقيقة، لكن راجع أطوال السكيرتنج.`);
  }
  const guessedTypes = rooms.filter(r => map.type == null).length;
  if (guessedTypes) warnings.push(`أنواع الغرف مستنتَجة من الأسماء — راجعها قبل التطبيق`);

  return { rooms, warnings, mapped: map };
}

/* CSV بسيط يدعم الحقول المقتبسة والفواصل داخلها */
export function parseCSV(text) {
  const clean = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length);
}
