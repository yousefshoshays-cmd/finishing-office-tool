/* ════════════════════════════════════════════════════════════════════════
   دفتر المقاولين — قاعدة بيانات المكتب من الصنّاع
   ------------------------------------------------------------------------
   قبل هذا الملف كان المقاول يوجد فقط داخل المشروع الذي يعمل فيه: اسم
   وقيمة تعاقد ولا شيء غير ذلك. فإن أردت رقم هاتفه بحثت في مشروع قديم،
   وإن أردت أن تعرف هل هو جيّد سألت ذاكرتك.

   هنا يصير للمقاول سجلّ مستقل يبقى بعد انتهاء المشروع:
     • هاتف يُتصل به بضغطة
     • الصنائع التي يتقنها — فتبحث بها حين تحتاج معلّم كهرباء لا نجّار
     • تقييم بالنجوم من واقع عملك معه
     • وحساب جارٍ يجمع رصيده في كل مشروع على حدة

   قرار الربط: المفتاح هو الاسم بعد التوحيد (مسافة واحدة، حروف موحّدة)
   لا معرّف داخلي. السبب عملي: المكتب يكتب الاسم في المشروع أولًا ثم
   يفكّر في الدفتر لاحقًا؛ فلو كان الربط بمعرّف لبقيت الارتباطات معلّقة.
   وبالاسم يظهر كل من عمل معك تلقائيًا في الدفتر ولو لم تسجّله.
   ══════════════════════════════════════════════════════════════════════ */

export const TRADES = [
  "محارة وبياض", "كهرباء", "سباكة", "تكييف", "نجارة", "ألوميتال",
  "جبس بورد", "دهانات", "سيراميك ورخام", "حدادة", "عزل",
  "أرضيات خشبية", "زجاج", "مطابخ", "أثاث", "هدم وتكسير", "نقل ومخلفات",
];

export const EMPTY_BOOK = { items: {} };

/* توحيد الاسم: نفس منطق الخادم في هجرة البوابة، حتى لا يفترق
   دفتر المكتب عن حساب دخول المقاول. */
export function ckey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function newContractorRecord(name = "", patch = {}) {
  const now = new Date().toISOString().slice(0, 10);
  return {
    key: ckey(name),
    name: String(name || "").trim().replace(/\s+/g, " "),
    phone: "",
    trades: [],
    rating: 0,          // ٠ = لم يُقيَّم بعد
    notes: "",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export function normalizeBook(book) {
  if (!book || typeof book !== "object") return { ...EMPTY_BOOK };
  return { items: book.items && typeof book.items === "object" ? book.items : {} };
}

export function upsertContractor(book, rec) {
  const b = normalizeBook(book);
  const key = rec.key || ckey(rec.name);
  if (!key) return b;
  const prev = b.items[key];
  return {
    ...b,
    items: {
      ...b.items,
      [key]: {
        ...newContractorRecord(rec.name || prev?.name || ""),
        ...prev,
        ...rec,
        key,
        updatedAt: new Date().toISOString().slice(0, 10),
      },
    },
  };
}

export function removeContractor(book, key) {
  const b = normalizeBook(book);
  const items = { ...b.items };
  delete items[key];
  return { ...b, items };
}

/* التقييم بالنجوم: صفر يعني «لم يُقيَّم» لا «سيئ» — والفرق بينهما مهم
   حين تقرّر مع من تعمل في المشروع القادم. */
export function rateContractor(book, key, stars) {
  const b = normalizeBook(book);
  const rec = b.items[key];
  if (!rec) return b;
  const r = Math.max(0, Math.min(5, Math.round(Number(stars) || 0)));
  return upsertContractor(b, { ...rec, rating: r });
}

/* ═══════════ الحساب الجاري ═══════════
   المعتمد = المصروف + المحتجز.
   المحتجز عمل نُفّذ واستُحق ولم يُصرف بعد؛ عدّه مصروفًا يُنقص رصيد
   المقاول ظلمًا، وإهماله يجعل المكتب يظن أنه ما زال مدينًا بكامله. */
export function projectBalance(client, contractor) {
  const expenses = (client?.expenses || []).filter(e => e.contractorId === contractor.id);
  const paid = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const retained = expenses.reduce((s, e) => s + (Number(e.retained) || 0), 0);
  const contractValue = Number(contractor.contractValue) || 0;
  const certified = paid + retained;
  return {
    clientId: client.id,
    clientName: client.name || "بدون اسم",
    phase: contractor.phase || "",
    trade: contractor.trade || "",
    contractValue, paid, retained, certified,
    remaining: contractValue - certified,
    payments: expenses.length,
    overCertified: contractValue > 0 && certified > contractValue + 0.5,
    settled: contractValue > 0 && Math.abs(certified - contractValue) <= 0.5,
  };
}

/* الدفتر الكامل: سجلّات المكتب + كل من عمل في مشروع ولو لم يُسجَّل */
export function directory(book, clients = []) {
  const b = normalizeBook(book);
  const rows = new Map();

  const ensure = (name) => {
    const key = ckey(name);
    if (!key) return null;
    if (!rows.has(key)) {
      const rec = b.items[key];
      rows.set(key, {
        key,
        name: rec?.name || String(name).trim().replace(/\s+/g, " "),
        phone: rec?.phone || "",
        trades: Array.isArray(rec?.trades) ? [...rec.trades] : [],
        rating: Number(rec?.rating) || 0,
        notes: rec?.notes || "",
        inBook: !!rec,
        projects: [],
        totals: { contracted: 0, paid: 0, retained: 0, certified: 0, remaining: 0 },
        overCount: 0,
      });
    }
    return rows.get(key);
  };

  /* أولًا سجلّات الدفتر — فيظهر المقاول ولو لم يُسند إليه عمل بعد */
  for (const rec of Object.values(b.items)) ensure(rec.name);

  for (const c of clients) {
    for (const k of c.contractors || []) {
      const row = ensure(k.name);
      if (!row) continue;
      const bal = projectBalance(c, k);
      row.projects.push(bal);
      row.totals.contracted += bal.contractValue;
      row.totals.paid += bal.paid;
      row.totals.retained += bal.retained;
      row.totals.certified += bal.certified;
      row.totals.remaining += bal.remaining;
      if (bal.overCertified) row.overCount++;
      /* الصنعة المكتوبة في المشروع تُضاف للدفتر إن لم تكن مسجّلة —
         الملاحظة الميدانية أصدق من الاستمارة. */
      if (k.trade && !row.trades.includes(k.trade)) row.trades.push(k.trade);
    }
  }

  return [...rows.values()].sort((a, b2) => {
    if (b2.totals.contracted !== a.totals.contracted) return b2.totals.contracted - a.totals.contracted;
    return a.name.localeCompare(b2.name, "ar");
  });
}

export function bookTotals(rows) {
  return rows.reduce((t, r) => ({
    contractors: t.contractors + 1,
    contracted: t.contracted + r.totals.contracted,
    paid: t.paid + r.totals.paid,
    retained: t.retained + r.totals.retained,
    remaining: t.remaining + r.totals.remaining,
    rated: t.rated + (r.rating > 0 ? 1 : 0),
  }), { contractors: 0, contracted: 0, paid: 0, retained: 0, remaining: 0, rated: 0 });
}

/* بحث واحد يغطي الاسم والصنعة والهاتف — لأن المكتب يتذكّر أحدها فقط */
export function searchRows(rows, query) {
  const q = String(query || "").trim();
  if (!q) return rows;
  const nq = q.replace(/\s+/g, " ");
  return rows.filter(r =>
    r.name.includes(nq) ||
    (r.phone || "").includes(nq) ||
    r.trades.some(t => t.includes(nq)) ||
    r.projects.some(p => (p.clientName || "").includes(nq)));
}
