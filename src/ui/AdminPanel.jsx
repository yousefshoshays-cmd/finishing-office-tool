import React, { useState, useEffect, useMemo } from "react";
import { Loader2, AlertCircle, RefreshCw, Search } from "lucide-react";
import { listOrgs, summary, setLicense, setSeats, renameOrg, orgHealth, activityNote } from "../data/admin.js";

const NAVY = "#1F4E78";
const BORDER = "#E2E8F0";
const TEXT = "#0F172A";
const MUTED = "#64748B";

const TONES = {
  ok:     { bg: "#ECFDF5", fg: "#047857" },
  warn:   { bg: "#FFF7E6", fg: "#8A6D00" },
  danger: { bg: "#FEF2F2", fg: "#B42318" },
};

function Stat({ label, value, tone }) {
  const t = TONES[tone] || { bg: "#F1F5F9", fg: NAVY };
  return (
    <div className="rounded-xl p-3 text-center" style={{ backgroundColor: t.bg }}>
      <div className="text-2xl font-bold" style={{ color: t.fg }}>{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold" style={{ color: t.fg }}>{label}</div>
    </div>
  );
}

/* ── لوحة إدارة المنصّة ───────────────────────────────────────────────────
   تظهر لمدير المنصّة فقط. الغرض منها إلغاء الحاجة لفتح SQL Editor نهائيًا:
   كل تفعيل أو تمديد أو إيقاف صار زرًا. */
export default function AdminPanel({ onToast, onError }) {
  const [orgs, setOrgs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([listOrgs(), summary()]);
      setOrgs(list);
      setStats(s);
    } catch (e) {
      onError?.("تعذّر تحميل المكاتب: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const act = async (org, action, extra) => {
    setBusy(org.id + action);
    try {
      const msg = await setLicense(org.id, action, extra);
      onToast?.(`${org.name}: ${msg}`);
      await load();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? orgs.filter(o =>
          o.name.toLowerCase().includes(needle) ||
          (o.ownerEmail || "").toLowerCase().includes(needle))
      : orgs;
    // الأقرب انتهاءً أولًا — هؤلاء من تحتاج الاتصال بهم اليوم
    return [...list].sort((a, b) => a.daysLeft - b.daysLeft);
  }, [orgs, q]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3" style={{ color: MUTED }}>
          <Loader2 className="animate-spin" size={26} />
          <div className="text-sm">جاري تحميل المكاتب…</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold" style={{ color: NAVY }}>إدارة المنصّة</h2>
          <p className="mt-1 text-xs" style={{ color: MUTED }}>
            المكاتب المشتركة وحالة تراخيصها. هذه الصفحة لا تظهر لأي مكتب.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold"
                style={{ border: `1px solid ${BORDER}`, color: TEXT }}>
          <RefreshCw size={13} /> تحديث
        </button>
      </div>

      {stats && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="إجمالي المكاتب" value={stats.total} />
          <Stat label="مشتركة" value={stats.active} tone="ok" />
          <Stat label="تجربة" value={stats.trial} tone="warn" />
          <Stat label="تنتهي خلال ٣ أيام" value={stats.expiringSoon} tone="danger" />
          <Stat label="منتهية" value={stats.expired} tone="danger" />
        </div>
      )}

      {stats?.expiringSoon > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg p-3 text-xs leading-5"
             style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            {stats.expiringSoon} مكتب على وشك الانتهاء. هذه أفضل لحظة للاتصال —
            المكتب الذي يستخدم الأداة يوميًا يجدّد، والخامل يحتاج مكالمة شرح لا مكالمة بيع.
          </span>
        </div>
      )}

      <div className="relative mt-4">
        <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
        <input
          className="w-full rounded-lg py-2 pr-9 pl-3 text-sm"
          style={{ border: `1px solid ${BORDER}` }}
          placeholder="ابحث باسم المكتب أو بريد المالك"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-8 text-center text-sm" style={{ color: MUTED }}>
          {q ? "لا نتائج مطابقة" : "لا توجد مكاتب مسجّلة بعد."}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.map(org => {
            const h = orgHealth(org);
            const t = TONES[h.tone];
            const isBusy = busy?.startsWith(org.id);
            return (
              <div key={org.id} className="rounded-xl p-4"
                   style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {editing === org.id ? (
                      <input
                        autoFocus
                        defaultValue={org.name}
                        className="rounded-md px-2 py-1 text-sm font-bold"
                        style={{ border: `1px solid ${BORDER}` }}
                        onKeyDown={async e => {
                          if (e.key === "Enter") {
                            try {
                              await renameOrg(org.id, e.target.value);
                              setEditing(null);
                              await load();
                            } catch (err) { onError?.(err.message); }
                          }
                          if (e.key === "Escape") setEditing(null);
                        }}
                        onBlur={() => setEditing(null)}
                      />
                    ) : (
                      <div className="truncate text-sm font-bold" style={{ color: NAVY }}
                           onDoubleClick={() => setEditing(org.id)} title="نقرة مزدوجة لتعديل الاسم">
                        {org.name}
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-xs" style={{ color: MUTED }}>
                      {org.ownerEmail} · {activityNote(org)}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
                        style={{ backgroundColor: t.bg, color: t.fg }}>
                    {h.label}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: MUTED }}>
                  <span>الأعضاء: {org.members} / {org.seats}</span>
                  {org.pending > 0 && <span style={{ color: "#8A6D00" }}>بانتظار موافقة: {org.pending}</span>}
                  <span>كود الدعوة: <code className="font-bold">{org.inviteCode}</code></span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={isBusy} onClick={() => act(org, "activate_month")}
                          className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                          style={{ backgroundColor: NAVY }}>
                    تفعيل شهر
                  </button>
                  <button disabled={isBusy} onClick={() => act(org, "activate_year")}
                          className="rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                          style={{ backgroundColor: "#FCE9B5", color: "#8A6D00" }}>
                    تفعيل سنة
                  </button>
                  <button disabled={isBusy} onClick={() => act(org, "extend_trial", 7)}
                          className="rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                          style={{ border: `1px solid ${BORDER}`, color: TEXT }}>
                    +٧ أيام تجربة
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={async () => {
                      const n = window.prompt(`عدد المقاعد لمكتب "${org.name}"`, String(org.seats));
                      if (!n) return;
                      try { onToast?.(await setSeats(org.id, Number(n))); await load(); }
                      catch (e) { onError?.(e.message); }
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                    style={{ border: `1px solid ${BORDER}`, color: TEXT }}>
                    المقاعد
                  </button>
                  {org.status === "suspended" ? (
                    <button disabled={isBusy} onClick={() => act(org, "reactivate")}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                            style={{ border: `1px solid ${BORDER}`, color: "#047857" }}>
                      إعادة تفعيل
                    </button>
                  ) : (
                    <button disabled={isBusy} onClick={() => act(org, "suspend")}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                            style={{ border: `1px solid ${BORDER}`, color: "#B42318" }}>
                      إيقاف
                    </button>
                  )}
                  {isBusy && <Loader2 className="animate-spin self-center" size={14} style={{ color: MUTED }} />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-center text-[11px]" style={{ color: MUTED }}>
        الإيقاف لا يحذف بيانات المكتب — يبقى قادرًا على القراءة والتصدير.
      </p>
    </div>
  );
}
