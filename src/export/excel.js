let _ExcelJS = null;
const ExcelJSLib = async () => (_ExcelJS ||= await import("exceljs"));
/* file-saver يُحمَّل عند الحفظ فقط: يلمس window عند الاستيراد، فاستيراده
   في المستوى الأعلى كان يمنع اختبار بناء الملف خارج المتصفح. */
const saveAs = async (...a) => (await import("file-saver")).saveAs(...a);
import { ITEMS, SPECS, fmt, DEFAULT_SETTINGS } from "../domain/catalogue.js";
import { resolveItem, calcClient, calcByPhase } from "../domain/pricing.js";
import { phasePaymentPlan, phaseBudget, plannedVsActual, contractorLedger, itemActualCost } from "../domain/finance.js";
import { catalogueWithCustom, costAnalysis, DEFAULT_PRICEBOOK } from "../domain/pricebook.js";
import { COST_KINDS, KIND_LABEL, KIND_SHORT } from "../domain/costing.js";
import { LEVELS, SCOPES, STAGES, PHASES } from "../ui/tokens.js";


export const XL_NAVY = "FF1F4E78";
export const XL_GOLD = "FFBF9000";
export const XL_LIGHT = "FFF5F7FA";
export const XL_WHITE = "FFFFFFFF";
export const XL_BORDER_COLOR = "FFD8DEE7";
export const xlThinBorder = { style: "thin", color: { argb: XL_BORDER_COLOR } };
export const xlAllBorders = { top: xlThinBorder, bottom: xlThinBorder, left: xlThinBorder, right: xlThinBorder };

export function xlHeaderCell(cell, text) {
  cell.value = text;
  cell.font = { name: "Arial", bold: true, color: { argb: XL_WHITE }, size: 11 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = xlAllBorders;
}
export function xlDataCell(cell, value, opts = {}) {
  cell.value = value;
  cell.font = { name: "Arial", bold: !!opts.bold, color: { argb: opts.color || "FF1F2937" }, size: 10.5 };
  if (opts.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
  cell.alignment = { horizontal: opts.align || "right", vertical: "middle", wrapText: true };
  cell.border = xlAllBorders;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}
export async function saveWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer();
  await saveAs(new Blob([buffer], { type: "application/octet-stream" }), filename);
}

const PHASE_FILL = {
  "التصميم والتسعير المبدئي": "FF7030A0",
  "التعديلات المعمارية": "FF833C00",
  "التأسيس": "FF0B5394",
  "التشطيب النهائي": "FF1F4E78",
  "الفرش والأثاث": "FF38761D",
};

/* عنوان صفحة موحّد لكل ورقة */
function xlSheetTitle(ws, lastCol, title, subtitle) {
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell("A1");
  t.value = title;
  t.font = { name: "Arial", bold: true, size: 15, color: { argb: XL_WHITE } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell("A2");
  s.value = subtitle;
  s.font = { name: "Arial", italic: true, size: 10, color: { argb: "FF6B7280" } };
  s.alignment = { horizontal: "center" };
}

/* سطر إجمالي ممتد: التسمية يمين والقيمة يسار */
function xlTotalRow(ws, r, labelSpan, valueSpan, label, value, opts = {}) {
  ws.mergeCells(`${labelSpan[0]}${r}:${labelSpan[1]}${r}`);
  const lc = ws.getCell(`${labelSpan[0]}${r}`);
  lc.value = label;
  lc.font = { name: "Arial", bold: true, size: opts.size || 11, color: { argb: opts.textColor || "FF1F4E78" } };
  if (opts.fill) lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
  lc.alignment = { horizontal: "right", vertical: "middle", indent: 1 };

  ws.mergeCells(`${valueSpan[0]}${r}:${valueSpan[1]}${r}`);
  const vc = ws.getCell(`${valueSpan[0]}${r}`);
  vc.value = typeof value === "number" ? Math.round(value) : value;
  if (typeof value === "number") vc.numFmt = '#,##0 "ج.م"';
  vc.font = { name: "Arial", bold: true, size: opts.size || 11, color: { argb: opts.textColor || "FF1F2937" } };
  if (opts.fill) vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
  vc.alignment = { horizontal: "center", vertical: "middle" };
  if (opts.height) ws.getRow(r).height = opts.height;
}

/* ═══════════ ورقة ١: المقايسة موزّعة على المراحل الخمس ═══════════ */
function sheetBOQ(wb, client, settings, byPhase, calc) {
  const ws = wb.addWorksheet("المقايسة بالمراحل", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 4 }, { width: 38 }, { width: 24 }, { width: 9 }, { width: 9 },
    { width: 12 }, { width: 12 }, { width: 9 }, { width: 14 }, { width: 32 },
  ];

  xlSheetTitle(ws, "J",
    `المقايسة التفصيلية بالمراحل — ${client.name || "عميل"}`,
    `العنوان: ${client.address || "—"}    |    المساحة: ${client.area} م²    |    التاريخ: ${new Date().toLocaleDateString("ar-EG")}    |    * = بند بمستوى/كمية/سعر مخصص يدويًا`);

  const headerRow = 4;
  ["م", "البند", "النطاق", "الوحدة", "الكمية", "المستوى المطبق", "سعر الوحدة", "مُضمَّن؟", "الإجمالي (ج.م)", "المواصفة / النوع المقترح"]
    .forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 22;

  let r = headerRow + 1;
  let idx = 1;

  byPhase.phases.forEach((p, pi) => {
    // ترويسة المرحلة
    ws.mergeCells(`A${r}:J${r}`);
    const hc = ws.getCell(`A${r}`);
    hc.value = `المرحلة ${pi + 1} — ${p.phase}`;
    hc.font = { name: "Arial", bold: true, size: 12, color: { argb: XL_WHITE } };
    hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PHASE_FILL[p.phase] || XL_NAVY } };
    hc.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    ws.getRow(r).height = 22;
    r++;

    p.lines.forEach((res) => {
      const fill = idx % 2 ? XL_WHITE : XL_LIGHT;
      const spec = SPECS[res.name] ? SPECS[res.name][res.levelIdx] : "—";
      const starred = res.isCustomLevel || res.hasQtyOverride || res.hasPriceOverride;
      const row = ws.getRow(r);
      xlDataCell(row.getCell(1), idx, { fill, align: "center" });
      xlDataCell(row.getCell(2), res.name + (starred ? " *" : ""), { fill });
      xlDataCell(row.getCell(3), res.scope, { fill, color: "FF6B7280" });
      xlDataCell(row.getCell(4), res.unit, { fill, align: "center" });
      xlDataCell(row.getCell(5), Math.round(res.qty * 100) / 100, { fill, align: "center" });
      xlDataCell(row.getCell(6), res.level, { fill, align: "center" });
      xlDataCell(row.getCell(7), res.price, { fill, align: "center", numFmt: "#,##0" });
      xlDataCell(row.getCell(8), res.included ? "نعم" : "لا", { fill, align: "center", bold: true, color: res.included ? "FF1E7B45" : "FFC00000" });
      xlDataCell(row.getCell(9), Math.round(res.total), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
      xlDataCell(row.getCell(10), spec, { fill: "FFFFF7E6", color: "FF1F4E78" });
      idx++; r++;
    });

    // إجماليات المرحلة — كل مرحلة تحمل نصيبها من الإشراف والاحتياطي والضريبة
    xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], `إجمالي بنود ${p.phase}`, p.base, { fill: "FFEFF2F7", size: 10.5 });
    if (p.supervision > 0) xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], "أتعاب الإشراف الهندسي على هذه المرحلة", p.supervision, { fill: "FFEFF2F7", size: 10.5 });
    if (p.contingency > 0) xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], "احتياطي أعمال غير منظورة", p.contingency, { fill: "FFEFF2F7", size: 10.5 });
    if (p.vat > 0) xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], "ضريبة القيمة المضافة", p.vat, { fill: "FFEFF2F7", size: 10.5 });
    xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], `◆ قيمة المرحلة ${pi + 1} المستحقة`, p.quote, {
      fill: PHASE_FILL[p.phase] || XL_NAVY, textColor: XL_WHITE, size: 11.5, height: 21,
    });
    r++; // فاصل
  });

  const lastDataRow = r - 1;
  xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], "إجمالي بنود التنفيذ", calc.execTotal);
  xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], "الإجمالي قبل الضريبة", calc.subtotal);
  xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], "ضريبة القيمة المضافة", calc.vat);
  xlTotalRow(ws, r++, ["A", "H"], ["I", "J"], "الإجمالي النهائي المستحق", calc.grandTotal, {
    fill: XL_GOLD, textColor: XL_WHITE, size: 13, height: 24,
  });

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastDataRow, column: 10 } };
  return ws;
}

/* ═══════════ ورقة ٢: جدول التحصيل بالمراحل ═══════════ */
function sheetCollection(wb, client, settings, plan) {
  const ws = wb.addWorksheet("جدول التحصيل", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 5 }, { width: 28 }, { width: 18 }, { width: 16 },
    { width: 18 }, { width: 16 }, { width: 16 }, { width: 26 },
  ];

  xlSheetTitle(ws, "H",
    `جدول التحصيل بالمراحل — ${client.name || "عميل"}`,
    `نسبة الربح المتفق عليها: ${(plan.pct * 100).toFixed(1)}%    |    قيمة كل مرحلة تُحصَّل كاملة قبل بدء العمل فيها، ونسبة الربح بعد تسليمها وقبولها`);

  const headerRow = 4;
  ["م", "المرحلة", "يُحصَّل قبل البدء", "نسبة الربح", "الربح بعد التسليم", "إجمالي المرحلة", "المحصّل فعلًا", "الحالة"]
    .forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 22;

  const STATUS_COLOR = {
    empty: "FF9CA3AF", awaiting: "FFC00000", ready: "FF1F4E78",
    profitDue: "FFB45309", done: "FF1E7B45",
  };

  let r = headerRow + 1;
  plan.rows.forEach((row, i) => {
    const fill = i % 2 ? XL_WHITE : XL_LIGHT;
    const xr = ws.getRow(r);
    xlDataCell(xr.getCell(1), row.order, { fill, align: "center" });
    xlDataCell(xr.getCell(2), row.phase, { fill, bold: true, color: PHASE_FILL[row.phase]?.replace("FF", "FF") || "FF1F2937" });
    xlDataCell(xr.getCell(3), Math.round(row.quote), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
    xlDataCell(xr.getCell(4), plan.pct, { fill, align: "center", numFmt: "0.0%" });
    xlDataCell(xr.getCell(5), Math.round(row.profitDue), { fill, align: "center", numFmt: '#,##0 "ج.م"' });
    xlDataCell(xr.getCell(6), Math.round(row.phaseTotal), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
    xlDataCell(xr.getCell(7), Math.round(row.paidBase + row.paidProfit), { fill, align: "center", numFmt: '#,##0 "ج.م"' });
    xlDataCell(xr.getCell(8), row.statusLabel + (row.deliveredAt ? ` (سُلّمت ${row.deliveredAt})` : ""), {
      fill, bold: true, color: STATUS_COLOR[row.status] || "FF1F2937",
    });
    r++;
  });

  r++;
  xlTotalRow(ws, r++, ["A", "E"], ["F", "H"], "إجمالي قيمة المقايسة (يُحصَّل قبل المراحل)", plan.quoteTotal);
  xlTotalRow(ws, r++, ["A", "E"], ["F", "H"], "إجمالي نسبة الربح (تُحصَّل بعد التسليمات)", plan.profitTotal);
  xlTotalRow(ws, r++, ["A", "E"], ["F", "H"], "إجمالي قيمة التعاقد", plan.contractTotal, {
    fill: XL_GOLD, textColor: XL_WHITE, size: 13, height: 24,
  });
  r++;
  xlTotalRow(ws, r++, ["A", "E"], ["F", "H"], "المحصّل حتى الآن", plan.collected, { textColor: "FF1E7B45" });
  xlTotalRow(ws, r++, ["A", "E"], ["F", "H"], "المستحق الآن", plan.dueNow, { textColor: "FFC00000" });
  xlTotalRow(ws, r++, ["A", "E"], ["F", "H"], "المتبقي على كامل التعاقد", plan.outstanding);
  if (plan.unallocated > 0) {
    xlTotalRow(ws, r++, ["A", "E"], ["F", "H"], "دفعات محصّلة غير منسوبة لمرحلة", plan.unallocated, { textColor: "FFB45309" });
  }

  if (plan.pctMissing) {
    r++;
    ws.mergeCells(`A${r}:H${r}`);
    const w = ws.getCell(`A${r}`);
    w.value = "⚠️ لم تُحدَّد نسبة الربح المتفق عليها — أعمدة الربح صفر. اضبطها من الإعدادات أو من صفحة العميل.";
    w.font = { name: "Arial", bold: true, size: 11, color: { argb: "FF8A6D00" } };
    w.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E6" } };
    w.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    ws.getRow(r).height = 22;
  }

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  return ws;
}

/* ═══════════ ورقة ٣: الفعلي مقابل مقايسة كل مرحلة ═══════════ */
function sheetVariance(wb, client, byPhase) {
  const bud = phaseBudget(client, byPhase);
  const ws = wb.addWorksheet("الفعلي مقابل المخطط", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 5 }, { width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 20 },
  ];

  xlSheetTitle(ws, "G",
    `المصروف الفعلي مقابل مقايسة كل مرحلة — ${client.name || "عميل"}`,
    "المقارنة مع قيمة بنود المقايسة فقط — الإشراف والاحتياطي والضريبة ليست مصروفات موردين");

  const headerRow = 4;
  ["م", "المرحلة", "المقايسة (مخطط)", "المصروف الفعلي", "الفرق", "نسبة الصرف", "الحالة"]
    .forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 22;

  let r = headerRow + 1;
  bud.lines.forEach((l, i) => {
    const fill = i % 2 ? XL_WHITE : XL_LIGHT;
    const xr = ws.getRow(r);
    xlDataCell(xr.getCell(1), i + 1, { fill, align: "center" });
    xlDataCell(xr.getCell(2), l.phase, { fill, bold: true });
    xlDataCell(xr.getCell(3), Math.round(l.planned), { fill, align: "center", numFmt: '#,##0 "ج.م"' });
    xlDataCell(xr.getCell(4), Math.round(l.spent), { fill, align: "center", numFmt: '#,##0 "ج.م"' });
    xlDataCell(xr.getCell(5), Math.round(l.diff), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"', color: l.overrun ? "FFC00000" : "FF1E7B45" });
    xlDataCell(xr.getCell(6), l.ratio, { fill, align: "center", numFmt: "0.0%" });
    xlDataCell(xr.getCell(7), l.empty ? "لا بنود" : l.overrun ? "❌ تجاوز الميزانية" : "✅ داخل الميزانية", {
      fill, bold: true, color: l.empty ? "FF9CA3AF" : l.overrun ? "FFC00000" : "FF1E7B45",
    });
    r++;
  });

  r++;
  xlTotalRow(ws, r++, ["A", "D"], ["E", "G"], "إجمالي المقايسة", bud.planned);
  xlTotalRow(ws, r++, ["A", "D"], ["E", "G"], "إجمالي المصروف", bud.spent);
  if (bud.unassigned > 0) xlTotalRow(ws, r++, ["A", "D"], ["E", "G"], "مصروفات غير منسوبة لمرحلة", bud.unassigned, { textColor: "FFB45309" });
  xlTotalRow(ws, r++, ["A", "D"], ["E", "G"], "المتبقي من الميزانية", bud.remaining, {
    fill: bud.remaining < 0 ? "FFC00000" : XL_GOLD, textColor: XL_WHITE, size: 12, height: 22,
  });

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  return ws;
}

/* بناء الملف منفصل عن حفظه — حتى يمكن اختبار محتواه بلا متصفح */
export async function buildBOQWorkbook(client, settings, opts = {}) {
  const calc = calcClient(client, settings);
  const byPhase = calcByPhase(client, settings);
  const plan = phasePaymentPlan(client, settings, byPhase);

  const wb = new (await ExcelJSLib()).Workbook();
  sheetBOQ(wb, client, settings, byPhase, calc);
  sheetCollection(wb, client, settings, plan);
  /* ورقة المصروفات تخص المكتب لا العميل: تكشف ما دفعه المكتب للموردين.
     تُدرج فقط بطلب صريح ممّن يملك صلاحية رؤية أساس التكلفة — الافتراض
     هو الاستبعاد، حتى لا يُسرّب مسار تصدير جديد أرقام الموردين بالسهو. */
  if (opts.includeCost === true) {
    const book = opts.priceBook || DEFAULT_PRICEBOOK;
    const list = catalogueWithCustom(book);
    const rows = list.map(it => resolveItem(client, it, Number(client.area) || 0));
    const analysis = costAnalysis(book, rows, Object.fromEntries(list.map(i => [i[5], i])));

    if ((client.expenses || []).length > 0) sheetVariance(wb, client, byPhase);
    if (analysis.lines.length > 0) sheetCostAnalysis(wb, client, analysis);
    if ((client.expenses || []).length > 0 || (client.contractors || []).length > 0) {
      sheetSiteSpend(wb, client, analysis);
    }
  }
  return wb;
}

export async function exportFullBOQ(client, settings, opts = {}) {
  const wb = await buildBOQWorkbook(client, settings, opts);
  await saveWorkbook(wb, `مقايسة_كاملة_${client.name || "عميل"}.xlsx`);
}


/* ═══════════ ورقة: تحليل التكلفة المخطط ═══════════ */
function sheetCostAnalysis(wb, client, analysis) {
  const ws = wb.addWorksheet("تحليل التكلفة", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 5 }, { width: 36 }, { width: 22 }, { width: 9 }, { width: 11 },
    ...COST_KINDS.map(() => ({ width: 14 })),
    { width: 14 }, { width: 14 },
  ];
  const lastCol = String.fromCharCode(65 + 5 + COST_KINDS.length + 1);

  xlSheetTitle(ws, lastCol,
    `تحليل تكلفة المشروع — ${client.name || "عميل"}`,
    `نفس فئات مصروفات الموقع · التحليل يغطي ${(analysis.coverage * 100).toFixed(0)}% من قيمة المشروع`);

  const headerRow = 4;
  ["م", "البند", "المرحلة", "الكمية", "تكلفة الوحدة",
   ...COST_KINDS.map(k => KIND_LABEL[k]), "إجمالي التكلفة", "الربح"]
    .forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 26;

  let r = headerRow + 1;
  analysis.lines.forEach((l, i) => {
    const fill = i % 2 ? XL_WHITE : XL_LIGHT;
    const row = ws.getRow(r);
    xlDataCell(row.getCell(1), i + 1, { fill, align: "center" });
    xlDataCell(row.getCell(2), l.name, { fill });
    xlDataCell(row.getCell(3), l.phase, { fill, color: "FF6B7280" });
    xlDataCell(row.getCell(4), Math.round(l.qty * 100) / 100, { fill, align: "center" });
    xlDataCell(row.getCell(5), Math.round(l.unitCost), { fill, align: "center", numFmt: "#,##0" });
    COST_KINDS.forEach((k, ki) => {
      xlDataCell(row.getCell(6 + ki), Math.round(l.kinds[k] || 0), { fill, align: "center", numFmt: "#,##0" });
    });
    xlDataCell(row.getCell(6 + COST_KINDS.length), Math.round(l.cost), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
    xlDataCell(row.getCell(7 + COST_KINDS.length), Math.round(l.profit), {
      fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"', color: l.profit >= 0 ? "FF1E7B45" : "FFC00000",
    });
    r++;
  });

  const lastDataRow = r - 1;
  r++;
  // إجمالي كل فئة
  const totalRow = ws.getRow(r);
  xlDataCell(totalRow.getCell(1), "", { fill: "FF1F4E78" });
  xlDataCell(totalRow.getCell(2), "إجمالي التكلفة المحلَّلة", { fill: "FF1F4E78", bold: true, color: XL_WHITE });
  xlDataCell(totalRow.getCell(3), "", { fill: "FF1F4E78" });
  xlDataCell(totalRow.getCell(4), "", { fill: "FF1F4E78" });
  xlDataCell(totalRow.getCell(5), "", { fill: "FF1F4E78" });
  COST_KINDS.forEach((k, ki) => {
    xlDataCell(totalRow.getCell(6 + ki), Math.round(analysis.byKind[k] || 0), {
      fill: "FF1F4E78", align: "center", bold: true, color: XL_WHITE, numFmt: "#,##0",
    });
  });
  xlDataCell(totalRow.getCell(6 + COST_KINDS.length), Math.round(analysis.totalCost), {
    fill: "FF1F4E78", align: "center", bold: true, color: XL_WHITE, numFmt: '#,##0 "ج.م"',
  });
  xlDataCell(totalRow.getCell(7 + COST_KINDS.length), "", { fill: "FF1F4E78" });
  ws.getRow(r).height = 22;
  r += 2;

  // تجميع بالمرحلة
  ws.mergeCells(`A${r}:${lastCol}${r}`);
  const ph = ws.getCell(`A${r}`);
  ph.value = "التجميع بالمرحلة";
  ph.font = { name: "Arial", bold: true, size: 12, color: { argb: XL_WHITE } };
  ph.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
  ph.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
  r++;
  analysis.phases.filter(p => p.total > 0).forEach((p, i) => {
    const fill = i % 2 ? XL_WHITE : XL_LIGHT;
    const row = ws.getRow(r);
    xlDataCell(row.getCell(1), i + 1, { fill, align: "center" });
    xlDataCell(row.getCell(2), p.phase, { fill, bold: true });
    xlDataCell(row.getCell(3), p.unanalysed > 0 ? `غير محلَّل: ${Math.round(p.unanalysed)} ج.م` : "محلَّل بالكامل", {
      fill, color: p.unanalysed > 0 ? "FFB45309" : "FF1E7B45",
    });
    xlDataCell(row.getCell(4), "", { fill });
    xlDataCell(row.getCell(5), "", { fill });
    COST_KINDS.forEach((k, ki) => {
      xlDataCell(row.getCell(6 + ki), Math.round(p.kinds[k] || 0), { fill, align: "center", numFmt: "#,##0" });
    });
    xlDataCell(row.getCell(6 + COST_KINDS.length), Math.round(p.analysed), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
    xlDataCell(row.getCell(7 + COST_KINDS.length), "", { fill });
    r++;
  });

  if (analysis.unanalysed.length > 0) {
    r++;
    ws.mergeCells(`A${r}:${lastCol}${r}`);
    const w = ws.getCell(`A${r}`);
    w.value = `⚠️ ${analysis.unanalysed.length} بندًا بلا تحليل تكلفة بقيمة بيع ${Math.round(analysis.unanalysedValue).toLocaleString("en-US")} ج.م — لم تُقدَّر تكلفتها ولم تُخترع.`;
    w.font = { name: "Arial", bold: true, size: 11, color: { argb: "FF8A6D00" } };
    w.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E6" } };
    w.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    ws.getRow(r).height = 22;
  }

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  if (lastDataRow >= headerRow + 1) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastDataRow, column: 7 + COST_KINDS.length } };
  }
  return ws;
}

/* ═══════════ ورقة: مصروفات الموقع والمقاولون ═══════════ */
function sheetSiteSpend(wb, client, analysis) {
  const pva = plannedVsActual(client, analysis);
  const led = contractorLedger(client);
  const ws = wb.addWorksheet("مصروفات الموقع", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 5 }, { width: 28 }, { width: 20 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 22 },
  ];

  xlSheetTitle(ws, "G",
    `مصروفات الموقع مقابل تحليل السعر — ${client.name || "عميل"}`,
    "نفس تصنيف التسعير: خامات · عمالة · مقاول باطن · معدات · نثريات");

  const headerRow = 4;
  ["م", "المرحلة", "الفئة", "مخطط", "فعلي", "الفرق", "الحالة"]
    .forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 22;

  let r = headerRow + 1, n = 0;
  for (const p of pva.phases) {
    const live = p.kinds.filter(k => !k.silent);
    if (live.length === 0) continue;
    for (const k of live) {
      const fill = n % 2 ? XL_WHITE : XL_LIGHT;
      const row = ws.getRow(r);
      n++;
      xlDataCell(row.getCell(1), n, { fill, align: "center" });
      xlDataCell(row.getCell(2), p.phase, { fill });
      xlDataCell(row.getCell(3), KIND_LABEL[k.kind], { fill, bold: true });
      xlDataCell(row.getCell(4), Math.round(k.planned), { fill, align: "center", numFmt: '#,##0 "ج.م"' });
      xlDataCell(row.getCell(5), Math.round(k.spent), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
      xlDataCell(row.getCell(6), Math.round(k.diff), {
        fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"', color: k.overrun ? "FFC00000" : "FF1E7B45",
      });
      xlDataCell(row.getCell(7), k.overrun ? "❌ تجاوز" : (k.planned > 0 ? "✅ داخل المخطط" : "— بلا تخطيط"), {
        fill, bold: true, color: k.overrun ? "FFC00000" : (k.planned > 0 ? "FF1E7B45" : "FF9CA3AF"),
      });
      r++;
    }
  }

  r++;
  for (const t of pva.totals) {
    if (t.planned <= 0 && t.spent <= 0) continue;
    xlTotalRow(ws, r++, ["A", "C"], ["D", "G"],
      `إجمالي ${KIND_LABEL[t.kind]} — مخطط ${Math.round(t.planned).toLocaleString("en-US")} · فعلي ${Math.round(t.spent).toLocaleString("en-US")}`,
      t.diff, { textColor: t.overrun ? "FFC00000" : "FF1E7B45", size: 10.5 });
  }
  xlTotalRow(ws, r++, ["A", "C"], ["D", "G"], "إجمالي التكلفة المخططة", pva.plannedTotal);
  xlTotalRow(ws, r++, ["A", "C"], ["D", "G"], "إجمالي المصروف الفعلي", pva.spentTotal, {
    fill: pva.diff < 0 ? "FFC00000" : XL_GOLD, textColor: XL_WHITE, size: 12, height: 22,
  });
  if (pva.unassigned > 0) {
    xlTotalRow(ws, r++, ["A", "C"], ["D", "G"], "مصروفات بلا مرحلة (خارج المقارنة)", pva.unassigned, { textColor: "FFB45309" });
  }

  /* حسابات المقاولين */
  if (led.rows.length > 0 || led.orphanTotal > 0) {
    r += 2;
    ws.mergeCells(`A${r}:G${r}`);
    const h = ws.getCell(`A${r}`);
    h.value = "حسابات مقاولي الباطن";
    h.font = { name: "Arial", bold: true, size: 12, color: { argb: XL_WHITE } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF833C00" } };
    h.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    ws.getRow(r).height = 22;
    r++;

    ["م", "المقاول", "الصنعة", "قيمة التعاقد", "مصروف", "محتجز ضمان", "المتبقي"]
      .forEach((hh, i) => xlHeaderCell(ws.getRow(r).getCell(i + 1), hh));
    ws.getRow(r).height = 22;
    r++;

    led.rows.forEach((k, i) => {
      const fill = i % 2 ? XL_WHITE : XL_LIGHT;
      const row = ws.getRow(r);
      xlDataCell(row.getCell(1), i + 1, { fill, align: "center" });
      xlDataCell(row.getCell(2), k.name || k.id, { fill, bold: true });
      xlDataCell(row.getCell(3), k.trade || "—", { fill });
      xlDataCell(row.getCell(4), Math.round(k.contractValue), { fill, align: "center", numFmt: '#,##0 "ج.م"' });
      xlDataCell(row.getCell(5), Math.round(k.paid), { fill, align: "center", numFmt: '#,##0 "ج.م"' });
      xlDataCell(row.getCell(6), Math.round(k.retained), { fill, align: "center", numFmt: '#,##0 "ج.م"', color: "FFB45309" });
      xlDataCell(row.getCell(7), Math.round(k.remaining), {
        fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"', color: k.overCertified ? "FFC00000" : "FF1E7B45",
      });
      r++;
    });

    xlTotalRow(ws, r++, ["A", "C"], ["D", "G"], "إجمالي تعاقدات المقاولين", led.contracted);
    xlTotalRow(ws, r++, ["A", "C"], ["D", "G"], "المصروف لهم", led.paid);
    xlTotalRow(ws, r++, ["A", "C"], ["D", "G"], "محتجز الضمان لدى المكتب", led.retained, { textColor: "FFB45309" });
    xlTotalRow(ws, r++, ["A", "C"], ["D", "G"], "المتبقي للمقاولين", led.remaining, {
      fill: XL_GOLD, textColor: XL_WHITE, size: 12, height: 22,
    });
    if (led.orphanTotal > 0) {
      xlTotalRow(ws, r++, ["A", "C"], ["D", "G"], "مصروفات مقاولين غير منسوبة لمقاول", led.orphanTotal, { textColor: "FFB45309" });
    }
  }

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  return ws;
}

export async function exportPipelineSummary(clients, settings) {
  const wb = new (await ExcelJSLib()).Workbook();
  const ws = wb.addWorksheet("ملخص كل العملاء", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 22 }, { width: 15 }, { width: 28 }, { width: 10 },
    { width: 14 }, { width: 17 }, { width: 12 },
  ];
  ws.mergeCells("A1:G1");
  const title = ws.getCell("A1");
  title.value = "ملخص خط عملاء المكتب";
  title.font = { name: "Arial", bold: true, size: 15, color: { argb: XL_WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  const headerRow = 3;
  const headers = ["اسم العميل", "الهاتف", "العنوان", "المساحة (م²)", "المرحلة", "الإجمالي النهائي (ج.م)", "تاريخ الإضافة"];
  headers.forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 22;

  const stageFill = {
    "عميل محتمل": "FF9CA3AF", "قيد التصميم": "FF2E5395", "تم التعاقد": "FFBF9000",
    "قيد التنفيذ": "FFC2410C", "تم التسليم": "FF1E7B45",
  };

  let r = headerRow + 1;
  let totalAll = 0;
  clients.forEach((c, i) => {
    const calc = calcClient(c, settings);
    totalAll += calc.grandTotal;
    const fill = i % 2 ? XL_WHITE : XL_LIGHT;
    const row = ws.getRow(r);
    xlDataCell(row.getCell(1), c.name || "بدون اسم", { fill, bold: true });
    xlDataCell(row.getCell(2), c.phone || "", { fill, align: "center" });
    xlDataCell(row.getCell(3), c.address || "", { fill });
    xlDataCell(row.getCell(4), Number(c.area) || 0, { fill, align: "center" });
    xlDataCell(row.getCell(5), c.stage, { fill, align: "center", bold: true, color: stageFill[c.stage] || "FF1F2937" });
    xlDataCell(row.getCell(6), Math.round(calc.grandTotal), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
    xlDataCell(row.getCell(7), c.createdAt || "", { fill, align: "center" });
    r++;
  });

  ws.mergeCells(`A${r}:E${r}`);
  const fl = ws.getCell(`A${r}`);
  fl.value = "إجمالي قيمة خط الأعمال بالكامل";
  fl.font = { name: "Arial", bold: true, size: 12, color: { argb: XL_WHITE } };
  fl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_GOLD } };
  fl.alignment = { horizontal: "right", vertical: "middle" };
  ws.mergeCells(`F${r}:G${r}`);
  const fv = ws.getCell(`F${r}`);
  fv.value = Math.round(totalAll);
  fv.numFmt = '#,##0 "ج.م"';
  fv.font = { name: "Arial", bold: true, size: 12, color: { argb: XL_WHITE } };
  fv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_GOLD } };
  fv.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 22;

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: r - 1, column: 7 } };

  await saveWorkbook(wb, "ملخص_خط_العملاء.xlsx");
}
