import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, Header, Footer, PageNumber, VerticalAlign } from "docx";
import { saveAs } from "file-saver";
import { fmt, SPECS } from "../domain/catalogue.js";
import { LEVELS, SCOPES } from "../ui/tokens.js";


export const PAYMENT_STAGES = [
  { pct: 0.20, label: "دفعة مقدمة عند توقيع العقد" },
  { pct: 0.20, label: "بعد استلام الخامات وبدء أعمال الهدم والبناء" },
  { pct: 0.30, label: "بعد الانتهاء من التشطيبات الأساسية (أرضيات، حوائط، أسقف)" },
  { pct: 0.20, label: "بعد الانتهاء من التركيبات النهائية (أبواب، كهرباء، سباكة، مطبخ وحمامات)" },
  { pct: 0.10, label: "عند التسليم النهائي والمعاينة المشتركة" },
];

export function rtlP(opts) { return new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, ...opts }); }
export function rtlR(text, opts = {}) { return new TextRun({ text, rightToLeft: true, font: "Arial", ...opts }); }
export function docH1(text) {
  return rtlP({
    spacing: { before: 320, after: 150 },
    shading: { type: ShadingType.CLEAR, fill: "1F4E78" },
    children: [rtlR(text, { bold: true, color: "FFFFFF", size: 24 })],
  });
}
export function docBody(text, opts = {}) {
  return rtlP({ spacing: { after: 160 }, children: [rtlR(text, { size: 21, ...opts })] });
}
export function docCell(text, w, opts = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [rtlP({ alignment: opts.align || AlignmentType.RIGHT, children: [rtlR(text, { size: 20, bold: !!opts.bold, color: opts.color || "000000" })] })],
  });
}
export const DOC_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  left: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  right: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
};
export const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 850;
export const CONTENT_W = PAGE_W - 2 * MARGIN;

export function generateContractDocx(client, calc) {
  const today = new Date().toLocaleDateString("ar-EG");
  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "BF9000" } },
    children: [rtlR("عقد تنفيذ أعمال تشطيب وديكور", { bold: true, size: 38, color: "1F4E78" })],
  }));

  children.push(docH1("أطراف التعاقد"));
  children.push(docBody(`إنه في يوم ${today}، تم الاتفاق بين كل من:`));
  children.push(docBody('الطرف الأول: مكتب __________ للاستشارات المعمارية (ويشار إليه بـ "المكتب").', { bold: true }));
  children.push(docBody(`الطرف الثاني: ${client.name || "__________"}، مقيم بـ ${client.address || "__________"} (ويشار إليه بـ "العميل").`, { bold: true }));

  children.push(docH1("أولاً: نطاق العمل"));
  children.push(docBody(`يلتزم المكتب بتنفيذ أعمال التصميم والتشطيب لشقة العميل بمساحة تقريبية ${client.area} م²، وفقاً للمقايسة التفصيلية المعتمدة والموقعة من الطرفين والمرفقة بهذا العقد.`));

  children.push(docH1("ثانياً: قيمة العقد"));
  children.push(docBody(`القيمة الإجمالية لهذا العقد شاملة الضريبة: ${fmt(calc.grandTotal)} جنيهاً مصرياً.`, { bold: true }));

  children.push(docH1("ثالثاً: جدول الدفعات"));
  const w = [Math.round(CONTENT_W * 0.08), Math.round(CONTENT_W * 0.50), Math.round(CONTENT_W * 0.14), 0];
  w[3] = CONTENT_W - w[0] - w[1] - w[2];
  const payRows = PAYMENT_STAGES.map((p, i) => new TableRow({ children: [
    docCell(String(i + 1), w[0], { align: AlignmentType.CENTER, bold: true, fill: i % 2 ? "FFFFFF" : "F5F7FA" }),
    docCell(p.label, w[1], { fill: i % 2 ? "FFFFFF" : "F5F7FA" }),
    docCell((p.pct * 100).toFixed(0) + "%", w[2], { align: AlignmentType.CENTER, bold: true, fill: i % 2 ? "FFFFFF" : "F5F7FA" }),
    docCell(fmt(calc.grandTotal * p.pct) + " ج.م", w[3], { align: AlignmentType.CENTER, fill: i % 2 ? "FFFFFF" : "F5F7FA" }),
  ]}));
  children.push(new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: w,
    borders: DOC_BORDERS,
    rows: [
      new TableRow({ tableHeader: true, children: [
        docCell("م", w[0], { fill: "1F4E78", bold: true, color: "FFFFFF", align: AlignmentType.CENTER }),
        docCell("المرحلة", w[1], { fill: "1F4E78", bold: true, color: "FFFFFF" }),
        docCell("النسبة", w[2], { fill: "1F4E78", bold: true, color: "FFFFFF", align: AlignmentType.CENTER }),
        docCell("القيمة", w[3], { fill: "1F4E78", bold: true, color: "FFFFFF", align: AlignmentType.CENTER }),
      ]}),
      ...payRows,
    ],
  }));
  children.push(new Paragraph({ spacing: { before: 150 }, children: [] }));
  children.push(docBody("تُسدد كل دفعة خلال مدة أقصاها 3 أيام عمل من تاريخ إخطار العميل باكتمال المرحلة المرتبطة بها.", { italics: true, color: "6B7280" }));

  children.push(docH1("رابعاً: مدة التنفيذ"));
  children.push(docBody("مدة التنفيذ الإجمالية __________ يوم عمل من تاريخ استلام الموقع وتحصيل الدفعة المقدمة."));

  children.push(docH1("خامساً: الضمانات وفسخ العقد"));
  children.push(docBody("يلتزم المكتب بضمان أعمال التنفيذ وفقاً للمدد الموضحة في نموذج الاستلام والتسليم النهائي المرفق. يحق لأي من الطرفين فسخ هذا العقد في حال إخلال الطرف الآخر بأي من بنوده الجوهرية بعد إنذار كتابي ومهلة 15 يوماً لتصحيح الوضع."));

  children.push(new Paragraph({ spacing: { before: 400 }, children: [] }));
  const half = Math.round(CONTENT_W / 2);
  children.push(new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [half, CONTENT_W - half],
    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: half, type: WidthType.DXA }, children: [
        rtlP({ children: [rtlR("الطرف الأول (المكتب)", { bold: true, size: 21 })] }),
        rtlP({ spacing: { before: 400 }, children: [rtlR("الاسم: __________", { size: 21 })] }),
        rtlP({ spacing: { before: 200 }, children: [rtlR("التوقيع: __________", { size: 21 })] }),
      ]}),
      new TableCell({ width: { size: CONTENT_W - half, type: WidthType.DXA }, children: [
        rtlP({ children: [rtlR("الطرف الثاني (العميل)", { bold: true, size: 21 })] }),
        rtlP({ spacing: { before: 400 }, children: [rtlR(`الاسم: ${client.name || "__________"}`, { size: 21 })] }),
        rtlP({ spacing: { before: 200 }, children: [rtlR("التوقيع: __________", { size: 21 })] }),
      ]}),
    ]})],
  }));

  return new Document({
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [rtlR("عقد تنفيذ أعمال تشطيب وديكور", { size: 16, color: "6B7280" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["صفحة ", PageNumber.CURRENT, " من ", PageNumber.TOTAL_PAGES], size: 16, color: "6B7280", font: "Arial" })] })] }) },
      children,
    }],
  });
}

export async function downloadDocx(filename, doc) {
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}
