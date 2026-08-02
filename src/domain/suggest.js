import { resolveItem } from "./pricing.js";
import { bookEntry } from "./pricebook.js";

/* ════════════════════════════════════════════════════════════════
   اقتراح الأسعار — من تاريخ المكتب لا من نموذج لغوي

   لماذا لا ذكاء اصطناعي؟ سببان:
   ١. الموقع صفحة ثابتة في مستودع عام — أي مفتاح API مكشوف للجميع.
   ٢. حتى مع خادم، النموذج لا يعرف سعر البورسلين في البحيرة اليوم.
      المكتب يعرفه، وهو مسجّل في مشاريعه.

   ما يفعله هذا الملف: يقرأ ما سعّرته فعلًا سابقًا ويقارنه بالكتالوج.
   الوسيط لا المتوسط — لأن تجاوزًا شاذًا واحدًا (خصم لقريب) يجرّ
   المتوسط ويفسد الاقتراح.

   قاعدة صارمة: لا اقتراح من أقل من عيّنتين. رقم مبني على مشروع
   واحد ليس نمطًا، وعرضه كتوصية يمنحه ثقة لا يستحقها.
   ════════════════════════════════════════════════════════════════ */

export const MIN_SAMPLES = 2;
export const DRIFT_THRESHOLD = 0.10;

function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/* التجاوزات اليدوية فقط — سعر الكتالوج ليس قرارًا اتخذه أحد */
export function priceHistory(clients, itemId) {
  const out = [];
  for (const c of clients || []) {
    const rec = (c.items || {})[itemId];
    if (!rec) continue;
    const price = Number(rec.price);
    if (!(price > 0)) continue;
    out.push({
      clientId: c.id,
      clientName: c.name || "بدون اسم",
      price,
      date: rec.priceDate || c.createdAt || "",
      stage: c.stage || "",
    });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function suggestPrice(clients, item, levelIdx, book) {
  const id = item[5];
  const history = priceHistory(clients, id);
  const catalogue = bookEntry(book, item).price?.[levelIdx];

  if (history.length < MIN_SAMPLES) {
    return {
      id, hasSuggestion: false, samples: history.length, catalogue, history,
      reason: history.length === 0
        ? "لم تعدّل سعر هذا البند في أي مشروع بعد"
        : "مشروع واحد فقط — غير كافٍ لاستنتاج نمط",
    };
  }

  const recent = history.slice(0, 8);
  const prices = recent.map(h => h.price);
  const suggested = median(prices);
  const drift = catalogue > 0 ? (suggested - catalogue) / catalogue : null;

  return {
    id, hasSuggestion: true,
    samples: recent.length,
    suggested: Math.round(suggested),
    min: Math.min(...prices),
    max: Math.max(...prices),
    catalogue, drift,
    staleCatalogue: drift != null && Math.abs(drift) >= DRIFT_THRESHOLD,
    lastUsed: recent[0]?.date || "",
    history: recent,
  };
}

/* البنود التي تتجاوز سعرها يدويًا في كل مرة — الكتالوج نفسه متأخر */
export function catalogueDriftReport(clients, items, book, levelIdx = 1) {
  const out = [];
  for (const item of items) {
    const s = suggestPrice(clients, item, levelIdx, book);
    if (s.hasSuggestion && s.staleCatalogue) {
      out.push({ id: s.id, name: item[1], catalogue: s.catalogue, suggested: s.suggested, drift: s.drift, samples: s.samples });
    }
  }
  return out.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}

/* شذوذ إدخال: 5500 بدل 550. يُعرض للمراجعة لا للمنع. */
export function priceOutliers(client, items, clients, book) {
  const out = [];
  const others = (clients || []).filter(c => c.id !== client.id);
  for (const item of items) {
    const id = item[5];
    const rec = (client.items || {})[id];
    if (!rec || !(Number(rec.price) > 0)) continue;
    const r = resolveItem(client, item, Number(client.area) || 0);
    const s = suggestPrice(others, item, r.levelIdx, book);
    const reference = s.hasSuggestion ? s.suggested : s.catalogue;
    if (!(reference > 0)) continue;
    const ratio = Number(rec.price) / reference;
    if (ratio >= 3 || ratio <= 1 / 3) {
      out.push({ id, name: item[1], entered: Number(rec.price), reference, ratio });
    }
  }
  return out;
}
