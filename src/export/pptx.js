let _pptx = null;
const pptxLib = async () => (_pptx ||= (await import("pptxgenjs")).default);
import { fmt, SPECS } from "../domain/catalogue.js";
import { LEVELS, SCOPES, LEVEL_COLORS } from "../ui/tokens.js";


export const MOOD = {
  "اقتصادي": { floor: "E5E0D8", floorVein: "CFC8BC", wall: "D9D9D9", wood: "C9A876", woodGrain: "B08F5C", metal: "B0B0B0", metalAccent: "8C8C8C", texture: "tile" },
  "متوسط": { floor: "D8C9B0", floorVein: "C0AD8A", wall: "6E97A8", wood: "A97C50", woodGrain: "8A6038", metal: "C9A227", metalAccent: "A9861B", texture: "tile" },
  "لوكس": { floor: "EDEAE3", floorVein: "C9A227", wall: "2E4A66", wood: "6B4226", woodGrain: "4A2C18", metal: "D4AF37", metalAccent: "A9861B", texture: "marble" },
  "سوبر لوكس": { floor: "2B2B2B", floorVein: "BF9000", wall: "17181A", wood: "3E2723", woodGrain: "241512", metal: "E8C86E", metalAccent: "BF9000", texture: "marble" },
};

export function pptxMoodPanel(s, x, y, w, h, levelKey, accentColor) {
  const m = MOOD[levelKey];
  s.addShape("roundRect", { x, y, w, h, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: accentColor, width: 2 } });
  const rows = [
    { label: "الأرضيات", color: m.floor, vein: m.floorVein, kind: m.texture },
    { label: "الحوائط", color: m.wall, vein: null, kind: "solid" },
    { label: "الأبواب والأخشاب", color: m.wood, vein: m.woodGrain, kind: "wood" },
    { label: "التجهيزات والإضاءة", color: m.metal, vein: m.metalAccent, kind: "metal" },
  ];
  const padTop = 0.15, gap = 0.1;
  const rowH = (h - padTop - 0.1 - gap * 3) / 4;
  let ry = y + padTop;
  rows.forEach((row) => {
    const rx = x + 0.12, rw = w - 0.24;
    s.addShape("roundRect", { x: rx, y: ry, w: rw, h: rowH, rectRadius: 0.04, fill: { color: row.color }, line: { color: "E3E7EE", width: 0.5 } });
    if (row.kind === "tile") {
      for (let i = 1; i < 4; i++) s.addShape("line", { x: rx + (rw / 4) * i, y: ry, w: 0, h: rowH, line: { color: row.vein, width: 0.75, transparency: 30 } });
      s.addShape("line", { x: rx, y: ry + rowH / 2, w: rw, h: 0, line: { color: row.vein, width: 0.75, transparency: 30 } });
    } else if (row.kind === "marble") {
      s.addShape("line", { x: rx + rw * 0.1, y: ry + rowH * 0.15, w: rw * 0.6, h: rowH * 0.55, line: { color: row.vein, width: 1.25, transparency: 15 } });
      s.addShape("line", { x: rx + rw * 0.35, y: ry + rowH * 0.75, w: rw * 0.45, h: -rowH * 0.5, line: { color: row.vein, width: 1, transparency: 30 } });
    } else if (row.kind === "wood") {
      for (let i = 1; i < 4; i++) s.addShape("line", { x: rx, y: ry + (rowH / 4) * i, w: rw, h: 0, line: { color: row.vein, width: 0.75, transparency: 35 } });
    } else if (row.kind === "metal") {
      for (let i = 0; i < 3; i++) s.addShape("ellipse", { x: rx + 0.08 + i * (rw / 3), y: ry + rowH * 0.2, w: rowH * 0.6, h: rowH * 0.6, fill: { color: row.vein, transparency: 55 }, line: { type: "none" } });
    }
    s.addText(row.label, { x: rx, y: ry + rowH - 0.24, w: rw, h: 0.22, fontFace: "Arial", fontSize: 8, bold: true, color: row.kind === "metal" || levelKey === "سوبر لوكس" ? "FFFFFF" : "1F1F1F", align: "center", valign: "bottom", rtlMode: true });
    ry += rowH + gap;
  });
}

export async function buildAndDownloadClientPptx(client, calc, settings) {
  const p = new (await pptxLib())();
  p.layout = "LAYOUT_WIDE";
  p.rtlMode = true;
  const NAVY_ = "1F4E78", NAVY_DARK_ = "132E45", GOLD_ = "BF9000", LIGHT_ = "F5F7FA", MUTED_ = "6B7280";
  const LEVEL_COLOR = { "اقتصادي": "6B7280", "متوسط": "2E5395", "لوكس": "BF9000", "سوبر لوكس": "1F1F1F" };

  // Slide 1 — Cover
  {
    const s = p.addSlide();
    s.background = { color: NAVY_ };
    s.addShape("ellipse", { x: 9.8, y: -2.2, w: 7, h: 7, fill: { color: NAVY_DARK_ }, line: { type: "none" } });
    s.addText(`عرض تشطيب مخصص`, { x: 1, y: 2.5, w: 11.33, h: 1, fontFace: "Arial", fontSize: 34, bold: true, color: "FFFFFF", align: "center", rtlMode: true });
    s.addText(client.name || "عميل", { x: 1, y: 3.4, w: 11.33, h: 0.7, fontFace: "Arial", fontSize: 22, color: GOLD_, align: "center", rtlMode: true });
    s.addText(`${client.address || ""}   |   ${client.area} م²   |   ${new Date().toLocaleDateString("ar-EG")}`, { x: 1, y: 4.2, w: 11.33, h: 0.5, fontFace: "Arial", fontSize: 13, italic: true, color: "D9E1F2", align: "center", rtlMode: true });
    s.addText(((settings?.officeName || "").trim() ? `مكتب ${settings.officeName.trim()} للاستشارات المعمارية` : "مكتب الاستشارات المعمارية"), { x: 1, y: 6.6, w: 11.33, h: 0.4, fontFace: "Arial", fontSize: 11, color: "AEB9C6", align: "center", rtlMode: true });
  }

  // Slide 2 — Chosen level per scope
  {
    const s = p.addSlide();
    s.background = { color: LIGHT_ };
    s.addText("المستوى المختار لكل نطاق عمل", { x: 0.6, y: 0.4, w: 12, h: 0.55, fontFace: "Arial", fontSize: 24, bold: true, color: NAVY_, align: "right", rtlMode: true });
    let y = 1.4;
    SCOPES.forEach((scope) => {
      const included = client.scopeIncluded[scope];
      const level = client.scopeLevel[scope] || "متوسط";
      const color = included ? LEVEL_COLOR[level] : "9CA3AF";
      s.addShape("roundRect", { x: 0.6, y, w: 12.1, h: 0.68, rectRadius: 0.05, fill: { color: "FFFFFF" }, line: { color: "E3E7EE", width: 1 } });
      s.addShape("roundRect", { x: 0.6, y, w: 0.09, h: 0.68, fill: { color }, line: { type: "none" } });
      s.addText(scope, { x: 6.6, y: y + 0.05, w: 5.9, h: 0.58, fontFace: "Arial", fontSize: 13, bold: true, color: "1F2937", align: "right", rtlMode: true, valign: "middle" });
      s.addShape("roundRect", { x: 4.9, y: y + 0.12, w: 1.5, h: 0.44, rectRadius: 0.06, fill: { color }, line: { type: "none" } });
      s.addText(included ? level : "غير مُضمَّن", { x: 4.9, y: y + 0.12, w: 1.5, h: 0.44, fontFace: "Arial", fontSize: 11, bold: true, color: "FFFFFF", align: "center", valign: "middle", rtlMode: true });
      s.addText(included ? `${fmt(calc.byScope[scope])} ج.م` : "—", { x: 0.75, y: y + 0.05, w: 3.9, h: 0.58, fontFace: "Arial", fontSize: 13, bold: true, color: NAVY_, align: "left", valign: "middle" });
      y += 0.85;
    });
  }

  // Slide 3 — Mood board reference for the levels actually chosen (unique set)
  {
    const s = p.addSlide();
    s.background = { color: LIGHT_ };
    s.addText("لوحة الخامات الاستدلالية للمستويات المختارة", { x: 0.6, y: 0.4, w: 12, h: 0.55, fontFace: "Arial", fontSize: 22, bold: true, color: NAVY_, align: "right", rtlMode: true });
    const chosenLevels = [...new Set(SCOPES.filter(s2 => client.scopeIncluded[s2]).map(s2 => client.scopeLevel[s2] || "متوسط"))];
    const list = chosenLevels.length ? chosenLevels : ["متوسط"];
    const panelW = 2.9, gap = 0.25, startX = (13.33 - (list.length * panelW + (list.length - 1) * gap)) / 2, panelY = 1.5, panelH = 5.0;
    list.forEach((lv, i) => {
      const x = startX + i * (panelW + gap);
      s.addText(lv, { x, y: panelY - 0.4, w: panelW, h: 0.35, fontFace: "Arial", fontSize: 14, bold: true, color: LEVEL_COLOR[lv], align: "center", rtlMode: true });
      pptxMoodPanel(s, x, panelY, panelW, panelH, lv, LEVEL_COLOR[lv]);
    });
  }

  // Slide 4 — Price summary
  {
    const s = p.addSlide();
    s.background = { color: NAVY_ };
    s.addText("ملخص السعر النهائي", { x: 0.6, y: 0.5, w: 12, h: 0.6, fontFace: "Arial", fontSize: 26, bold: true, color: "FFFFFF", align: "right", rtlMode: true });
    const lines = [
      ["إجمالي بنود التنفيذ", calc.execTotal],
      ["أتعاب الإشراف الهندسي", calc.supervision],
      ["احتياطي أعمال غير منظورة", calc.contingency],
      ["التصميم", calc.byScope["تصميم"]],
      ["الفرش والأثاث", calc.byScope["الفرش والأثاث"]],
      ["ضريبة القيمة المضافة", calc.vat],
    ];
    let y = 1.5;
    lines.forEach(([label, val]) => {
      s.addText(label, { x: 0.8, y, w: 7, h: 0.45, fontFace: "Arial", fontSize: 14, color: "D9E1F2", align: "right", rtlMode: true });
      s.addText(fmt(val) + " ج.م", { x: 8, y, w: 4.5, h: 0.45, fontFace: "Arial", fontSize: 14, bold: true, color: "FFFFFF", align: "left" });
      y += 0.55;
    });
    s.addShape("roundRect", { x: 0.8, y: y + 0.2, w: 11.7, h: 0.9, rectRadius: 0.08, fill: { color: GOLD_ }, line: { type: "none" } });
    s.addText("الإجمالي النهائي المستحق", { x: 1, y: y + 0.2, w: 7, h: 0.9, fontFace: "Arial", fontSize: 17, bold: true, color: "1F1F1F", align: "right", valign: "middle", rtlMode: true });
    s.addText(fmt(calc.grandTotal) + " ج.م", { x: 8, y: y + 0.2, w: 4.3, h: 0.9, fontFace: "Arial", fontSize: 20, bold: true, color: "1F1F1F", align: "left", valign: "middle" });
  }

  await p.writeFile({ fileName: `عرض_${client.name || "عميل"}.pptx` });
}
