/* ════════════════════════════════════════════════════════════════════════════
   فئات التكلفة — المفردات الواحدة التي تربط التسعير بالتنفيذ
   ----------------------------------------------------------------------------
   المشكلة التي يحلّها هذا الملف: المكتب يقدّر بلغة ("سعر متر المحارة ١٢٠")
   وينفّذ بلغة أخرى ("دفعنا لمعلّم المحارة ٨ آلاف، واشترينا رمل وأسمنت بـ٥").
   فيستحيل معرفة أين ضاع الربح — هل في الخامة أم في العمالة أم في المقاول؟

   الحل: تصنيف واحد يُستعمل مرّتين —
     • في تحليل سعر البند   → كم قدّرنا لكل فئة (المخطط)
     • في مصروفات الموقع     → كم صرفنا على كل فئة (الفعلي)
   فتصبح المقارنة ممكنة بندًا ببند وفئةً بفئة.

   قاعدة الملف كله: لا رقم مخترع. الفئة غير المُدخلة تبقى صفرًا معلنًا،
   والبند بلا تحليل يبقى "غير محلَّل" لا "محلَّل بصفر".
   ══════════════════════════════════════════════════════════════════════════ */

export const COST_KINDS = ["materials", "labour", "subcontract", "equipment", "other"];

export const KIND_LABEL = {
  materials:   "خامات وتوريدات",
  labour:      "عمالة",
  subcontract: "مقاول باطن",
  equipment:   "معدات وأوناش",
  other:       "نثريات ومصروفات أخرى",
};

export const KIND_SHORT = {
  materials: "خامات", labour: "عمالة", subcontract: "مقاولون",
  equipment: "معدات", other: "نثريات",
};

export const KIND_COLOR = {
  materials:   "#1F4E78",
  labour:      "#BF9000",
  subcontract: "#833C00",
  equipment:   "#0B5394",
  other:       "#6B7280",
};

export const emptyAnalysis = () =>
  Object.fromEntries(COST_KINDS.map(k => [k, 0]));

/* تحليل صالح = كائن فيه فئة واحدة على الأقل بقيمة موجبة.
   كائن كل قيمه أصفار ليس تحليلًا — هو حقل فارغ مُدخَل بالخطأ. */
export function isAnalysed(a) {
  if (!a || typeof a !== "object") return false;
  return COST_KINDS.some(k => Number(a[k]) > 0);
}

export function analysisTotal(a) {
  if (!a) return 0;
  return COST_KINDS.reduce((s, k) => s + (Number(a[k]) || 0), 0);
}

export function normalizeAnalysis(a) {
  const out = emptyAnalysis();
  if (!a) return out;
  for (const k of COST_KINDS) {
    const v = Number(a[k]);
    out[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  return out;
}

export function addAnalysis(target, source, factor = 1) {
  for (const k of COST_KINDS) target[k] = (target[k] || 0) + (Number(source?.[k]) || 0) * factor;
  return target;
}

/* نِسَب الفئات من الإجمالي — لقراءة "المحارة ٤٠٪ خامات و٦٠٪ عمالة" */
export function analysisShares(a) {
  const total = analysisTotal(a);
  if (total <= 0) return null;
  return Object.fromEntries(COST_KINDS.map(k => [k, (Number(a[k]) || 0) / total]));
}

/* الفئة الأكبر — أسرع إشارة لمصدر الخطر في البند */
export function dominantKind(a) {
  const total = analysisTotal(a);
  if (total <= 0) return null;
  let best = null, bestVal = -1;
  for (const k of COST_KINDS) {
    const v = Number(a[k]) || 0;
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

/* المصروفات غير المباشرة (أوناش، معدات، مصروفات موقع عامة) لا تخصّ بندًا
   بعينه، فتوزيعها بالتساوي يظلم البنود الصغيرة. التوزيع بالتناسب مع القيمة
   المخططة لكل بند هو الأعدل: البند الذي يمثّل ٣٠٪ من المرحلة يحمل ٣٠٪ من
   وِنشها. وإن كانت المرحلة بلا قيمة مخططة، يُترك غير موزّع بدل اختراع نسبة. */
export function distributeIndirect(indirectTotal, weights) {
  const sum = weights.reduce((s, w) => s + (Number(w.weight) || 0), 0);
  if (!(indirectTotal > 0) || sum <= 0) {
    return { shares: weights.map(w => ({ ...w, share: 0 })), undistributed: indirectTotal || 0 };
  }
  const shares = weights.map(w => ({ ...w, share: indirectTotal * ((Number(w.weight) || 0) / sum) }));
  return { shares, undistributed: 0 };
}
