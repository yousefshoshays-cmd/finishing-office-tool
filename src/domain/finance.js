import { PAYMENT_STAGES } from "../export/docx.js";

/* ============================= المال بعد التعاقد =============================
   قبل هذا كان النظام ينتهي عند توليد العقد. لكن مكتب التشطيبات لا يخسر
   في التسعير — يخسر في ما بعده: تعديلات غير موثّقة، ودفعات لم تُحصَّل،
   ومصروفات تجاوزت المقايسة دون أن يلاحظها أحد.

   ثلاثة سجلات تُضاف للعميل:
     variations[]  أوامر التغيير
     receipts[]    ما حُصِّل فعلًا
     expenses[]    ما صُرف فعلًا
   ولا شيء منها يعدّل لقطة العقد الأصلية. */

/* ---------------------------------- أوامر التغيير ---------------------------------- */

export const VARIATION_STATUS = {
  draft:    "مسودة",
  sent:     "بانتظار موافقة العميل",
  approved: "معتمد",
  rejected: "مرفوض",
};

export function newVariation(clientId, seq) {
  return {
    id: `VO-${String(seq).padStart(3, "0")}`,
    clientId,
    date: new Date().toISOString().slice(0, 10),
    reason: "",
    status: "draft",
    approvedAt: "",
    approvedBy: "",
    lines: [],   // { itemId, name, unit, qty, price, note }
  };
}

export function variationTotal(v) {
  return (v.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
}

/* القيمة التعاقدية الحالية = العقد الأصلي + أوامر التغيير المعتمدة فقط.
   المسودات والمرفوضة لا تدخل الحساب — وهذا ما يمنع الخلاف عند التحصيل. */
export function contractValue(client) {
  const base = client?.contract?.totals?.grandTotal || 0;
  const approved = (client?.variations || [])
    .filter(v => v.status === "approved")
    .reduce((s, v) => s + variationTotal(v), 0);
  return {
    base,
    variations: approved,
    total: base + approved,
    pendingCount: (client?.variations || []).filter(v => v.status === "sent").length,
    pendingValue: (client?.variations || [])
      .filter(v => v.status === "sent")
      .reduce((s, v) => s + variationTotal(v), 0),
  };
}

/* ---------------------------------- التحصيل ---------------------------------- */

export function newReceipt(clientId, seq) {
  return {
    id: `RCV-${String(seq).padStart(3, "0")}`,
    clientId,
    date: new Date().toISOString().slice(0, 10),
    amount: 0,
    method: "تحويل بنكي",
    stage: "",       // أي دفعة من جدول العقد
    note: "",
  };
}

/* جدول الدفعات المستحقة مقابل ما حُصِّل فعلًا.
   النسب تُطبَّق على القيمة التعاقدية الحالية شاملة أوامر التغيير المعتمدة. */
export function paymentPlan(client) {
  const { total } = contractValue(client);
  const receipts = client?.receipts || [];
  const collected = receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  let cumulative = 0;
  const rows = (PAYMENT_STAGES || []).map(({ label, pct }) => {
    const due = total * pct;
    cumulative += due;
    const paidToHere = Math.min(collected, cumulative);
    const paidThis = Math.max(0, paidToHere - (cumulative - due));
    return {
      label, pct, due,
      paid: paidThis,
      remaining: Math.max(0, due - paidThis),
      settled: paidThis >= due - 0.5,
    };
  });

  return {
    total,
    collected,
    outstanding: Math.max(0, total - collected),
    collectedRatio: total > 0 ? collected / total : 0,
    rows,
    nextDue: rows.find(r => !r.settled) || null,
  };
}

/* ---------------------------------- الصرف ---------------------------------- */

export function newExpense(clientId, seq) {
  return {
    id: `EXP-${String(seq).padStart(3, "0")}`,
    clientId,
    date: new Date().toISOString().slice(0, 10),
    itemId: "",        // البند المقابل في المقايسة، إن وُجد
    scope: "",
    vendor: "",
    amount: 0,
    note: "",
  };
}

/* الفعلي مقابل المخطط لكل بند — الرقم الذي يكشف التجاوز قبل التسليم لا بعده. */
export function budgetVariance(client, resolvedRows) {
  const spentByItem = {};
  let unassigned = 0;
  for (const e of client?.expenses || []) {
    const amt = Number(e.amount) || 0;
    if (e.itemId) spentByItem[e.itemId] = (spentByItem[e.itemId] || 0) + amt;
    else unassigned += amt;
  }

  const lines = resolvedRows
    .filter(r => r.included)
    .map(r => {
      const spent = spentByItem[r.id] || 0;
      return {
        id: r.id, name: r.name,
        planned: r.total,
        spent,
        diff: r.total - spent,
        overrun: spent > r.total,
        ratio: r.total > 0 ? spent / r.total : 0,
      };
    });

  const planned = lines.reduce((s, l) => s + l.planned, 0);
  const spent = lines.reduce((s, l) => s + l.spent, 0) + unassigned;
  return {
    lines,
    planned,
    spent: spent,
    unassigned,
    remaining: planned - spent,
    overruns: lines.filter(l => l.overrun).sort((a, b) => (b.spent - b.planned) - (a.spent - a.planned)),
  };
}

/* الصورة المالية الكاملة للمشروع في رقم واحد */
export function projectCashPosition(client, resolvedRows) {
  const cv = contractValue(client);
  const pay = paymentPlan(client);
  const bud = budgetVariance(client, resolvedRows);
  return {
    contractValue: cv.total,
    collected: pay.collected,
    outstanding: pay.outstanding,
    spent: bud.spent,
    netCash: pay.collected - bud.spent,        // السيولة الفعلية الآن
    projectedProfit: cv.total - bud.spent,     // إن لم يُصرف شيء إضافي
  };
}
