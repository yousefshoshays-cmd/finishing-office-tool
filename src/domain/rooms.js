/* ============================= جدول الغرف =============================
   المعماري لا يفكر بـ"إجمالي المساحة" — يفكر بالغرف. والكميات تأتي من
   المخطط لا من التخمين: أرضيات الصالة من مساحتها، وسيراميك الحمام من
   محيطه × الارتفاع، والسكيرتنج من محيط الغرف الجافة.

   إدخال الغرف مرة واحدة يجعل تغيير مساحة غرفة يحدّث المقايسة كلها. */

export const ROOM_TYPES = {
  "صالة":      { wet: false, skirting: true,  ceiling: true },
  "غرفة نوم":  { wet: false, skirting: true,  ceiling: true },
  "مطبخ":      { wet: true,  skirting: false, ceiling: true },
  "حمام":      { wet: true,  skirting: false, ceiling: true },
  "ريسبشن":    { wet: false, skirting: true,  ceiling: true },
  "ممر":       { wet: false, skirting: true,  ceiling: false },
  "بلكونة":    { wet: true,  skirting: false, ceiling: false },
};

export const DEFAULT_CEILING_H = 2.9;

export function newRoom(seq) {
  return {
    id: `R-${String(seq).padStart(2, "0")}`,
    name: "",
    type: "غرفة نوم",
    length: 4,
    width: 3.5,
    height: DEFAULT_CEILING_H,
    count: 1,
  };
}

export function roomMetrics(r) {
  const L = Number(r.length) || 0, W = Number(r.width) || 0;
  const H = Number(r.height) || DEFAULT_CEILING_H;
  const n = Math.max(1, Number(r.count) || 1);
  const area = L * W * n;
  const perimeter = 2 * (L + W) * n;
  return { area, perimeter, wallArea: perimeter * H, height: H, count: n };
}

/* الكميات المشتقة من الجدول كله.
   تُستخدم كاقتراح يملأ حقول الكميات — لا تفرض نفسها على تجاوز يدوي قائم. */
export function deriveQuantities(rooms) {
  let floorArea = 0, wetWallArea = 0, dryPerimeter = 0, ceilingArea = 0;
  let wallArea = 0;                       // كل الحوائط: رطبة وجافة — أساس المحارة والدهان
  let bathrooms = 0, totalRooms = 0;

  for (const r of rooms || []) {
    const t = ROOM_TYPES[r.type] || ROOM_TYPES["غرفة نوم"];
    const m = roomMetrics(r);
    floorArea += m.area;
    totalRooms += m.count;
    wallArea += m.wallArea;
    if (t.ceiling) ceilingArea += m.area;
    if (t.wet) wetWallArea += m.wallArea;
    if (t.skirting) dryPerimeter += m.perimeter;
    if (r.type === "حمام") bathrooms += m.count;
  }

  return {
    floorArea:    round2(floorArea),
    wallArea:     round2(wallArea),
    plasterArea:  round2(wallArea + ceilingArea),   // محارة الحوائط + بياض الأسقف
    wetWallArea:  round2(wetWallArea),
    dryPerimeter: round2(dryPerimeter),
    ceilingArea:  round2(ceilingArea),
    bathrooms,
    totalRooms,
  };
}

/* ربط الكميات المشتقة ببنود بعينها.
   المفتاح كود البند الثابت — لهذا كان إصلاح المعرّفات شرطًا لهذه الميزة. */
export const QUANTITY_MAP = {
  "FIN-001": (d) => d.floorArea,       // أرضيات بورسلين/سيراميك
  "FIN-002": (d) => d.wetWallArea,     // سيراميك حوائط الحمامات والمطبخ
  "FIN-003": (d) => d.dryPerimeter,    // وزرة / سكيرتنج
  "FIN-004": (d) => d.ceilingArea,     // أسقف جبس بورد
  "STR-005": (d) => d.wetWallArea > 0 ? d.floorArea * 0.18 : 0,  // عزل مائي
  "PLS-001": (d) => d.plasterArea,     // محارة الحوائط + بياض الأسقف
  "FIN-006": (d) => d.plasterArea,     // الدهانات: نفس السطح المُحضَّر
};

export function suggestedQuantities(rooms) {
  const d = deriveQuantities(rooms);
  const out = {};
  for (const [id, fn] of Object.entries(QUANTITY_MAP)) {
    const v = fn(d);
    if (v > 0) out[id] = round2(v);
  }
  return out;
}

/* يطبّق الاقتراحات دون أن يدهس تجاوزًا أدخله المستخدم بنفسه،
   إلا إذا طلب ذلك صراحة (force). */
export function applySuggestions(client, rooms, { force = false } = {}) {
  const sug = suggestedQuantities(rooms);
  const items = { ...(client.items || {}) };
  const applied = [], skipped = [];
  for (const [id, qty] of Object.entries(sug)) {
    const rec = { ...(items[id] || {}) };
    if (rec.qty !== undefined && !force) { skipped.push(id); continue; }
    rec.qty = qty;
    rec.qtyFromRooms = true;
    items[id] = rec;
    applied.push(id);
  }
  return { client: { ...client, items }, applied, skipped };
}

function round2(n) { return Math.round(n * 100) / 100; }
