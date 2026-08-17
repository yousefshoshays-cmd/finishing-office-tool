import { PHASES } from "../ui/tokens.js";
import { phaseOf } from "./catalogue.js";
import { COST_KINDS, emptyAnalysis, distributeIndirect } from "./costing.js";

/* جدول الدفعات: بيانات أعمال، لا شأن لها بتوليد ملفات Word.
   كانت معرّفة داخل وحدة التصدير، فكانت تجرّ مكتبة docx كاملة إلى الحزمة الأساسية. */
export const PAYMENT_STAGES = [
  { pct: 0.20, label: "دفعة مقدمة عند توقيع العقد" },
  { pct: 0.20, label: "بعد استلام الخامات وبدء أعمال الهدم والبناء" },
  { pct: 0.30, label: "بعد الانتهاء من التشطيبات الأساسية (أرضيات، حوائط، أسقف)" },
  { pct: 0.20, label: "بعد الانتهاء من التركيبات النهائية (أبواب، كهرباء، سباكة، مطبخ وحمامات)" },
  { pct: 0.10, label: "عند التسليم النهائي والمعاينة المشتركة" },
];

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

export function newReceipt(clientId, seq, phase = "", kind = "base") {
  return {
    id: `RCV-${String(seq).padStart(3, "0")}`,
    clientId,
    date: new Date().toISOString().slice(0, 10),
    amount: 0,
    method: "تحويل بنكي",
    stage: "",       // أي دفعة من جدول العقد (النظام القديم)
    phase,           // أي مرحلة من المراحل الخمس
    kind,            // base = قيمة المقايسة قبل البدء · profit = نسبة الربح بعد التسليم
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

/* ═══════════════════ التحصيل بالمراحل — نموذج المكتب الفعلي ═══════════════════
   لكل مرحلة دفعتان لا واحدة:

     ١. قيمة مقايسة المرحلة كاملة — تُحصَّل قبل بدء العمل فيها.
        المكتب لا يموّل شراء خامات العميل من جيبه.
     ٢. نسبة الربح المتفق عليها — تُحصَّل بعد تسليم المرحلة وقبولها.
        الربح يُستحق بالتسليم لا بالوعد، وهذا ما يطمئن العميل ويحمي المكتب.

   الفارق العملي: النظام يمنع اعتبار المرحلة "جاهزة للبدء" قبل تحصيل قيمتها،
   ولا يُدرج ربح مرحلة في المستحقّات قبل تعليمها مُسلَّمة. */

export function agreedProfitPct(client, settings) {
  const own = client?.agreedProfitPct;
  if (own !== "" && own !== null && own !== undefined) return Number(own) || 0;
  return Number(settings?.agreedProfitPct) || 0;
}

export const PHASE_PAY_STATUS = {
  empty:      "لا بنود في هذه المرحلة",
  awaiting:   "بانتظار التحصيل قبل البدء",
  ready:      "محصّلة — جاهزة للتنفيذ",
  profitDue:  "سُلّمت — نسبة الربح مستحقة",
  done:       "مكتملة",
};

export function phasePaymentPlan(client, settings, byPhase) {
  const pct = agreedProfitPct(client, settings);
  const vatPct = Number(settings?.vatPct) || 0;
  const delivered = client?.phaseDelivered || {};

  /* المحصّل مبوّبًا بالمرحلة والنوع. الدفعات القديمة (قبل هذا النظام) بلا
     مرحلة — تُحسب في الإجمالي ولا تُنسب لمرحلة، وتُعرض صراحة كغير موزّعة
     بدل أن تُوزَّع بالتخمين على مراحل لم تُدفع عنها فعلًا. */
  const paid = {};
  let unallocated = 0;
  for (const r of client?.receipts || []) {
    const amt = Number(r.amount) || 0;
    if (!amt) continue;
    if (!r.phase || !PHASES.includes(r.phase)) { unallocated += amt; continue; }
    const kind = r.kind === "profit" ? "profit" : "base";
    (paid[r.phase] ||= { base: 0, profit: 0 })[kind] += amt;
  }

  const rows = byPhase.phases.map((p, i) => {
    const profit = p.net * pct;                 // الربح على القيمة قبل الضريبة
    const profitVat = profit * vatPct;
    const profitDue = profit + profitVat;
    const got = paid[p.phase] || { base: 0, profit: 0 };

    const baseRemaining = Math.max(0, p.quote - got.base);
    const profitRemaining = Math.max(0, profitDue - got.profit);
    const baseSettled = p.empty || baseRemaining <= 0.5;
    const profitSettled = profitDue <= 0.5 || profitRemaining <= 0.5;
    const deliveredAt = delivered[p.phase] || "";

    const status = p.empty ? "empty"
      : !baseSettled ? "awaiting"
      : !deliveredAt ? "ready"
      : !profitSettled ? "profitDue"
      : "done";

    return {
      phase: p.phase, order: i + 1, empty: p.empty, itemCount: p.itemCount,
      base: p.base, net: p.net, vat: p.vat,
      quote: p.quote,                            // يُحصَّل قبل البدء
      profit, profitVat, profitDue,              // يُحصَّل بعد التسليم
      phaseTotal: p.quote + profitDue,
      paidBase: got.base, paidProfit: got.profit,
      baseRemaining, profitRemaining,
      baseSettled, profitSettled,
      mayStart: baseSettled,
      deliveredAt,
      profitClaimable: !!deliveredAt && profitDue > 0.5,
      status, statusLabel: PHASE_PAY_STATUS[status],
    };
  });

  const active = rows.filter(r => !r.empty);
  const collected = rows.reduce((s, r) => s + r.paidBase + r.paidProfit, 0) + unallocated;
  const contractTotal = rows.reduce((s, r) => s + r.phaseTotal, 0);

  /* المستحق الآن ≠ المتبقي كله. المستحق = قيمة المرحلة التالية التي لم
     تُحصَّل + أرباح مراحل سُلّمت ولم يُدفع ربحها. باقي المراحل لم يحن وقتها. */
  const nextUnpaid = active.find(r => !r.baseSettled) || null;
  const profitDueNow = rows
    .filter(r => r.profitClaimable)
    .reduce((s, r) => s + r.profitRemaining, 0);

  return {
    rows, active, pct, unallocated,
    contractTotal,
    quoteTotal: rows.reduce((s, r) => s + r.quote, 0),
    profitTotal: rows.reduce((s, r) => s + r.profitDue, 0),
    collected,
    outstanding: Math.max(0, contractTotal - collected),
    dueNow: (nextUnpaid ? nextUnpaid.baseRemaining : 0) + profitDueNow,
    profitDueNow,
    nextPhase: nextUnpaid,
    blockedPhase: nextUnpaid && nextUnpaid.paidBase > 0 ? null : nextUnpaid,
    deliveredCount: active.filter(r => r.deliveredAt).length,
    activeCount: active.length,
    pctMissing: pct <= 0,
  };
}

/* تعليم مرحلة مُسلَّمة — اللحظة التي تصبح فيها نسبة الربح مستحقة */
export function markPhaseDelivered(client, phase, date = new Date().toISOString().slice(0, 10)) {
  return { ...(client?.phaseDelivered || {}), [phase]: date };
}
export function unmarkPhaseDelivered(client, phase) {
  const next = { ...(client?.phaseDelivered || {}) };
  delete next[phase];
  return next;
}

/* ---------------------------------- الصرف ---------------------------------- */

export function newExpense(clientId, seq, phase = "", kind = "materials") {
  return {
    id: `EXP-${String(seq).padStart(3, "0")}`,
    clientId,
    date: new Date().toISOString().slice(0, 10),
    itemId: "",        // البند المقابل في المقايسة، إن وُجد
    scope: "",
    phase,             // المرحلة — تُشتق من البند تلقائيًا إن تُركت فارغة
    kind,              // نفس تصنيف تحليل السعر: خامات/عمالة/مقاول/معدات/نثريات
    contractorId: "",  // لمصروفات مقاولي الباطن
    vendor: "",
    amount: 0,         // النقد المدفوع فعلًا
    retained: 0,       // محتجز ضمان من هذه الدفعة (مقاولو الباطن)
    note: "",
  };
}

/* ═══════════════════ حساب المقاول الجاري ═══════════════════
   المقاول ليس مصروفًا متكررًا بل طرفًا له حساب: تعاقد، ومستخلصات
   معتمدة، ومحتجز ضمان لا يُصرف إلا بعد انتهاء فترة الضمان، ومتبقٍ.

   الرقم الذي يوجع المكتب عمليًا: أن يكون المصروف للمقاول تجاوز قيمة
   تعاقده دون أن ينتبه أحد. هنا يُرصد فورًا. */
export function newContractor(clientId, seq, phase = "") {
  return {
    id: `SUB-${String(seq).padStart(3, "0")}`,
    clientId,
    name: "",
    trade: "",              // الصنعة: محارة، كهرباء، نجارة…
    phase,
    contractValue: 0,
    retentionPct: 0.05,     // نسبة محتجز الضمان المعتادة
    startedAt: new Date().toISOString().slice(0, 10),
    note: "",
  };
}

export function contractorLedger(client) {
  const expenses = client?.expenses || [];
  const rows = (client?.contractors || []).map(k => {
    const mine = expenses.filter(e => e.contractorId === k.id);
    const paid = mine.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const retained = mine.reduce((s, e) => s + (Number(e.retained) || 0), 0);
    /* قيمة الأعمال المعتمدة = ما صُرف + ما احتُجز منه.
       المحتجز عمل نُفّذ فعلًا واستُحق، لكنه لم يُصرف بعد. */
    const certified = paid + retained;
    const contractValue = Number(k.contractValue) || 0;
    return {
      ...k,
      contractValue,
      payments: mine.length,
      paid, retained, certified,
      remaining: contractValue - certified,
      overCertified: contractValue > 0 && certified > contractValue + 0.5,
      progress: contractValue > 0 ? certified / contractValue : 0,
      settled: contractValue > 0 && Math.abs(certified - contractValue) <= 0.5,
    };
  });

  /* مصروف مقاول باطن بلا مقاول معرّف: يُعلَن ليُنسب، لا يُخفى */
  const orphanPayments = expenses.filter(e => e.kind === "subcontract" && !e.contractorId);
  const orphanTotal = orphanPayments.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  return {
    rows,
    contracted: rows.reduce((s, r) => s + r.contractValue, 0),
    paid: rows.reduce((s, r) => s + r.paid, 0),
    retained: rows.reduce((s, r) => s + r.retained, 0),
    certified: rows.reduce((s, r) => s + r.certified, 0),
    remaining: rows.reduce((s, r) => s + r.remaining, 0),
    overCertified: rows.filter(r => r.overCertified),
    orphanPayments, orphanTotal,
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

/* ═══════════════════ المصروف الفعلي مقابل مقايسة كل مرحلة ═══════════════════
   الرقم الذي طلبه المكتب: صرفنا كام في التأسيس مقابل المقيَّس له؟
   المقارنة تتم مع قيمة بنود المرحلة (base) لا مع ما يدفعه العميل (quote) —
   لأن الإشراف والاحتياطي والضريبة ليست مصروفات موردين، وإدخالها في
   المقارنة يجعل كل مرحلة تبدو رابحة وهي ليست كذلك. */
export function phaseBudget(client, byPhase) {
  const spent = {};
  let unassigned = 0;
  for (const e of client?.expenses || []) {
    const amt = Number(e.amount) || 0;
    if (!amt) continue;
    const ph = (e.phase && PHASES.includes(e.phase))
      ? e.phase
      : (e.itemId ? phaseOf(e.itemId, e.scope) : null);
    if (ph && PHASES.includes(ph)) spent[ph] = (spent[ph] || 0) + amt;
    else unassigned += amt;
  }

  const lines = byPhase.phases.map(p => {
    const actual = spent[p.phase] || 0;
    return {
      phase: p.phase,
      planned: p.base,
      spent: actual,
      diff: p.base - actual,
      overrun: actual > p.base + 0.5,
      ratio: p.base > 0 ? actual / p.base : 0,
      empty: p.empty,
    };
  });

  const planned = lines.reduce((s, l) => s + l.planned, 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0) + unassigned;
  return {
    lines, planned, spent: totalSpent, unassigned,
    remaining: planned - totalSpent,
    overruns: lines.filter(l => l.overrun).sort((a, b) => (b.spent - b.planned) - (a.spent - a.planned)),
  };
}

/* ═══════════════════ مصروفات الموقع مصنّفة بنفس فئات التسعير ═══════════════════
   هنا يلتقي الطرفان: ما قدّرناه في تحليل السعر، وما صرفناه فعلًا في الموقع —
   بنفس المفردات. فيصبح السؤال قابلًا للإجابة: خامات التأسيس قدّرناها ٥٠ ألفًا
   وصرفنا ٦٥ — الفارق في الخامة لا في العمالة. */
export function siteSpendByKind(client) {
  const byPhase = {};
  const byKind = emptyAnalysis();
  let unassigned = 0, total = 0;
  const direct = {};      // itemId -> مبلغ منسوب لبند بعينه
  const indirect = {};    // phase  -> مبلغ يخصّ المرحلة بلا بند

  for (const p of PHASES) {
    byPhase[p] = { phase: p, kinds: emptyAnalysis(), total: 0, directTotal: 0, indirectTotal: 0 };
  }

  for (const e of client?.expenses || []) {
    const amt = (Number(e.amount) || 0) + (Number(e.retained) || 0);   // العمل المُستحق لا النقد فقط
    if (!amt) continue;
    total += amt;

    const kind = COST_KINDS.includes(e.kind) ? e.kind : "other";
    byKind[kind] += amt;

    const ph = (e.phase && PHASES.includes(e.phase))
      ? e.phase
      : (e.itemId ? phaseOf(e.itemId, e.scope) : null);

    if (!ph || !PHASES.includes(ph)) { unassigned += amt; continue; }

    const bucket = byPhase[ph];
    bucket.kinds[kind] += amt;
    bucket.total += amt;
    if (e.itemId) {
      bucket.directTotal += amt;
      direct[e.itemId] = (direct[e.itemId] || 0) + amt;
    } else {
      /* بلا بند: مصروف موقع غير مباشر (ونش، معدة، نقل، أمن) —
         يخصّ المرحلة كلها ويُوزَّع لاحقًا بالتناسب. */
      bucket.indirectTotal += amt;
      indirect[ph] = (indirect[ph] || 0) + amt;
    }
  }

  return {
    phases: PHASES.map(p => byPhase[p]),
    byKind, total, unassigned, direct, indirect,
  };
}

/* المخطط مقابل الفعلي — لكل مرحلة ولكل فئة، والفارق بينهما.
   plannedAnalysis يأتي من costAnalysis في دفتر الأسعار. */
export function plannedVsActual(client, plannedAnalysis) {
  const actual = siteSpendByKind(client);
  const actualByPhase = Object.fromEntries(actual.phases.map(p => [p.phase, p]));

  const phases = PHASES.map(name => {
    const plan = plannedAnalysis.phases.find(p => p.phase === name)
      || { kinds: emptyAnalysis(), analysed: 0, unanalysed: 0, total: 0 };
    const act = actualByPhase[name];
    const kinds = COST_KINDS.map(k => {
      const planned = plan.kinds[k] || 0;
      const spent = act.kinds[k] || 0;
      return {
        kind: k, planned, spent,
        diff: planned - spent,
        overrun: spent > planned + 0.5,
        ratio: planned > 0 ? spent / planned : (spent > 0 ? Infinity : 0),
        /* لا مخطط ولا فعلي = سطر صامت، لا يُعرض ولا يُحسب تجاوزًا */
        silent: planned <= 0 && spent <= 0,
      };
    });
    return {
      phase: name,
      kinds,
      planned: plan.analysed,
      unanalysedPlan: plan.unanalysed,
      spent: act.total,
      diff: plan.analysed - act.total,
      overrun: act.total > plan.analysed + 0.5 && plan.analysed > 0,
      indirect: act.indirectTotal,
      /* التحذير الأهم: مرحلة صُرف عليها ولم تُحلَّل تكلفتها أصلًا —
         المقارنة هنا بلا معنى، وقول ذلك أصدق من عرض فارق مخترع. */
      comparable: plan.analysed > 0,
    };
  });

  const totals = COST_KINDS.map(k => {
    const planned = plannedAnalysis.byKind[k] || 0;
    const spent = actual.byKind[k] || 0;
    return { kind: k, planned, spent, diff: planned - spent, overrun: spent > planned + 0.5 };
  });

  return {
    phases, totals,
    plannedTotal: plannedAnalysis.totalCost,
    spentTotal: actual.total,
    diff: plannedAnalysis.totalCost - actual.total,
    unassigned: actual.unassigned,
    coverage: plannedAnalysis.coverage,
    worstKind: totals.filter(t => t.overrun).sort((a, b) => (b.spent - b.planned) - (a.spent - a.planned))[0] || null,
  };
}

/* التكلفة الفعلية لكل بند = مصروفاته المباشرة + نصيبه من مصروفات
   الموقع غير المباشرة في مرحلته، موزّعةً بالتناسب مع قيمته المخططة. */
export function itemActualCost(client, plannedAnalysis) {
  const spend = siteSpendByKind(client);
  const out = {};
  let undistributed = 0;

  for (const phase of PHASES) {
    const planLines = plannedAnalysis.lines.filter(l => l.phase === phase);
    const pool = spend.indirect[phase] || 0;
    const { shares, undistributed: left } = distributeIndirect(
      pool,
      planLines.map(l => ({ id: l.id, weight: l.revenue })),
    );
    undistributed += left;
    for (const s of shares) {
      out[s.id] = { direct: spend.direct[s.id] || 0, indirect: s.share };
    }
  }
  /* مصروف مباشر لبند خارج التحليل (بند غير محلَّل مثلًا) لا يسقط */
  for (const [id, v] of Object.entries(spend.direct)) {
    if (!out[id]) out[id] = { direct: v, indirect: 0 };
  }

  const lines = plannedAnalysis.lines.map(l => {
    const a = out[l.id] || { direct: 0, indirect: 0 };
    const actual = a.direct + a.indirect;
    return {
      id: l.id, name: l.name, phase: l.phase,
      planned: l.cost, revenue: l.revenue,
      directSpend: a.direct, indirectShare: a.indirect, actual,
      diff: l.cost - actual,
      overrun: actual > l.cost + 0.5,
      actualProfit: l.revenue - actual,
      actualRatio: l.revenue > 0 ? (l.revenue - actual) / l.revenue : null,
    };
  });

  return {
    lines,
    undistributed,
    overruns: lines.filter(l => l.overrun).sort((a, b) => (b.actual - b.planned) - (a.actual - a.planned)),
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
