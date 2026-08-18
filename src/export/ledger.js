let _ExcelJS = null;
const ExcelJSLib = async () => (_ExcelJS ||= await import("exceljs"));
import { saveAs } from "file-saver";
import { contractValue, phasePaymentPlan, variationTotal } from "../domain/finance.js";
import { calcByPhase } from "../domain/pricing.js";
import { fmt, DEFAULT_SETTINGS } from "../domain/catalogue.js";

/* ════════════════════════════════════════════════════════════════
   الأرقام هنا تُقرأ من نفس مصدر شاشة التحصيل — لا من حساب موازٍ.

   كان هذا الملف يحسب بجدول الدفعات الثابت القديم (٢٠/٢٠/٣٠/٢٠/١٠)
   بينما انتقل التطبيق كله إلى المراحل، فكان يعطي للعميل الواحد
   قيمة تعاقد ومتبقيًا يخالفان ما يراه المكتب على الشاشة.
   اختبار في test/smoke.mjs يثبت تطابق الرقمين ويمنع افتراقهما ثانيةً.
   ════════════════════════════════════════════════════════════════ */
export function clientLedgerFigures(client, settings = DEFAULT_SETTINGS) {
  const plan = phasePaymentPlan(client, settings, calcByPhase(client, settings));
  const cv = contractValue(client);
  return {
    /* قيمة التعاقد = قيمة المراحل + نسبة الربح + أوامر التغيير المعتمدة */
    contracted: plan.contractTotal + cv.variations,
    collected: plan.collected,
    outstanding: Math.max(0, plan.contractTotal + cv.variations - plan.collected),
    dueNow: plan.dueNow,
    quoteTotal: plan.quoteTotal,
    profitTotal: plan.profitTotal,
    variations: cv.variations,
  };
}

/* ════════════════════════════════════════════════════════════════
   دفتر الأستاذ — للمحاسب لا بدلًا منه

   نظام قيد مزدوج كامل مبالغة لمكتب بهذا الحجم، ويكرّر عمل برنامج
   المحاسبة الذي يستخدمه محاسبك أصلًا. الفجوة الحقيقية ليست غياب
   نظام محاسبي، بل أن بيانات المشاريع لا تصل إليه إلا شفهيًا.

   هذا الملف يسدّ تلك الفجوة: كشف حركة موحّد بكل المقبوضات
   والمصروفات وأوامر التغيير، بصيغة يستوردها أي برنامج محاسبي.
   ════════════════════════════════════════════════════════════════ */

const NAVY = "FF1F4E78";
const LIGHT = "FFF5F7FA";

/* حركة واحدة موحّدة الشكل مهما كان مصدرها */
export function ledgerEntries(clients) {
  const rows = [];
  for (const c of clients || []) {
    const name = c.name || "بدون اسم";

    if (c.contract) {
      rows.push({
        date: c.contract.signedAt, client: name, type: "عقد",
        description: `قيمة تعاقد أساسية — ${c.area} م²`,
        debit: c.contract.totals?.grandTotal || 0, credit: 0, ref: `CON-${c.id.slice(-6)}`,
      });
    }

    for (const v of c.variations || []) {
      if (v.status !== "approved") continue;
      rows.push({
        date: v.date || v.createdAt || "", client: name, type: "أمر تغيير",
        description: v.title || "تغيير معتمد",
        debit: variationTotal(v), credit: 0, ref: v.id,
      });
    }

    for (const r of c.receipts || []) {
      if (!(Number(r.amount) > 0)) continue;
      rows.push({
        date: r.date || "", client: name, type: "تحصيل",
        description: r.note || "دفعة من العميل",
        debit: 0, credit: Number(r.amount), ref: r.id,
      });
    }

    for (const e of c.expenses || []) {
      if (!(Number(e.amount) > 0)) continue;
      rows.push({
        date: e.date || "", client: name, type: "مصروف",
        description: [e.vendor, e.note].filter(Boolean).join(" — ") || "مصروف مشروع",
        debit: 0, credit: -Number(e.amount), ref: e.id,
      });
    }
  }
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function ledgerSummary(clients, settings = DEFAULT_SETTINGS) {
  let contracted = 0, collected = 0, spent = 0, outstanding = 0, dueNow = 0;
  for (const c of clients || []) {
    if (!c.contract) continue;
    const f = clientLedgerFigures(c, settings);
    contracted += f.contracted;
    collected += f.collected;
    outstanding += f.outstanding;
    dueNow += f.dueNow;
    /* المصروف يشمل المحتجز: عمل نُفّذ واستُحق وإن لم يُصرف نقدًا بعد */
    spent += (c.expenses || []).reduce(
      (s, e) => s + (Number(e.amount) || 0) + (Number(e.retained) || 0), 0);
  }
  return { contracted, collected, outstanding, dueNow, spent, netCash: collected - spent };
}

export async function exportLedger(clients, settings = DEFAULT_SETTINGS, filename = "دفتر_الحركة.xlsx") {
  const wb = new (await ExcelJSLib()).Workbook();
  wb.creator = "نظام متابعة العملاء والتسعير";

  /* ورقة ١: كشف الحركة */
  const ws = wb.addWorksheet("كشف الحركة", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "التاريخ", key: "date", width: 13 },
    { header: "العميل", key: "client", width: 26 },
    { header: "النوع", key: "type", width: 13 },
    { header: "البيان", key: "description", width: 40 },
    { header: "مدين (مستحق)", key: "debit", width: 16 },
    { header: "دائن (نقد)", key: "credit", width: 16 },
    { header: "المرجع", key: "ref", width: 18 },
  ];
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  const rows = ledgerEntries(clients);
  for (const r of rows) {
    const row = ws.addRow(r);
    row.getCell("debit").numFmt = '#,##0;[Red]-#,##0';
    row.getCell("credit").numFmt = '#,##0;[Red]-#,##0';
    if (r.type === "مصروف") row.getCell("credit").font = { color: { argb: "FFC00000" } };
  }
  ws.autoFilter = { from: "A1", to: "G1" };

  /* ورقة ٢: ملخص لكل مشروع */
  const ws2 = wb.addWorksheet("ملخص المشاريع", { views: [{ rightToLeft: true }] });
  ws2.columns = [
    { header: "العميل", key: "client", width: 26 },
    { header: "قيمة العقد", key: "value", width: 16 },
    { header: "المحصّل", key: "collected", width: 16 },
    { header: "المتبقي", key: "outstanding", width: 16 },
    { header: "المصروف", key: "spent", width: 16 },
    { header: "الصافي النقدي", key: "net", width: 16 },
  ];
  ws2.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  });
  for (const c of (clients || []).filter(c => c.contract)) {
    const f = clientLedgerFigures(c, settings);
    const spent = (c.expenses || []).reduce(
      (s, e) => s + (Number(e.amount) || 0) + (Number(e.retained) || 0), 0);
    const row = ws2.addRow({
      client: c.name || "بدون اسم", value: f.contracted,
      collected: f.collected, outstanding: f.outstanding,
      spent, net: f.collected - spent,
    });
    ["value", "collected", "outstanding", "spent", "net"].forEach(k => { row.getCell(k).numFmt = "#,##0"; });
  }
  const sum = ledgerSummary(clients, settings);
  const total = ws2.addRow({
    client: "الإجمالي", value: sum.contracted, collected: sum.collected,
    outstanding: sum.outstanding, spent: sum.spent, net: sum.netCash,
  });
  total.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
  });

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
  return { rows: rows.length, summary: sum };
}

/* CSV مبسّط — أغلب البرامج المحاسبية المحلية تستورده مباشرة */
export function ledgerCSV(clients) {
  const rows = ledgerEntries(clients);
  const head = ["التاريخ", "العميل", "النوع", "البيان", "مدين", "دائن", "المرجع"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    lines.push([r.date, r.client, r.type, r.description, r.debit || "", r.credit || "", r.ref].map(esc).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");   // BOM ليقرأ إكسل العربية صحيحًا
}
