let _ExcelJS = null;
const ExcelJSLib = async () => (_ExcelJS ||= await import("exceljs"));
import { saveAs } from "file-saver";
import { ITEMS, SPECS, fmt, DEFAULT_SETTINGS } from "../domain/catalogue.js";
import { resolveItem, calcClient } from "../domain/pricing.js";
import { LEVELS, SCOPES, STAGES } from "../ui/tokens.js";


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
  saveAs(new Blob([buffer], { type: "application/octet-stream" }), filename);
}

export async function exportFullBOQ(client, settings) {
  const calc = calcClient(client, settings);
  const wb = new (await ExcelJSLib()).Workbook();
  const ws = wb.addWorksheet("المقايسة التفصيلية", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 4 }, { width: 40 }, { width: 9 }, { width: 9 },
    { width: 12 }, { width: 12 }, { width: 9 }, { width: 13 }, { width: 34 },
  ];

  ws.mergeCells("A1:I1");
  const title = ws.getCell("A1");
  title.value = `المقايسة التفصيلية — ${client.name || "عميل"}`;
  title.font = { name: "Arial", bold: true, size: 15, color: { argb: XL_WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:I2");
  const sub = ws.getCell("A2");
  sub.value = `العنوان: ${client.address || "—"}    |    المساحة: ${client.area} م²    |    التاريخ: ${new Date().toLocaleDateString("ar-EG")}    |    * = بند بمستوى/كمية/سعر مخصص يدويًا`;
  sub.font = { name: "Arial", italic: true, size: 10, color: { argb: "FF6B7280" } };
  sub.alignment = { horizontal: "center" };

  const headerRow = 4;
  const headers = ["م", "البند", "الوحدة", "الكمية", "المستوى المطبق", "سعر الوحدة", "مُضمَّن؟", "الإجمالي (ج.م)", "المواصفة / النوع المقترح"];
  headers.forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 22;

  const SCOPE_FILL = {
    "تصميم": "FF7030A0",
    "تعديلات معمارية (هدم وبناء)": "FF833C00",
    "التشطيبات المعمارية والتنفيذ": "FF1F4E78",
    "الكهرباء": "FFBF9000",
    "السباكة والتكييف": "FF0B5394",
    "الفرش والأثاث": "FF38761D",
  };

  let r = headerRow + 1;
  let idx = 1;
  let currentScope = null;
  const firstDataRow = r;
  const scopeSubtotalRows = [];
  let scopeRunningTotal = 0;
  let scopeStartRow = r;

  const closeScopeIfOpen = () => {
    if (currentScope === null) return;
    ws.mergeCells(`A${r}:G${r}`);
    const lc = ws.getCell(`A${r}`);
    lc.value = `إجمالي — ${currentScope}`;
    lc.font = { name: "Arial", bold: true, size: 10.5, color: { argb: "FF1F2937" } };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F7" } };
    lc.alignment = { horizontal: "right", vertical: "middle" };
    ws.mergeCells(`H${r}:I${r}`);
    const vc = ws.getCell(`H${r}`);
    vc.value = Math.round(scopeRunningTotal);
    vc.numFmt = '#,##0 "ج.م"';
    vc.font = { name: "Arial", bold: true, size: 10.5 };
    vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F7" } };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    r++;
  };

  ITEMS.forEach((item) => {
    const [scope, name, unit] = item;
    if (scope !== currentScope) {
      closeScopeIfOpen();
      scopeRunningTotal = 0;
      currentScope = scope;
      ws.mergeCells(`A${r}:I${r}`);
      const hc = ws.getCell(`A${r}`);
      hc.value = `◆ ${scope}`;
      hc.font = { name: "Arial", bold: true, size: 11, color: { argb: XL_WHITE } };
      hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SCOPE_FILL[scope] || XL_NAVY } };
      hc.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      ws.getRow(r).height = 20;
      r++;
    }

    const resolved = resolveItem(client, item, Number(client.area) || 0);
    const { included, level, levelIdx, qty, price } = resolved;
    const total = Math.round(resolved.total);
    if (included) scopeRunningTotal += total;
    const fill = idx % 2 ? XL_WHITE : XL_LIGHT;
    const spec = SPECS[name] ? SPECS[name][levelIdx] : "—";
    const row = ws.getRow(r);
    xlDataCell(row.getCell(1), idx, { fill, align: "center" });
    xlDataCell(row.getCell(2), name + (resolved.isCustomLevel || resolved.hasQtyOverride || resolved.hasPriceOverride ? " *" : ""), { fill });
    xlDataCell(row.getCell(3), unit, { fill, align: "center" });
    xlDataCell(row.getCell(4), Math.round(qty * 100) / 100, { fill, align: "center" });
    xlDataCell(row.getCell(5), level, { fill, align: "center" });
    xlDataCell(row.getCell(6), price, { fill, align: "center", numFmt: "#,##0" });
    xlDataCell(row.getCell(7), included ? "نعم" : "لا", { fill, align: "center", bold: true, color: included ? "FF1E7B45" : "FFC00000" });
    xlDataCell(row.getCell(8), total, { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
    xlDataCell(row.getCell(9), spec, { fill: "FFFFF7E6", color: "FF1F4E78" });
    idx++; r++;
  });
  closeScopeIfOpen();
  const lastDataRow = r - 1;

  const summaryLines = [
    ["إجمالي بنود التنفيذ", calc.execTotal],
    ["أتعاب الإشراف الهندسي", calc.supervision],
    ["احتياطي أعمال غير منظورة", calc.contingency],
    ["الإجمالي قبل الضريبة", calc.subtotal],
    ["ضريبة القيمة المضافة", calc.vat],
  ];
  r += 1;
  summaryLines.forEach(([label, val]) => {
    ws.mergeCells(`A${r}:G${r}`);
    const lc = ws.getCell(`A${r}`);
    lc.value = label;
    lc.font = { name: "Arial", bold: true, size: 11, color: { argb: "FF1F4E78" } };
    lc.alignment = { horizontal: "right", vertical: "middle" };
    ws.mergeCells(`H${r}:I${r}`);
    const vc = ws.getCell(`H${r}`);
    vc.value = Math.round(val);
    vc.numFmt = '#,##0 "ج.م"';
    vc.font = { name: "Arial", bold: true, size: 11 };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    r++;
  });

  ws.mergeCells(`A${r}:G${r}`);
  const fl = ws.getCell(`A${r}`);
  fl.value = "الإجمالي النهائي المستحق";
  fl.font = { name: "Arial", bold: true, size: 13, color: { argb: XL_WHITE } };
  fl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_GOLD } };
  fl.alignment = { horizontal: "right", vertical: "middle" };
  ws.mergeCells(`H${r}:I${r}`);
  const fv = ws.getCell(`H${r}`);
  fv.value = Math.round(calc.grandTotal);
  fv.numFmt = '#,##0 "ج.م"';
  fv.font = { name: "Arial", bold: true, size: 13, color: { argb: XL_WHITE } };
  fv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_GOLD } };
  fv.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 24;

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastDataRow, column: 9 } };

  await saveWorkbook(wb, `مقايسة_كاملة_${client.name || "عميل"}.xlsx`);
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
