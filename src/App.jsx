import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users, LayoutDashboard, Settings, Plus, Trash2, Download,
  Phone, MapPin, Ruler, ChevronLeft, Save, X, AlertCircle, Loader2,
  FileSpreadsheet, ExternalLink, FileText, PartyPopper, UploadCloud, ShieldCheck, Wifi, ChevronDown,
} from "lucide-react";

import {
  getCloudConfig, setCloudConfig, isCloudMode, isSimpleMode, getSupabase, withTimeout,
  storageGet, storageSet, storageDelete, storageListKeys, storageGetAllEntries,
  DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY,
} from "./data/storage.js";
import { fetchMyProfile, fetchAllProfiles, approveProfile } from "./data/profiles.js";
import { newVisit, loadVisits, saveVisit, deleteVisitEntry } from "./data/visits.js";
import { ROLES, ASSIGNABLE_ROLES, PERMISSIONS, can, roleLabel } from "./domain/permissions.js";
import { ITEMS, SPECS, fmt, DEFAULT_SETTINGS } from "./domain/catalogue.js";
import {
  newClient, resolveItem, calcClient, migrateClient, progressFromVisits,
  ownsClient, linkEngineer, buildContractSnapshot, amendContract, effectiveTotals,
} from "./domain/pricing.js";
import {
  NAVY, NAVY_DARK, GOLD, LIGHT, BORDER, TEXT, MUTED,
  LEVELS, LEVEL_COLORS, SCOPES, STAGES, STAGE_COLORS,
} from "./ui/tokens.js";
import { PAYMENT_STAGES, generateContractDocx, downloadDocx } from "./export/docx.js";
import { buildAndDownloadClientPptx } from "./export/pptx.js";
import { exportFullBOQ, exportPipelineSummary } from "./export/excel.js";

/* ============================= Excel control hub ============================= */
function ExcelHub({ clients, settings, onUpdate }) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");

  const visible = useMemo(() => {
    let list = clients.filter(c => !query.trim() ||
      (c.name || "").toLowerCase().includes(query.trim().toLowerCase()) ||
      (c.engineer || "").toLowerCase().includes(query.trim().toLowerCase()));
    const calcOf = (c) => effectiveTotals(c, settings).grandTotal;
    switch (sortBy) {
      case "value_desc": list = [...list].sort((a, b) => calcOf(b) - calcOf(a)); break;
      case "value_asc": list = [...list].sort((a, b) => calcOf(a) - calcOf(b)); break;
      case "progress_desc": list = [...list].sort((a, b) => (b.progressPercent || 0) - (a.progressPercent || 0)); break;
      case "name_asc": list = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar")); break;
      default: list = [...list].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    }
    return list;
  }, [clients, query, sortBy, settings]);

  const SortHeader = ({ label, sortKey }) => (
    <th className="p-3 text-center font-bold">
      <button onClick={() => setSortBy(sortKey)} className="inline-flex items-center gap-1 hover:opacity-80">
        {label}
        <ChevronDown size={12} style={{ opacity: sortBy === sortKey ? 1 : 0.4 }} />
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-navy">لوحة تحكم إكسل — كل ملفات كل عميل في مكان واحد</h2>
          <p className="mt-1 text-xs text-muted">مقايسة Excel كاملة، رابط مجلد الملفات (العقد والعرض التقديمي ونموذج التسليم)، وتصدير ملخص شامل.</p>
        </div>
        <button onClick={() => exportPipelineSummary(clients, settings)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white shadow-sm bg-navy">
          <Download size={16} /> تصدير ملخص كل العملاء
        </button>
      </div>

      {clients.length > 0 && (
        <div className="mb-3">
          <input
            placeholder="بحث بالاسم أو المهندس المسؤول..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full max-w-sm rounded-lg py-2 px-3 text-sm"
            style={{ border: `1px solid ${BORDER}` }}
          />
        </div>
      )}

      {clients.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ backgroundColor: "#FFFFFF", border: `1px dashed ${BORDER}`, color: MUTED }}>
          لا يوجد عملاء بعد.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: NAVY, color: "#FFFFFF" }}>
                <SortHeader label="العميل" sortKey="name_asc" />
                <th className="p-3 text-center font-bold">المهندس المسؤول</th>
                <SortHeader label="التقدم بالموقع" sortKey="progress_desc" />
                <th className="p-3 text-center font-bold">المرحلة</th>
                <SortHeader label="الإجمالي" sortKey="value_desc" />
                <th className="p-3 text-center font-bold">المقايسة</th>
                <th className="p-3 text-center font-bold">العرض التقديمي</th>
                <th className="p-3 text-center font-bold">العقد</th>
                <th className="p-3 text-right font-bold">رابط مجلد الملفات</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => {
                const calc = effectiveTotals(c, settings);
                const contractReady = c.stage === "تم التعاقد" || c.stage === "قيد التنفيذ" || c.stage === "تم التسليم";
                return (
                  <tr key={c.id} style={{ backgroundColor: i % 2 ? "#FFFFFF" : LIGHT, borderTop: `1px solid ${BORDER}` }}>
                    <td className="p-3 font-semibold">{c.name || "بدون اسم"}</td>
                    <td className="p-3 text-center text-xs text-muted">{c.engineer || "—"}</td>
                    <td className="p-3 text-center">
                      {c.progressPercent > 0 ? (
                        <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: "#E2EFDA", color: "#1E7B45" }}>{c.progressPercent}%</span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center"><Badge text={c.stage} color={STAGE_COLORS[c.stage] || MUTED} /></td>
                    <td className="p-3 text-center font-bold text-navy">{fmt(calc.grandTotal)} ج.م</td>
                    <td className="p-3 text-center">
                      <button onClick={() => exportFullBOQ(c, settings)} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "#E2EFDA", color: "#1E7B45" }}>
                        <FileSpreadsheet size={13} /> تحميل
                      </button>
                    </td>
                    <td className="p-3 text-center">
                      <button onClick={() => buildAndDownloadClientPptx(c, calc, settings)} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "#DCE6F5", color: "#2E5395" }}>
                        <FileText size={13} /> تحميل
                      </button>
                    </td>
                    <td className="p-3 text-center">
                      {contractReady ? (
                        <button onClick={() => downloadDocx(`عقد_${c.name || "عميل"}.docx`, generateContractDocx(c, calc))} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "#FCE9B5", color: "#8A6D00" }}>
                          <FileText size={13} /> تحميل العقد
                        </button>
                      ) : (
                        <span className="text-xs text-muted">بعد التعاقد</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={c.folderLink || ""}
                          onChange={e => onUpdate(c.id, { folderLink: e.target.value })}
                          placeholder="الصق رابط مجلد Google Drive هنا"
                          className="flex-1 rounded-md px-2 py-1.5 text-xs"
                          style={{ border: `1px solid ${BORDER}` }}
                        />
                        {c.folderLink && (
                          <a href={c.folderLink} target="_blank" rel="noreferrer" className="text-navy">
                            <ExternalLink size={15} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-xl p-4 text-xs leading-6" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}`, color: MUTED }}>
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>
          "المقايسة الكاملة" تُصدَّر بنفس الـ 44 بندًا المستخدمة في ملف المكتب الأساسي، بأسعار ومستويات هذا العميل تحديدًا.
          "العقد" يظهر تلقائيًا للتحميل بمجرد وصول العميل لمرحلة "تم التعاقد" من تبويب العملاء، ويكون مملوءًا بجدول الدفعات الفعلي المحسوب من إجمالي سعره.
          رابط مجلد الملفات مكان تخزّن فيه نسخ العرض التقديمي واستمارة التفضيلات ونموذج التسليم الخاصة بهذا العميل (Google Drive أو أي مساحة تخزين تستخدمها).
        </span>
      </div>
    </div>
  );
}

function Badge({ text, color }) {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ backgroundColor: color + "1A", color }}>
      {text}
    </span>
  );
}

function StatCard({ label, value, sub, accent, icon: Icon }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold text-muted">{label}</div>
          <div className="mt-1 text-2xl font-bold" style={{ color: accent || NAVY }}>{value}</div>
          {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
        </div>
        {Icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: (accent || NAVY) + "1A" }}>
            <Icon size={18} style={{ color: accent || NAVY }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================= Lightweight SVG charts (no extra dependency) ============================= */
function StageValueChart({ stats }) {
  const maxVal = Math.max(1, ...STAGES.map(s => stats.byStage[s].value));
  return (
    <div className="flex flex-col gap-2.5">
      {STAGES.map(s => {
        const val = stats.byStage[s].value;
        const pct = (val / maxVal) * 100;
        return (
          <div key={s} className="flex items-center gap-3">
            <span className="shrink-0 text-xs font-semibold text-ink" style={{ width: 96 }}>{s}</span>
            <div className="relative h-6 flex-1 overflow-hidden rounded bg-light">
              <div
                className="absolute inset-y-0 right-0 rounded transition-all"
                style={{ width: val > 0 ? `max(${pct}%, 4px)` : 0, backgroundColor: STAGE_COLORS[s] || NAVY }}
              />
            </div>
            <span className="shrink-0 text-left text-xs font-bold tabular-nums text-navy" style={{ width: 78 }}>
              {val > 0 ? fmt(val) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MonthlyTrendChart({ clients, settings }) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("ar-EG", { month: "short" }) });
  }
  const byMonth = Object.fromEntries(months.map(m => [m.key, { count: 0, value: 0 }]));
  clients.forEach(c => {
    const key = (c.createdAt || "").slice(0, 7);
    if (byMonth[key]) {
      byMonth[key].count += 1;
      byMonth[key].value += effectiveTotals(c, settings).grandTotal;
    }
  });
  const maxVal = Math.max(1, ...months.map(m => byMonth[m.key].value));
  const label = (v) => v >= 1000000 ? (v / 1000000).toFixed(1) + "م" : v >= 1000 ? Math.round(v / 1000) + "ألف" : fmt(v);

  return (
    <div className="flex items-end justify-between gap-2" style={{ height: 190 }}>
      {months.map(m => {
        const val = byMonth[m.key].value;
        // 78% كحد أقصى لارتفاع العمود: يترك مساحة مضمونة للرقم فوقه مهما بلغت القيمة
        const pct = val > 0 ? Math.max((val / maxVal) * 78, 2) : 0;
        return (
          <div key={m.key} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
            <span className="text-[10px] font-bold tabular-nums text-navy" style={{ minHeight: 14 }}>
              {val > 0 ? label(val) : ""}
            </span>
            <div
              className="w-full rounded-t transition-all"
              style={{ height: `${pct}%`, maxWidth: 44, backgroundColor: val > 0 ? GOLD : "transparent" }}
            />
            <span className="text-[11px] font-semibold text-muted">{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ============================= App ============================= */
function AppInner() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [tab, setTab] = useState("dashboard"); // dashboard | clients | settings
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [team, setTeam] = useState([]);
  const [pendingMembers, setPendingMembers] = useState([]);
  const [currentMember, setCurrentMember] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const cloud = isCloudMode();
  const simpleMode = cloud && isSimpleMode();

  const reloadAll = useCallback(async () => {
    const settingsVal = await storageGet("settings:global", DEFAULT_SETTINGS);
    setSettings(settingsVal);
    const keys = await storageListKeys("client:");
    const loaded = [];
    for (const k of keys) {
      const c = await storageGet(k, null);
      // الهجرة تحدث في الذاكرة عند القراءة، وتُحفظ عند أول تعديل.
      // لا نكتب على القرص هنا حتى لا نلمس بيانات لم يطلب المستخدم تغييرها.
      if (c) loaded.push(migrateClient(c));
    }
    loaded.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    setClients(loaded);
    if (!isCloudMode()) {
      const teamVal = await storageGet("settings:team", []);
      setTeam(teamVal);
      return teamVal;
    }
    return [];
  }, []);

  // Simple mode: zero-friction shared access for early testing. Any device that opens
  // this URL gets an anonymous Supabase session automatically — no signup, no approval,
  // full read/write for everyone. This intentionally has NO real access control; it exists
  // so the whole office can pile in and test the sheets/mood board/data together while the
  // real per-person login (see checkCloudStatus below) is switched off temporarily.
  const ensureSimpleSession = useCallback(async () => {
    const sb = getSupabase();
    const { data } = await withTimeout(sb.auth.getSession(), 8000);
    let user = data?.session?.user;
    if (!user) {
      const { data: signData, error } = await withTimeout(sb.auth.signInAnonymously(), 10000);
      if (error) {
        // الوضع المبسط مقفول على الخادم (وهو الصواب)، لكن هذا المتصفح لا يزال
        // يحمل إعدادًا قديمًا محفوظًا يطلبه. ننتقل تلقائيًا للوضع الكامل بدل
        // إظهار خطأ لا مخرج منه — المستخدم لا يجب أن يعرف شيئًا عن localStorage.
        const msg = String(error.message || "").toLowerCase();
        if (msg.includes("anonymous") || msg.includes("disabled")) {
          const cfg = getCloudConfig();
          if (cfg) setCloudConfig({ ...cfg, simpleMode: false });
          // simpleMode مشتقّة من localStorage وقت الرسم، لا حالة React — فإعادة
          // التحميل هي الطريقة الموثوقة لالتقاط الإعداد الجديد مرة واحدة.
          window.location.reload();
          return;
        }
        throw error;
      }
      user = signData.user;
    }
    let displayName = "";
    try { displayName = window.localStorage.getItem("boq_display_name") || ""; } catch {}
    setCurrentMember({ id: user.id, name: displayName || "زائر (وضع تجريبي)", role: "owner", email: "" });
    setPendingApproval(false);
  }, []);

  // Cloud mode: check this browser's actual signed-in Supabase user against the
  // server-side profiles table. Role comes only from the database, never from
  // anything the client claims — that's what closes the self-appointment hole.
  const checkCloudStatus = useCallback(async () => {
    const sb = getSupabase();
    const { data } = await withTimeout(sb.auth.getSession(), 8000);
    const user = data?.session?.user;
    if (!user) { setCurrentMember(null); setPendingApproval(false); return; }
    const profile = await fetchMyProfile(user.id);
    if (!profile || profile.role === "pending") {
      setCurrentMember(null);
      setPendingApproval(true);
      return;
    }
    setPendingApproval(false);
    setCurrentMember({ id: profile.id, name: profile.name, role: profile.role, email: profile.email });
    const all = await fetchAllProfiles();
    setTeam(all.filter(p => p.role !== "pending").map(p => ({ id: p.id, name: p.name, role: p.role, email: p.email })));
    setPendingMembers(all.filter(p => p.role === "pending"));
  }, []);

  const [connectionError, setConnectionError] = useState(false);
  const [connectionErrorDetail, setConnectionErrorDetail] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setConnectionError(false);
      setConnectionErrorDetail("");
      try {
        if (simpleMode) {
          await withTimeout(ensureSimpleSession(), 10000);
          await withTimeout(reloadAll(), 10000);
        } else if (cloud) {
          await withTimeout(checkCloudStatus(), 10000);
          await withTimeout(reloadAll(), 10000);
        } else {
          const teamVal = await withTimeout(reloadAll(), 10000);
          const session = await storageGet("session:current", null);
          if (session && teamVal.some(m => m.id === session.memberId)) {
            setCurrentMember(teamVal.find(m => m.id === session.memberId));
          }
        }
      } catch (e) {
        console.error("startup failed", e);
        if (cloud) {
          setConnectionError(true);
          setConnectionErrorDetail(e?.message || String(e));
        }
      }
      setLoading(false);
    })();
  }, [cloud, simpleMode, reloadAll, checkCloudStatus, ensureSimpleSession]);

  // Realtime sync: when cloud mode is active, refresh data automatically when any
  // teammate on another device changes clients, settings, or the team roster — and
  // instantly unlock a pending user's screen the moment an owner approves them.
  useEffect(() => {
    if (!cloud || (!currentMember && !pendingApproval)) return;
    const sb = getSupabase();
    let channel = sb.channel("kv-and-profile-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "kv" }, () => {
        reloadAll();
      });
    if (!simpleMode) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        checkCloudStatus();
      });
    }
    channel.subscribe();
    return () => { sb.removeChannel(channel); };
  }, [cloud, simpleMode, currentMember, pendingApproval, reloadAll, checkCloudStatus]);

  const saveTeam = async (next) => {
    setTeam(next);
    await storageSet("settings:team", next);
  };
  const addTeamMember = async (name, role, email) => {
    const member = { id: "m" + Date.now() + Math.floor(Math.random() * 1000), name, role, email: email || "" };
    await saveTeam([...team, member]);
    return member;
  };
  const removeTeamMember = async (id) => {
    await saveTeam(team.filter(m => m.id !== id));
  };
  const signIn = async (member) => {
    setCurrentMember(member);
    if (!cloud) await storageSet("session:current", { memberId: member.id });
  };
  const signOut = async () => {
    setCurrentMember(null);
    setPendingApproval(false);
    if (cloud) {
      const sb = getSupabase();
      await sb.auth.signOut();
    } else {
      await storageDelete("session:current");
    }
  };
  const approveMember = async (id, role) => {
    const ok = await approveProfile(id, role);
    if (ok) {
      showToast("تم قبول العضو");
      await checkCloudStatus();
    } else {
      showToast("تعذرت الموافقة — تأكد إنك مسجّل دخول كمالك مكتب");
    }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const saveClient = useCallback(async (client) => {
    setSaving(true);
    await storageSet("client:" + client.id, client);
    setSaving(false);
  }, []);

  const updateClient = (id, patch) => {
    setClients(prev => {
      const before = prev.find(c => c.id === id);
      const next = prev.map(c => (c.id === id ? { ...c, ...patch } : c));
      const updated = next.find(c => c.id === id);
      saveClient(updated);
      if (patch.stage === "تم التعاقد" && before && before.stage !== "تم التعاقد") {
        showToast("🎉 العقد جاهز للتحميل — من تفاصيل العميل أو لوحة تحكم إكسل");
      }
      return next;
    });
  };

  const addClient = async () => {
    const c = newClient();
    if (currentMember && currentMember.role === "engineer") {
      c.engineer = currentMember.name;
      c.engineerId = currentMember.id;
    }
    setClients(prev => [c, ...prev]);
    await saveClient(c);
    setSelectedId(c.id);
    setTab("clients");
    showToast("تمت إضافة عميل جديد");
  };

  const deleteClient = async (id) => {
    await storageDelete("client:" + id);
    setClients(prev => prev.filter(c => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    showToast("تم حذف العميل");
  };

  const saveSettings = async (next) => {
    setSettings(next);
    await storageSet("settings:global", next);
    showToast("تم حفظ الإعدادات");
  };

  const exportBackup = async () => {
    const entries = await storageGetAllEntries();
    const payload = { app: "boq_office_db", version: 1, exportedAt: new Date().toISOString(), entries };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `نسخة_احتياطية_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("تم تصدير النسخة الاحتياطية");
  };

  const importBackup = async (file) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || !Array.isArray(payload.entries)) throw new Error("bad file");
      for (const [key, value] of payload.entries) {
        await storageSet(key, value);
      }
      // reload from storage
      const settingsVal = await storageGet("settings:global", DEFAULT_SETTINGS);
      setSettings(settingsVal);
      const keys = await storageListKeys("client:");
      const loaded = [];
      for (const k of keys) {
        const c = await storageGet(k, null);
        if (c) loaded.push(c);
      }
      loaded.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      setClients(loaded);
      showToast("تم استيراد النسخة الاحتياطية بنجاح");
    } catch (e) {
      console.error(e);
      showToast("تعذّر قراءة ملف النسخة الاحتياطية");
    }
  };

  const selected = clients.find(c => c.id === selectedId) || null;

  const visibleClients = useMemo(() => {
    if (!currentMember || can(currentMember, "viewAllClients")) return clients;
    return clients.filter(c => ownsClient(c, currentMember));
  }, [clients, currentMember]);

  const pipelineStats = useMemo(() => {
    const byStage = Object.fromEntries(STAGES.map(s => [s, { count: 0, value: 0 }]));
    let totalValue = 0;
    visibleClients.forEach(c => {
      const calc = effectiveTotals(c, settings);
      const stage = STAGES.includes(c.stage) ? c.stage : STAGES[0];
      byStage[stage].count += 1;
      byStage[stage].value += calc.grandTotal;
      totalValue += calc.grandTotal;
    });
    return { byStage, totalValue, count: visibleClients.length };
  }, [visibleClients, settings]);

  if (loading) {
    return (
      <div dir="rtl" className="flex h-[600px] items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif" }}>
        <div className="flex flex-col items-center gap-3 text-muted">
          <Loader2 className="animate-spin" size={28} />
          <div className="text-sm">جاري تحميل بيانات العملاء…</div>
        </div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div dir="rtl" className="flex min-h-[700px] items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT }}>
        <div className="w-full max-w-md rounded-2xl p-8 text-center shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <div className="mb-2 text-lg font-bold" style={{ color: "#C00000" }}>تعذر الاتصال بالخادم السحابي</div>
          <p className="mb-3 text-sm leading-6 text-muted">
            تأكد من صحة رابط ومفتاح Supabase في الإعدادات، ومن اتصالك بالإنترنت. بياناتك المحلية السابقة لم تتأثر.
          </p>
          {connectionErrorDetail && (
            <div className="mb-5 rounded-lg p-3 text-left text-xs" style={{ backgroundColor: "#FCE9E9", color: "#8A1414", direction: "ltr", wordBreak: "break-word" }}>
              {connectionErrorDetail}
            </div>
          )}
          <button
            onClick={() => window.location.reload()}
            className="mb-2 w-full rounded-lg py-2.5 text-sm font-bold text-white"
            style={{ backgroundColor: "#1E7B45" }}
          >
            إعادة المحاولة
          </button>
          <button
            onClick={() => { setCloudConfig(null); window.location.reload(); }}
            className="w-full rounded-lg py-2.5 text-sm font-bold text-white bg-navy"
          >
            تعطيل المزامنة السحابية والعودة للتخزين المحلي
          </button>
        </div>
      </div>
    );
  }

  if (pendingApproval) {
    return <PendingApprovalScreen onSignOut={signOut} onRefresh={checkCloudStatus} />;
  }

  if (!currentMember) {
    return cloud
      ? <CloudAuthGate onAuthSuccess={checkCloudStatus} />
      : <IdentityGate team={team} onAddMember={addTeamMember} onSignIn={signIn} />;
  }

  return (
    <div dir="rtl" className="min-h-[700px] w-full" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT, color: TEXT }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-navy">
        <div>
          <div className="text-lg font-bold text-white">نظام متابعة العملاء والتسعير</div>
          <div className="text-xs" style={{ color: "#AEB9C6" }}>مكتب __________ للاستشارات المعمارية</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: simpleMode ? "#B45309" : cloud ? "#1E7B45" : "#4B5563", color: "#FFFFFF" }}>
            <Wifi size={12} /> {simpleMode ? "وضع تجريبي مبسط (بدون صلاحيات)" : cloud ? "مزامنة سحابية مفعّلة" : "محلي (بدون مزامنة)"}
          </span>
          {simpleMode ? (
            <span className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: NAVY_DARK, color: "#D9E1F2" }}>
              {currentMember.name}
            </span>
          ) : (
            <button onClick={signOut} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: NAVY_DARK, color: "#D9E1F2" }}>
              <span className="rounded-full px-2 py-0.5 font-bold" style={{ backgroundColor: (ROLES[currentMember.role] || ROLES.engineer).color, color: (ROLES[currentMember.role] || ROLES.engineer).textOn }}>
                {roleLabel(currentMember.role)}
              </span>
              {currentMember.name} — تبديل
            </button>
          )}
        </div>
        <nav className="flex gap-1 rounded-lg p-1" style={{ backgroundColor: NAVY_DARK }}>
          {[
            ["dashboard", "لوحة المتابعة", LayoutDashboard],
            ["clients", "العملاء", Users],
            ["excelHub", "لوحة تحكم إكسل", FileSpreadsheet],
            ["settings", "الإعدادات", Settings],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: tab === key ? GOLD : "transparent",
                color: tab === key ? "#1F1F1F" : "#D9E1F2",
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-lg" style={{ backgroundColor: "#1E7B45" }}>
          {toast}
        </div>
      )}

      <div className="p-6">
        {tab === "dashboard" && (
          <Dashboard stats={pipelineStats} onAdd={addClient} clients={visibleClients} settings={settings} onOpenClient={(id) => { setSelectedId(id); setTab("clients"); }} />
        )}

        {tab === "clients" && !selected && (
          <ClientList clients={visibleClients} onAdd={addClient} onSelect={setSelectedId} onDelete={deleteClient} settings={settings} />
        )}

        {tab === "clients" && selected && (
          <ClientDetail
            client={selected}
            settings={settings}
            saving={saving}
            team={team}
            currentMember={currentMember}
            onBack={() => setSelectedId(null)}
            onChange={(patch) => updateClient(selected.id, patch)}
            onDelete={() => deleteClient(selected.id)}
          />
        )}

        {tab === "excelHub" && (
          <ExcelHub clients={visibleClients} settings={settings} onUpdate={updateClient} />
        )}

        {tab === "settings" && (
          <SettingsPanel
            settings={settings} onSave={saveSettings}
            onExportBackup={exportBackup} onImportBackup={importBackup}
            clientCount={clients.length}
            team={team} currentMember={currentMember}
            onAddMember={addTeamMember} onRemoveMember={removeTeamMember}
            cloud={cloud}
            pendingMembers={pendingMembers} onApproveMember={approveMember}
          />
        )}
      </div>
    </div>
  );
}

/* ============================= Dashboard ============================= */
function Dashboard({ stats, onAdd, clients, settings, onOpenClient }) {
  const recent = clients.slice(0, 5);
  return (
    <div>
      <div className="mb-6 flex items-center justify-between rounded-2xl p-5 bg-navy">
        <div>
          <h2 className="text-xl font-bold text-white">نظرة عامة على خط العملاء</h2>
          <p className="mt-0.5 text-xs" style={{ color: "#AEB9C6" }}>لوحة متابعة شاملة لأداء المكتب</p>
        </div>
        <button onClick={onAdd} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-bold shadow-sm" style={{ backgroundColor: GOLD, color: "#1F1F1F" }}>
          <Plus size={16} /> عميل جديد
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="إجمالي العملاء" value={stats.count} icon={Users} />
        <StatCard label="إجمالي قيمة خط الأعمال" value={fmt(stats.totalValue) + " ج.م"} accent={GOLD} icon={FileSpreadsheet} />
        {STAGES.map(s => (
          <StatCard key={s} label={s} value={stats.byStage[s].count} sub={fmt(stats.byStage[s].value) + " ج.م"} accent={STAGE_COLORS[s]} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <div className="mb-3 text-sm font-bold text-navy">قيمة خط الأعمال حسب المرحلة</div>
          {stats.count > 0 ? <StageValueChart stats={stats} /> : (
            <div className="flex h-40 items-center justify-center text-sm text-muted">لا يوجد بيانات بعد</div>
          )}
        </div>
        <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <div className="mb-3 text-sm font-bold text-navy">نمو خط الأعمال آخر 6 أشهر</div>
          {clients.length > 0 ? <MonthlyTrendChart clients={clients} settings={settings} /> : (
            <div className="flex h-40 items-center justify-center text-sm text-muted">لا يوجد بيانات بعد</div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 text-sm font-bold text-navy">توزيع خط الأعمال حسب المرحلة (بعدد العملاء)</div>
        <div className="flex h-6 w-full overflow-hidden rounded-full bg-light">
          {STAGES.map(s => {
            const pct = stats.count ? (stats.byStage[s].count / stats.count) * 100 : 0;
            return pct > 0 ? <div key={s} style={{ width: pct + "%", backgroundColor: STAGE_COLORS[s] }} title={s} /> : null;
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {STAGES.map(s => <Badge key={s} text={`${s} (${stats.byStage[s].count})`} color={STAGE_COLORS[s]} />)}
        </div>
      </div>

      <div className="mt-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 text-sm font-bold text-navy">أحدث العملاء</div>
        {recent.length === 0 && <div className="text-sm text-muted">لا يوجد عملاء بعد — ابدأ بإضافة أول عميل.</div>}
        <div className="flex flex-col gap-2">
          {recent.map(c => {
            const calc = effectiveTotals(c, settings);
            return (
              <button key={c.id} onClick={() => onOpenClient(c.id)} className="flex items-center justify-between rounded-lg px-3 py-2 text-right transition-colors hover:bg-gray-50" style={{ border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-3">
                  <Badge text={c.stage} color={STAGE_COLORS[c.stage] || MUTED} />
                  <span className="text-sm font-semibold">{c.name || "بدون اسم"}</span>
                </div>
                <span className="text-sm font-bold text-navy">{fmt(calc.grandTotal)} ج.م</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================= Client list ============================= */
function ClientList({ clients, onAdd, onSelect, onDelete, settings }) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");

  const visible = useMemo(() => {
    let list = clients.filter(c => {
      const matchesQuery = !query.trim() || (c.name || "").toLowerCase().includes(query.trim().toLowerCase()) ||
        (c.engineer || "").toLowerCase().includes(query.trim().toLowerCase());
      const matchesStage = !stageFilter || c.stage === stageFilter;
      return matchesQuery && matchesStage;
    });
    const calcOf = (c) => effectiveTotals(c, settings).grandTotal;
    switch (sortBy) {
      case "value_desc": list = [...list].sort((a, b) => calcOf(b) - calcOf(a)); break;
      case "value_asc": list = [...list].sort((a, b) => calcOf(a) - calcOf(b)); break;
      case "name_asc": list = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar")); break;
      case "date_asc": list = [...list].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")); break;
      default: list = [...list].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    }
    return list;
  }, [clients, query, stageFilter, sortBy, settings]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-navy">العملاء ({visible.length}{visible.length !== clients.length ? ` من ${clients.length}` : ""})</h2>
        <button onClick={onAdd} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white shadow-sm bg-navy">
          <Plus size={16} /> عميل جديد
        </button>
      </div>

      {clients.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1" style={{ minWidth: 180 }}>
            <input
              placeholder="بحث بالاسم أو المهندس المسؤول..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full rounded-lg py-2 pr-3 pl-3 text-sm"
              style={{ border: `1px solid ${BORDER}` }}
            />
          </div>
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={{ border: `1px solid ${BORDER}` }}>
            <option value="">كل المراحل</option>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={{ border: `1px solid ${BORDER}` }}>
            <option value="date_desc">الأحدث أولاً</option>
            <option value="date_asc">الأقدم أولاً</option>
            <option value="value_desc">الأعلى قيمة</option>
            <option value="value_asc">الأقل قيمة</option>
            <option value="name_asc">الاسم (أ-ي)</option>
          </select>
        </div>
      )}

      {clients.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ backgroundColor: "#FFFFFF", border: `1px dashed ${BORDER}`, color: MUTED }}>
          لا يوجد عملاء بعد. اضغط "عميل جديد" للبدء.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ backgroundColor: "#FFFFFF", border: `1px dashed ${BORDER}`, color: MUTED }}>
          لا يوجد عملاء مطابقين لهذا البحث/الفلتر.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(c => {
            const calc = effectiveTotals(c, settings);
            return (
              <div key={c.id} className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
                <div className="mb-2 flex items-center justify-between">
                  <Badge text={c.stage} color={STAGE_COLORS[c.stage] || MUTED} />
                  <button onClick={() => onDelete(c.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
                </div>
                <div className="mb-1 text-base font-bold">{c.name || "بدون اسم"}</div>
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted"><MapPin size={12} />{c.address || "بدون عنوان"}</div>
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted"><Ruler size={12} />{c.area} م²</div>
                {c.phone && <div className="mb-2 flex items-center gap-1.5 text-xs text-muted"><Phone size={12} />{c.phone}</div>}
                {(c.stage === "قيد التنفيذ" || c.progressPercent > 0) && (
                  <div className="mb-2">
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
                      <span>نسبة الإنجاز بالموقع</span>
                      <span>{c.progressPercent || 0}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-light">
                      <div className="h-full rounded-full" style={{ width: `${c.progressPercent || 0}%`, backgroundColor: "#1E7B45" }} />
                    </div>
                  </div>
                )}
                <div className="mb-3 rounded-lg px-3 py-2 text-center text-sm font-bold text-white bg-navy">
                  {fmt(calc.grandTotal)} ج.م
                </div>
                <button onClick={() => onSelect(c.id)} className="w-full rounded-lg py-1.5 text-sm font-semibold" style={{ border: `1px solid ${NAVY}`, color: NAVY }}>
                  فتح التفاصيل
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================= Client detail ============================= */
function ClientDetail({ client, settings, saving, team, currentMember, onBack, onChange, onDelete }) {
  const calc = useMemo(() => effectiveTotals(client, settings), [client, settings]);
  const [innerTab, setInnerTab] = useState("pricing"); // pricing | site

  const exportExcel = () => exportFullBOQ(client, settings);

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm font-semibold text-navy">
        <ChevronLeft size={16} /> العودة لقائمة العملاء
      </button>

      {(client.stage === "تم التعاقد" || client.stage === "قيد التنفيذ" || client.stage === "تم التسليم") && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ backgroundColor: "#FCE9B5", border: "1px solid " + GOLD }}>
          <div className="flex items-center gap-2">
            <PartyPopper size={20} style={{ color: "#8A6D00" }} />
            <div>
              <div className="text-sm font-bold" style={{ color: "#5C4700" }}>هذا العميل وصل لمرحلة التعاقد — العقد جاهز للتحميل بجدول دفعات محسوب فعليًا</div>
              <div className="text-xs" style={{ color: "#8A6D00" }}>القيمة الإجمالية: {fmt(calc.grandTotal)} ج.م — يمكن فتح الملف وتعديله في Word مباشرة</div>
            </div>
          </div>
          <button
            onClick={() => downloadDocx(`عقد_${client.name || "عميل"}.docx`, generateContractDocx(client, calc))}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold shadow-sm"
            style={{ backgroundColor: "#1F1F1F", color: "#FFFFFF" }}
          >
            <FileText size={16} /> تحميل العقد الآن
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* left: basic info */}
        <div className="lg:col-span-1">
          <div className="rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold text-navy">بيانات العميل</div>
              <div className="flex items-center gap-2">
                {saving && <Loader2 className="animate-spin text-muted" size={14} />}
                <button onClick={onDelete} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
            </div>
            <Field label="اسم العميل"><input className="inp" value={client.name} onChange={e => onChange({ name: e.target.value })} /></Field>
            <Field label="رقم الهاتف"><input className="inp" value={client.phone} onChange={e => onChange({ phone: e.target.value })} /></Field>
            <Field label="عنوان المشروع"><input className="inp" value={client.address} onChange={e => onChange({ address: e.target.value })} /></Field>
            <Field label="المساحة (م²)"><input type="number" className="inp" value={client.area} onChange={e => onChange({ area: e.target.value })} /></Field>
            <Field label="مرحلة العميل">
              <select
                className="inp"
                value={client.stage}
                onChange={e => {
                  const stage = e.target.value;
                  // عند أول وصول لـ"تم التعاقد" تُلتقط لقطة مجمّدة للمقايسة
                  // والإعدادات. بعدها لا تتغير أرقام العقد مهما عُدّلت الأسعار.
                  if (stage === "تم التعاقد" && !client.contract) {
                    onChange({ stage, contract: buildContractSnapshot(client, settings, currentMember?.name || "") });
                  } else {
                    onChange({ stage });
                  }
                }}
              >
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="المهندس المسؤول">
              <select
                className="inp"
                value={client.engineerId || ""}
                onChange={e => {
                  const m = team.find(x => x.id === e.target.value);
                  onChange({ engineerId: e.target.value, engineer: m ? m.name : "" });
                }}
              >
                <option value="">— غير محدد —</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.name}{m.role === "owner" ? " (المالك)" : ""}</option>)}
              </select>
            </Field>
            <Field label="الأسلوب المفضل"><input className="inp" value={client.style} onChange={e => onChange({ style: e.target.value })} /></Field>
            <Field label="ملاحظات">
              <textarea className="inp" rows={3} value={client.notes} onChange={e => onChange({ notes: e.target.value })} />
            </Field>
          </div>

          <button onClick={exportExcel} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold text-white shadow-sm bg-gold">
            <Download size={16} /> تصدير المقايسة Excel
          </button>
          <button onClick={() => buildAndDownloadClientPptx(client, calc, settings)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold text-white shadow-sm" style={{ backgroundColor: "#2E5395" }}>
            <FileText size={16} /> تصدير عرض تقديمي PowerPoint
          </button>
          <div className="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            كل الملفات هنا تُبنى لحظيًا من بيانات هذا العميل — أي تعديل بالمستويات أو الأسعار يظهر فورًا في أي ملف جديد تصدّره، بلا حاجة لتحديث يدوي.
          </div>
        </div>

        {/* right: scope selection + calc */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex gap-1 rounded-lg p-1 bg-light">
            <button
              onClick={() => setInnerTab("pricing")}
              className="flex-1 rounded-md py-2 text-sm font-bold transition-colors"
              style={{ backgroundColor: innerTab === "pricing" ? NAVY : "transparent", color: innerTab === "pricing" ? "#FFFFFF" : TEXT }}
            >
              التسعير والمقايسة
            </button>
            <button
              onClick={() => setInnerTab("site")}
              className="flex-1 rounded-md py-2 text-sm font-bold transition-colors"
              style={{ backgroundColor: innerTab === "site" ? NAVY : "transparent", color: innerTab === "site" ? "#FFFFFF" : TEXT }}
            >
              سجل متابعة الموقع{client.progressPercent > 0 ? ` (${client.progressPercent}%)` : ""}
            </button>
          </div>

          {innerTab === "pricing" && (
            <>
          <div className="rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
            <div className="mb-3 text-sm font-bold text-navy">مستوى التشطيب لكل نطاق عمل</div>
            <div className="flex flex-col gap-3">
              {SCOPES.map(scope => (
                <div key={scope} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 bg-light">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={client.scopeIncluded[scope]}
                      onChange={e => onChange({ scopeIncluded: { ...client.scopeIncluded, [scope]: e.target.checked } })}
                    />
                    <span className="text-sm font-semibold">{scope}</span>
                  </div>
                  <div className="flex gap-1">
                    {LEVELS.map(lv => (
                      <button
                        key={lv}
                        disabled={!client.scopeIncluded[scope]}
                        onClick={() => onChange({ scopeLevel: { ...client.scopeLevel, [scope]: lv } })}
                        className="rounded-md px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-30"
                        style={{
                          backgroundColor: client.scopeLevel[scope] === lv ? LEVEL_COLORS[lv] : "#FFFFFF",
                          color: client.scopeLevel[scope] === lv ? "#FFFFFF" : TEXT,
                          border: `1px solid ${client.scopeLevel[scope] === lv ? LEVEL_COLORS[lv] : BORDER}`,
                        }}
                      >
                        {lv}
                      </button>
                    ))}
                  </div>
                  <div className="w-full text-left text-sm font-bold sm:w-auto text-navy">
                    {client.scopeIncluded[scope] ? fmt(calc.byScope[scope]) + " ج.م" : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <FullItemBOQ client={client} onChange={onChange} currentMember={currentMember} />

          <div className="mt-4 rounded-xl p-4 bg-navy">
            <div className="mb-3 text-sm font-bold text-white">ملخص السعر</div>
            <SummaryRow label="إجمالي بنود التنفيذ" value={calc.execTotal} />
            <SummaryRow label="أتعاب الإشراف الهندسي" value={calc.supervision} />
            <SummaryRow label="احتياطي أعمال غير منظورة" value={calc.contingency} />
            <SummaryRow label="التصميم" value={calc.byScope["تصميم"]} />
            <SummaryRow label="الفرش والأثاث" value={calc.byScope["الفرش والأثاث"]} />
            <div className="my-2 h-px" style={{ backgroundColor: "#2E5395" }} />
            <SummaryRow label="الإجمالي قبل الضريبة" value={calc.subtotal} bold />
            <SummaryRow label="ضريبة القيمة المضافة" value={calc.vat} />
            <div className="mt-3 flex items-center justify-between rounded-lg px-3 py-2.5 bg-gold">
              <span className="text-sm font-bold" style={{ color: "#1F1F1F" }}>الإجمالي النهائي المستحق</span>
              <span className="text-lg font-bold" style={{ color: "#1F1F1F" }}>{fmt(calc.grandTotal)} ج.م</span>
            </div>
          </div>
            </>
          )}

          {innerTab === "site" && <SiteVisitLog client={client} onChange={onChange} />}
        </div>
      </div>

      <style>{`
        .inp { width: 100%; margin-top: 4px; margin-bottom: 12px; padding: 8px 10px; border-radius: 8px; border: 1px solid ${BORDER}; font-size: 13px; font-family: 'Cairo', Arial, sans-serif; }
        .inp:focus { outline: 2px solid ${NAVY}; outline-offset: 0; }
      `}</style>
    </div>
  );
}

/* ============================= Site visit log ============================= */
/* ============================= Full itemized BOQ editor (per-item overrides) ============================= */
function FullItemBOQ({ client, onChange, currentMember }) {
  const [expanded, setExpanded] = useState(false);
  const mayEditPrice = can(currentMember, "editUnitPrice");
  const area = Number(client.area) || 0;
  const recs = client.items || {};
  const customCount = Object.keys(recs).filter(k => Object.keys(recs[k] || {}).length > 0).length;

  // كل التعديلات تمر من هنا: مفتاح واحد (معرّف البند) وسجل واحد.
  // لم يعد ممكنًا أن تتفرّق قيم البند الواحد بين خرائط متوازية.
  const patchItem = (id, field, value) => {
    const next = { ...recs };
    const rec = { ...(next[id] || {}) };
    if (value === undefined || value === "") delete rec[field];
    else rec[field] = value;
    if (Object.keys(rec).length === 0) delete next[id];
    else next[id] = rec;
    onChange({ items: next });
  };

  const setPriceOverride = (id, value) => {
    const next = { ...recs };
    const rec = { ...(next[id] || {}) };
    if (value === "" || value === undefined) { delete rec.price; delete rec.priceDate; }
    else { rec.price = value; rec.priceDate = new Date().toISOString().slice(0, 10); }
    if (Object.keys(rec).length === 0) delete next[id]; else next[id] = rec;
    onChange({ items: next });
  };

  const resetItem = (id) => {
    const next = { ...recs }; delete next[id];
    onChange({ items: next });
  };

  const resetAll = () => onChange({ items: {} });

  let currentScope = null;

  return (
    <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold text-navy">المقايسة الكاملة القابلة للتعديل ({ITEMS.length} بند)</div>
          {customCount > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
              {customCount} تخصيص يدوي
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {customCount > 0 && (
            <button onClick={resetAll} className="text-xs font-semibold underline" style={{ color: "#C00000" }}>
              إعادة الكل للوضع الافتراضي
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white bg-navy">
            {expanded ? "إخفاء" : "عرض وتعديل كل البنود"}
          </button>
        </div>
      </div>

      {!expanded && (
        <p className="mt-2 text-xs leading-6 text-muted">
          الجدول أعلاه بيتحكم في المستوى على مستوى الفئة كاملة. افتح هنا لو محتاج تغيّر مستوى أو كمية أو سعر
          وحدة أو تضمين بند واحد بعينه بشكل مستقل — مفيد لتغيّرات سعر السوق أثناء التنفيذ أو اختلاف سعر
          التوريد بين عميل وآخر. أي تعديل بيتزامن فورًا زي باقي البيانات.
        </p>
      )}

      {expanded && (
        <div className="mt-3 flex flex-col gap-0.5">
          <div className="hidden grid-cols-12 gap-2 px-2 pb-1 text-[10px] font-bold sm:grid text-muted">
            <div className="col-span-3">البند</div>
            <div className="col-span-2">الكمية</div>
            <div className="col-span-2">المستوى</div>
            <div className="col-span-2">سعر الوحدة</div>
            <div className="col-span-2">الإجمالي</div>
            <div className="col-span-1"></div>
          </div>
          {ITEMS.map((item, i) => {
            const [scope, name, unit] = item;
            const r = resolveItem(client, item, area);
            const showScopeHeader = scope !== currentScope;
            currentScope = scope;
            const rec = recs[r.id] || {};
            const isCustom = r.overrides.length > 0;
            return (
              <React.Fragment key={name}>
                {showScopeHeader && (
                  <div className="mt-3 mb-1 text-xs font-bold text-muted">{scope}</div>
                )}
                <div
                  className="grid grid-cols-12 items-center gap-2 rounded-lg px-2 py-2"
                  style={{ backgroundColor: isCustom ? "#FFFBEB" : (i % 2 ? "#FFFFFF" : LIGHT) }}
                >
                  <div className="col-span-12 flex items-center gap-2 sm:col-span-3">
                    <input
                      type="checkbox"
                      checked={r.included}
                      onChange={e => patchItem(r.id, "included", e.target.checked)}
                    />
                    <span className="text-xs font-semibold leading-4">{name}</span>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <input
                      type="number"
                      disabled={!r.included}
                      className="w-full rounded-md px-2 py-1 text-xs disabled:opacity-40"
                      style={{ border: `1px solid ${BORDER}` }}
                      value={rec.qty !== undefined ? rec.qty : Math.round(r.qty * 100) / 100}
                      onChange={e => patchItem(r.id, "qty", e.target.value)}
                    />
                    <span className="text-[10px] text-muted">{unit}</span>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <select
                      disabled={!r.included}
                      className="w-full rounded-md px-1.5 py-1 text-xs disabled:opacity-40"
                      style={{ border: `1px solid ${BORDER}` }}
                      value={rec.level || ""}
                      onChange={e => patchItem(r.id, "level", e.target.value || undefined)}
                    >
                      <option value="">افتراضي الفئة</option>
                      {LEVELS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <input
                      type="number"
                      disabled={!r.included || !mayEditPrice}
                      readOnly={!mayEditPrice}
                      title={mayEditPrice ? "" : "تعديل سعر الوحدة متاح لمدير المشاريع أو مالك المكتب فقط"}
                      className="w-full rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-40"
                      style={{ border: `1px solid ${r.hasPriceOverride ? "#BF9000" : BORDER}`, color: r.hasPriceOverride ? "#8A6D00" : TEXT, backgroundColor: mayEditPrice ? "transparent" : "#F5F7FA", cursor: mayEditPrice ? "auto" : "not-allowed" }}
                      value={rec.price !== undefined ? rec.price : Math.round(r.price)}
                      onChange={e => { if (mayEditPrice) setPriceOverride(r.id, e.target.value); }}
                    />
                    {r.overrides.length > 0 && (
                      <span className="text-[9px] font-semibold" style={{ color: "#8A6D00" }}>
                        تجاوز فردي: {r.overrides.join(" · ")} — يتخطى إعداد الفئة ({r.scopeLevel})
                      </span>
                    )}
                    {r.hasPriceOverride && (
                      <span className="text-[9px] text-muted">
                        كان {fmt(r.basePrice)} — عُدّل {r.priceDate}
                      </span>
                    )}
                  </div>
                  <div className="col-span-6 text-left text-xs font-bold sm:col-span-2 text-navy">
                    {r.included ? fmt(r.total) + " ج.م" : "—"}
                  </div>
                  <div className="col-span-4 text-left sm:col-span-1">
                    {isCustom && (
                      <button onClick={() => resetItem(r.id)} title="إعادة الافتراضي" className="text-xs" style={{ color: "#C00000" }}>↺</button>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SiteVisitLog({ client, onChange }) {
  const [visits, setVisits] = useState([]);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(() => newVisit(client.id));

  const reload = useCallback(async () => {
    setLoadingVisits(true);
    const v = await loadVisits(client.id);
    setVisits(v);
    setLoadingVisits(false);
  }, [client.id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setDraft(newVisit(client.id)); setShowForm(false); }, [client.id]);

  // التقدّم يُشتق دائمًا من أحدث زيارة — لا يرتفع فقط، بل يعكس الواقع.
  // تصحيح نسبة خاطئة أو حذف زيارة يُرجع الرقم كما ينبغي.
  const syncProgress = async () => {
    const all = await loadVisits(client.id);
    const { percent, lastVisitAt } = progressFromVisits(all);
    if (percent !== (client.progressPercent || 0) || lastVisitAt !== (client.lastVisitAt || "")) {
      onChange({ progressPercent: percent, lastVisitAt });
    }
  };

  const submitVisit = async () => {
    const visit = { ...draft, percent: Number(draft.percent) || 0 };
    await saveVisit(visit);
    await syncProgress();
    setDraft(newVisit(client.id));
    setShowForm(false);
    reload();
  };

  const removeVisit = async (id) => {
    await deleteVisitEntry(client.id, id);
    await syncProgress();
    reload();
  };

  return (
    <div className="mt-5 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold text-navy">سجل متابعة الموقع</div>
          {client.progressPercent > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ backgroundColor: "#E2EFDA", color: "#1E7B45" }}>
              نسبة الإنجاز الحالية: {client.progressPercent}%
            </span>
          )}
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white bg-navy">
          <Plus size={14} /> تسجيل زيارة جديدة
        </button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg p-3 bg-light">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="تاريخ الزيارة">
              <input type="date" className="inp" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
            </Field>
            <Field label="اسم المهندس القائم بالزيارة">
              <input className="inp" value={draft.engineer} onChange={e => setDraft({ ...draft, engineer: e.target.value })} />
            </Field>
            <Field label={`نسبة الإنجاز الإجمالية: ${draft.percent}%`}>
              <input type="range" min="0" max="100" step="5" className="w-full" value={draft.percent} onChange={e => setDraft({ ...draft, percent: Number(e.target.value) })} />
            </Field>
            <Field label="رابط صور الموقع (اختياري)">
              <input className="inp" placeholder="رابط Google Drive أو مشابه" value={draft.photoLink} onChange={e => setDraft({ ...draft, photoLink: e.target.value })} />
            </Field>
          </div>
          <Field label="ملاحظات الزيارة">
            <textarea className="inp" rows={3} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <button onClick={submitVisit} disabled={!draft.date} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: "#1E7B45" }}>
            حفظ الزيارة
          </button>
        </div>
      )}

      {loadingVisits ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Loader2 className="animate-spin" size={16} /> جاري تحميل السجل…
        </div>
      ) : visits.length === 0 ? (
        <div className="rounded-lg p-6 text-center text-sm" style={{ backgroundColor: LIGHT, color: MUTED }}>
          لا يوجد زيارات مسجّلة بعد لهذا العميل.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visits.map(v => (
            <div key={v.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg p-3 bg-light">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <span>{v.date}</span>
                  <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white bg-navy">{v.percent}%</span>
                  {v.engineer && <span className="text-xs font-normal text-muted">بواسطة {v.engineer}</span>}
                </div>
                {v.notes && <div className="mt-1 text-xs leading-5 text-ink">{v.notes}</div>}
                {v.photoLink && (
                  <a href={v.photoLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-navy">
                    <ExternalLink size={12} /> عرض الصور
                  </a>
                )}
              </div>
              <button onClick={() => removeVisit(v.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-xs font-semibold text-muted">
      {label}
      {children}
    </label>
  );
}

function SummaryRow({ label, value, bold }) {
  return (
    <div className="mb-1.5 flex items-center justify-between text-sm" style={{ color: "#D9E1F2" }}>
      <span style={{ fontWeight: bold ? 700 : 400, color: bold ? "#FFFFFF" : "#D9E1F2" }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: "#FFFFFF" }}>{fmt(value)} ج.م</span>
    </div>
  );
}

/* ============================= Identity gate (local role simulation) ============================= */
function IdentityGate({ team, onAddMember, onSignIn }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const createOwner = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const member = await onAddMember(name.trim(), "owner");
    await onSignIn(member);
    setBusy(false);
  };

  return (
    <div dir="rtl" className="flex min-h-[700px] w-full items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT }}>
      <div className="w-full max-w-md rounded-2xl p-8 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-1 text-center text-lg font-bold text-navy">نظام متابعة العملاء والتسعير</div>
        <div className="mb-6 text-center text-xs text-muted">مكتب __________ للاستشارات المعمارية</div>

        {team.length === 0 ? (
          <>
            <div className="mb-4 text-sm font-semibold text-ink">أول مرة تفتح الأداة — أدخل اسمك لإنشاء حساب مالك المكتب</div>
            <input className="inp" placeholder="اسمك الكامل" value={name} onChange={e => setName(e.target.value)} />
            <button disabled={busy || !name.trim()} onClick={createOwner} className="mt-3 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-40 bg-navy">
              بدء استخدام النظام كمالك للمكتب
            </button>
          </>
        ) : (
          <>
            <div className="mb-3 text-sm font-semibold text-ink">من أنت؟</div>
            <div className="flex flex-col gap-2">
              {team.map(m => (
                <button key={m.id} onClick={() => onSignIn(m)} className="flex items-center justify-between rounded-lg px-4 py-2.5 text-sm font-semibold" style={{ border: `1px solid ${BORDER}` }}>
                  <span>{m.name}</span>
                  <Badge text={roleLabel(m.role)} color={(ROLES[m.role] || ROLES.engineer).color} />
                </button>
              ))}
            </div>
            <div className="mt-4 text-center text-xs text-muted">
              مش لاقي اسمك؟ اطلب من مالك المكتب يضيفك من تبويب "الإعدادات".
            </div>
          </>
        )}
        <style>{`
          .inp { width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid ${BORDER}; font-size: 13px; font-family: 'Cairo', Arial, sans-serif; }
          .inp:focus { outline: 2px solid ${NAVY}; outline-offset: 0; }
        `}</style>
      </div>
    </div>
  );
}

/* ============================= Cloud auth gate (real login, shared across devices) ============================= */
function CloudAuthGate({ onAuthSuccess }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const handleSignIn = async () => {
    setError(""); setBusy(true);
    try {
      const sb = getSupabase();
      const { error: err } = await withTimeout(sb.auth.signInWithPassword({ email: email.trim(), password }), 10000);
      if (err) { setError(`تعذر تسجيل الدخول — رسالة الخادم: ${err.message}`); setBusy(false); return; }
      await onAuthSuccess();
    } catch (e) {
      setError("تعذر الاتصال بالخادم — تأكد من صحة رابط ومفتاح Supabase في الإعدادات ومن اتصالك بالإنترنت. (" + (e?.message || "") + ")");
    }
    setBusy(false);
  };

  const handleSignUp = async () => {
    setError(""); setBusy(true);
    try {
      const sb = getSupabase();
      const { data, error: err } = await withTimeout(
        sb.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } }),
        10000
      );
      if (err) { setError(`تعذر إنشاء الحساب — رسالة الخادم: ${err.message}`); setBusy(false); return; }
      if (!data.session) {
        setPendingConfirm(true);
        setBusy(false);
        return;
      }
      await onAuthSuccess();
    } catch (e) {
      setError("تعذر الاتصال بالخادم — تأكد من صحة رابط ومفتاح Supabase في الإعدادات ومن اتصالك بالإنترنت. (" + (e?.message || "") + ")");
    }
    setBusy(false);
  };

  return (
    <div dir="rtl" className="flex min-h-[700px] w-full items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT }}>
      <div className="w-full max-w-md rounded-2xl p-8 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-1 text-center text-lg font-bold text-navy">نظام متابعة العملاء والتسعير</div>
        <div className="mb-1 flex items-center justify-center gap-1.5 text-xs" style={{ color: "#1E7B45" }}>
          <Wifi size={13} /> وضع المزامنة السحابية مفعّل
        </div>
        <div className="mb-6 text-center text-xs text-muted">مكتب __________ للاستشارات المعمارية</div>

        {pendingConfirm ? (
          <div className="rounded-lg p-4 text-center text-sm" style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
            تم إنشاء الحساب. تفقّد بريدك الإلكتروني واضغط رابط التأكيد، ثم ارجع هنا وسجّل الدخول.
            <div className="mt-2 text-xs text-muted">
              (لو المكتب مش محتاج تأكيد بريد، ألغِ خاصية "Confirm email" من إعدادات Supabase Auth لتسريع الدخول لاحقًا.)
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex rounded-lg p-1 bg-light">
              <button onClick={() => setMode("signin")} className="flex-1 rounded-md py-1.5 text-sm font-bold" style={{ backgroundColor: mode === "signin" ? NAVY : "transparent", color: mode === "signin" ? "#FFFFFF" : TEXT }}>تسجيل الدخول</button>
              <button onClick={() => setMode("signup")} className="flex-1 rounded-md py-1.5 text-sm font-bold" style={{ backgroundColor: mode === "signup" ? NAVY : "transparent", color: mode === "signup" ? "#FFFFFF" : TEXT }}>حساب جديد</button>
            </div>

            {mode === "signup" && (
              <>
                <input className="inp" placeholder="اسمك الكامل" value={name} onChange={e => setName(e.target.value)} />
                <div className="mb-3 flex items-start gap-1.5 text-xs leading-5 text-muted">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                  أول شخص يسجّل في المشروع يبقى مالك المكتب تلقائيًا. أي حد بعده هيفضل "بانتظار الموافقة"
                  لحد ما مالك فعلي يوافق عليه من تبويب الإعدادات.
                </div>
              </>
            )}
            <input className="inp" type="email" placeholder="البريد الإلكتروني" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="inp" type="password" placeholder="كلمة المرور" value={password} onChange={e => setPassword(e.target.value)} />
            {error && <div className="mb-3 text-xs font-semibold" style={{ color: "#C00000" }}>{error}</div>}
            <button
              disabled={busy || !email.trim() || !password}
              onClick={mode === "signin" ? handleSignIn : handleSignUp}
              className="mt-1 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-40 bg-navy"
            >
              {busy ? "جاري التنفيذ…" : mode === "signin" ? "دخول" : "إنشاء الحساب والدخول"}
            </button>
          </>
        )}
        <button
          onClick={() => { setCloudConfig(null); window.location.reload(); }}
          className="mt-4 w-full text-center text-xs font-semibold underline text-muted"
        >
          تعذّر الدخول؟ ارجع مؤقتًا للوضع المحلي
        </button>
        <style>{`
          .inp { width: 100%; margin-bottom: 12px; padding: 9px 12px; border-radius: 8px; border: 1px solid ${BORDER}; font-size: 13px; font-family: 'Cairo', Arial, sans-serif; }
          .inp:focus { outline: 2px solid ${NAVY}; outline-offset: 0; }
        `}</style>
      </div>
    </div>
  );
}

/* ============================= Pending approval screen ============================= */
function PendingApprovalScreen({ onSignOut, onRefresh }) {
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => { onRefresh(); }, 15000);
    return () => clearInterval(interval);
  }, [onRefresh]);

  return (
    <div dir="rtl" className="flex min-h-[700px] w-full items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT }}>
      <div className="w-full max-w-md rounded-2xl p-8 text-center shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: "#FFF7E6" }}>
            <Loader2 size={26} className="animate-spin" style={{ color: "#8A6D00" }} />
          </div>
        </div>
        <div className="mb-2 text-lg font-bold text-navy">حسابك بانتظار الموافقة</div>
        <p className="mb-5 text-sm leading-6 text-muted">
          تم إنشاء حسابك بنجاح، لكن لازم مالك المكتب يوافق عليك أولاً قبل ما تقدر تدخل على بيانات العملاء.
          الصفحة هتفتح تلقائيًا فور الموافقة — تقدر تسيبها مفتوحة أو ترجع بعد شوية.
        </p>
        <button
          onClick={async () => { setChecking(true); await onRefresh(); setChecking(false); }}
          className="mb-2 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50 bg-navy"
          disabled={checking}
        >
          {checking ? "جاري التحقق…" : "تحقق الآن"}
        </button>
        <button onClick={onSignOut} className="w-full text-center text-xs font-semibold underline text-muted">
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}

/* ============================= Settings ============================= */
function SettingsPanel({ settings, onSave, onExportBackup, onImportBackup, clientCount, team, currentMember, onAddMember, onRemoveMember, cloud, pendingMembers, onApproveMember }) {
  const [local, setLocal] = useState(settings);
  const fileInputRef = React.useRef(null);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("engineer");
  const [sbUrl, setSbUrl] = useState(getCloudConfig()?.url || "");
  const [sbKey, setSbKey] = useState(getCloudConfig()?.anonKey || "");
  const [wantSimpleMode, setWantSimpleMode] = useState(getCloudConfig()?.simpleMode || false);
  const [showSql, setShowSql] = useState(false);
  const currentSimpleMode = !!getCloudConfig()?.simpleMode;
  useEffect(() => setLocal(settings), [settings]);

  const SIMPLE_SQL_SCRIPT = `-- ⚠️ تحذير: لا تستخدم هذا الوضع مع رابط عام على الإنترنت.
-- أي شخص يفتح الرابط يحصل على صلاحية كاملة لقراءة وتعديل ومسح كل بيانات العملاء.
-- استخدمه فقط للتجربة المحلية، ثم أوقف Anonymous Sign-ins من Supabase فورًا.
-- SIMPLE / TESTING MODE — no per-person accounts, no approval step.
-- Anyone who opens the app with this project's URL + key gets full read/write
-- access instantly (via an anonymous session). Fine for early testing with your
-- own team; do NOT keep this on once real client data / real office use begins.
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table kv enable row level security;

drop policy if exists "approved members read kv" on kv;
drop policy if exists "approved members insert kv" on kv;
drop policy if exists "approved members update kv" on kv;
drop policy if exists "approved members delete kv" on kv;
drop policy if exists "authenticated read" on kv;
drop policy if exists "authenticated insert" on kv;
drop policy if exists "authenticated update" on kv;
drop policy if exists "authenticated delete" on kv;

create policy "anyone authenticated read kv" on kv for select using (auth.role() = 'authenticated');
create policy "anyone authenticated insert kv" on kv for insert with check (auth.role() = 'authenticated');
create policy "anyone authenticated update kv" on kv for update using (auth.role() = 'authenticated');
create policy "anyone authenticated delete kv" on kv for delete using (auth.role() = 'authenticated');

alter publication supabase_realtime add table kv;

-- IMPORTANT: also go to Authentication → Providers in Supabase and enable
-- "Anonymous Sign-ins" — it's off by default and this mode needs it.`;

  const SQL_SCRIPT = `-- shared data store (clients, settings) — access gated by approved role below
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- one row per real person, role assigned server-side only (never trusts the app)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'pending' check (role in ('pending','engineer','manager','owner')),
  created_at timestamptz not null default now()
);

-- first person ever to sign up becomes owner automatically; everyone after
-- starts 'pending' until an existing owner approves them from the app
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select not exists(select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    case when is_first then 'owner' else 'pending' end
  );
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table kv enable row level security;
alter table profiles enable row level security;

-- remove any older, less-strict policies from a previous version of this setup
drop policy if exists "authenticated read" on kv;
drop policy if exists "authenticated insert" on kv;
drop policy if exists "authenticated update" on kv;
drop policy if exists "authenticated delete" on kv;
drop policy if exists "approved members read kv" on kv;
drop policy if exists "approved members insert kv" on kv;
drop policy if exists "approved members update kv" on kv;
drop policy if exists "approved members delete kv" on kv;
drop policy if exists "authenticated read profiles" on profiles;
drop policy if exists "owners update profiles" on profiles;

-- kv: only people an owner has actually approved (role owner/engineer) may read or write
create policy "approved members read kv" on kv for select
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members insert kv" on kv for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members update kv" on kv for update
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members delete kv" on kv for delete
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));

-- profiles: anyone signed in can see the roster (needed to show pending/team lists);
-- only an existing owner can ever change someone's role — enforced twice (policy + trigger)
create policy "authenticated read profiles" on profiles for select
  using (auth.role() = 'authenticated');
create policy "owners update profiles" on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));

create or replace function public.prevent_self_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requester_role text;
begin
  select role into requester_role from profiles where id = auth.uid();
  if new.role is distinct from old.role and coalesce(requester_role,'') <> 'owner' then
    new.role := old.role;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_role_change on profiles;
create trigger enforce_role_change before update on profiles
  for each row execute procedure public.prevent_self_role_escalation();

alter publication supabase_realtime add table kv;
alter publication supabase_realtime add table profiles;`;

  const enableCloud = () => {
    if (!sbUrl.trim() || !sbKey.trim()) return;
    setCloudConfig({ url: sbUrl.trim(), anonKey: sbKey.trim(), simpleMode: wantSimpleMode });
    window.location.reload();
  };
  const disableCloud = () => {
    setCloudConfig(null);
    window.location.reload();
  };
  const switchMode = () => {
    const cfg = getCloudConfig();
    if (!cfg) return;
    setCloudConfig({ ...cfg, simpleMode: !cfg.simpleMode });
    window.location.reload();
  };

  return (
    <div className="max-w-lg">
      <h2 className="mb-4 text-xl font-bold text-navy">الإعدادات العامة</h2>

      <div className="rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
          <Wifi size={16} /> المزامنة السحابية بين الأجهزة (اختياري)
        </div>
        <p className="mb-3 text-xs leading-6 text-muted">
          بدون إعداد هذا القسم، الأداة تعمل محليًا على هذا الجهاز فقط. لو عايز كل مهندس يدخل من جهازه
          الشخصي ويشوف نفس البيانات لحظيًا، أنشئ مشروع مجاني على{" "}
          <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{ color: NAVY, fontWeight: "bold" }}>Supabase</a>
          {" "}(٥ دقائق)، وألصق بياناته هنا.
        </p>

        {cloud ? (
          <div className="rounded-lg p-3" style={{ backgroundColor: currentSimpleMode ? "#FEF3E2" : "#E2EFDA" }}>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold" style={{ color: currentSimpleMode ? "#B45309" : "#1E7B45" }}>
              <Wifi size={14} /> {currentSimpleMode ? "المزامنة مفعّلة — وضع تجريبي مبسط (بدون صلاحيات)" : "المزامنة مفعّلة — وضع الصلاحيات الكامل"}
            </div>
            {currentSimpleMode && (
              <p className="mb-2 text-xs leading-6" style={{ color: "#8A6D00" }}>
                أي جهاز يفتح نفس الرابط والمفتاح بيدخل فورًا بدون تسجيل أو موافقة. مناسب للتجربة الآن فقط —
                لما تكون جاهز لبيانات عملاء حقيقية، ارجع هنا واضغط "التحويل لوضع الصلاحيات الكامل".
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={switchMode} className="rounded-md px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: currentSimpleMode ? "#1E7B45" : "#B45309" }}>
                {currentSimpleMode ? "التحويل لوضع الصلاحيات الكامل" : "التحويل للوضع التجريبي المبسط"}
              </button>
              <button onClick={disableCloud} className="rounded-md px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: "#FFFFFF", color: "#C00000", border: "1px solid #C00000" }}>
                تعطيل المزامنة والعودة للتخزين المحلي
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              عند التحويل بين الوضعين لأول مرة، شغّل كود الـ SQL المناسب في Supabase (زرار "إظهار كود الإعداد" تحت).
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-start gap-2 rounded-lg p-3 text-xs leading-6" style={{ backgroundColor: "#FCE9E9", color: "#8A1414" }}>
              <ShieldCheck size={16} className="mt-0.5 shrink-0" />
              <span>
                <b>تحديث أمان مهم:</b> النسخة الأولى من كود الإعداد كانت بتسمح لأي شخص يعمل حساب جديد يختار
                لنفسه صلاحية "مالك المكتب"، وكانت قاعدة البيانات مش بتفرّق فعليًا بين الأدوار. لو سبق وفعّلت
                المزامنة بكود قديم، لازم تشغّل الكود المناسب تحت مرة كمان (آمن تمامًا يتكرر) عشان يقفل الثغرة.
              </span>
            </div>
            <Field label="Supabase Project URL">
              <input className="inp" placeholder="https://xxxxx.supabase.co" value={sbUrl} onChange={e => setSbUrl(e.target.value)} />
            </Field>
            <Field label="Supabase anon public key">
              <input className="inp" placeholder="eyJhbGciOi..." value={sbKey} onChange={e => setSbKey(e.target.value)} />
            </Field>
            <label className="mb-3 flex items-start gap-2 rounded-lg p-3 text-xs leading-6" style={{ backgroundColor: "#FEF3E2", color: "#8A6D00", cursor: "pointer" }}>
              <input type="checkbox" className="mt-0.5" checked={wantSimpleMode} onChange={e => setWantSimpleMode(e.target.checked)} />
              <span>
                <b>وضع تجريبي مبسط:</b> بدون تسجيل حسابات فردية ولا موافقة مالك — أي جهاز يفتح الرابط يدخل
                فورًا بكل الصلاحيات. مناسب لتجربة الفريق للنظام دلوقتي، لكن غير آمن لبيانات عملاء حقيقية.
                تقدر ترجع تفعّل الصلاحيات الكاملة لاحقًا من نفس الشاشة دي بدون ما تفقد بياناتك.
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={!sbUrl.trim() || !sbKey.trim()} onClick={enableCloud} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: "#1E7B45" }}>
                تفعيل المزامنة السحابية
              </button>
              <button onClick={() => setShowSql(!showSql)} className="rounded-lg px-4 py-2 text-sm font-bold" style={{ border: `1px solid ${NAVY}`, color: NAVY }}>
                {showSql ? "إخفاء" : "إظهار"} كود إعداد قاعدة البيانات (SQL)
              </button>
            </div>
            {showSql && (
              <div className="mt-3">
                <p className="mb-2 text-xs text-muted">
                  شغّل كود واحد بس حسب الوضع اللي هتفعّله (آمن تمامًا تكرر التشغيل لاحقًا لو غيّرت رأيك):
                </p>
                <p className="mb-1 text-xs font-bold" style={{ color: "#B45309" }}>الوضع التجريبي المبسط:</p>
                <pre className="mb-3 overflow-x-auto rounded-lg p-3 text-xs" style={{ backgroundColor: "#1F1F1F", color: "#E5E7EB", direction: "ltr", textAlign: "left" }}>
                  {SIMPLE_SQL_SCRIPT}
                </pre>
                <p className="mb-1 text-xs font-bold" style={{ color: "#1E7B45" }}>وضع الصلاحيات الكامل:</p>
                <pre className="overflow-x-auto rounded-lg p-3 text-xs" style={{ backgroundColor: "#1F1F1F", color: "#E5E7EB", direction: "ltr", textAlign: "left" }}>
                  {SQL_SCRIPT}
                </pre>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 text-sm font-bold text-navy">فريق المكتب والصلاحيات</div>

        {currentSimpleMode ? (
          <div className="flex items-start gap-2 rounded-lg p-3 text-xs leading-6" style={{ backgroundColor: "#FEF3E2", color: "#8A6D00" }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            الصلاحيات متوقفة مؤقتًا في الوضع التجريبي المبسط — كل من يفتح الرابط له كل الصلاحيات تلقائيًا.
            فعّل "وضع الصلاحيات الكامل" من قسم المزامنة السحابية فوق لاستخدام حسابات فردية وموافقة الأعضاء.
          </div>
        ) : (
        <>
        {cloud && can(currentMember, "manageTeam") && pendingMembers && pendingMembers.length > 0 && (
          <div className="mb-4 rounded-lg p-3" style={{ backgroundColor: "#FFF7E6" }}>
            <div className="mb-2 text-xs font-bold" style={{ color: "#8A6D00" }}>طلبات انضمام بانتظار الموافقة ({pendingMembers.length})</div>
            <div className="flex flex-col gap-2">
              {pendingMembers.map(p => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                  <div className="text-xs">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-muted">{p.email}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ASSIGNABLE_ROLES.map(r => (
                      <button
                        key={r}
                        onClick={() => onApproveMember(p.id, r)}
                        className="rounded-md px-2.5 py-1.5 text-xs font-bold"
                        style={{ backgroundColor: ROLES[r].color, color: ROLES[r].textOn }}
                      >
                        قبول كـ{ROLES[r].label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3 flex flex-col gap-2">
          {team.map(m => (
            <div key={m.id} className="flex items-center justify-between rounded-lg px-3 py-2 bg-light">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{m.name}</span>
                <Badge text={roleLabel(m.role)} color={(ROLES[m.role] || ROLES.engineer).color} />
                {currentMember?.id === m.id && <span className="text-xs text-muted">(أنت الآن)</span>}
              </div>
              {!cloud && team.length > 1 && (
                <button onClick={() => onRemoveMember(m.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>

        {!cloud && (
          <div className="flex flex-wrap items-center gap-2">
            <input className="flex-1 rounded-md px-2.5 py-1.5 text-xs" style={{ border: `1px solid ${BORDER}`, minWidth: 140 }} placeholder="اسم العضو الجديد" value={newName} onChange={e => setNewName(e.target.value)} />
            <select className="rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${BORDER}` }} value={newRole} onChange={e => setNewRole(e.target.value)}>
              <option value="engineer">مهندس</option>
              <option value="owner">مالك المكتب</option>
            </select>
            <button
              onClick={() => { if (newName.trim()) { onAddMember(newName.trim(), newRole); setNewName(""); } }}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold text-white bg-navy"
            >
              <Plus size={13} /> إضافة
            </button>
          </div>
        )}

        <div className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-muted">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {cloud
            ? "كل مهندس بيسجّل حسابه بنفسه (بريد وكلمة سر حقيقيين)، ولازم مالك مكتب فعلي يوافق عليه من هنا قبل ما يشوف أي بيانات. الموافقة على الأدوار متحقّقة من قاعدة البيانات نفسها، مش من الواجهة فقط."
            : "كل مهندس بيشوف بس العملاء المعيّن عليهم كـ\"مهندس مسؤول\" (من صفحة تفاصيل العميل)، أما مالك المكتب فيشوف الكل. هذا تنظيم للعرض فقط داخل هذا الجهاز، وليس حماية أمنية حقيقية — أي شخص يفتح نفس الجهاز يقدر يوصل لكل البيانات المخزّنة فعليًا."}
        </div>
        </>
        )}
      </div>

      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <Field label="نسبة أتعاب الإشراف الهندسي %">
          <input type="number" step="0.1" className="inp" value={(local.supervisionPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, supervisionPct: Number(e.target.value) / 100 })} />
        </Field>
        <Field label="نسبة احتياطي الأعمال غير المنظورة %">
          <input type="number" step="0.1" className="inp" value={(local.contingencyPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, contingencyPct: Number(e.target.value) / 100 })} />
        </Field>
        <Field label="نسبة ضريبة القيمة المضافة %">
          <input type="number" step="0.1" className="inp" value={(local.vatPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, vatPct: Number(e.target.value) / 100 })} />
        </Field>
        <button onClick={() => onSave(local)} className="mt-2 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white bg-navy">
          <Save size={15} /> حفظ الإعدادات
        </button>
      </div>

      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
          <ShieldCheck size={16} /> النسخ الاحتياطي والحفظ الدائم
        </div>
        <p className="mb-3 text-xs leading-6 text-muted">
          بيانات {clientCount} عميل محفوظة داخل هذا المتصفح على هذا الجهاز فقط (IndexedDB)، وتفضل موجودة حتى بعد إغلاق الجهاز أو قطع الإنترنت.
          لكنها لا تنتقل تلقائيًا لجهاز أو متصفح آخر — نزّل نسخة احتياطية بشكل دوري واحتفظ بها في مكان آمن (Google Drive مثلاً)،
          واستخدم "استيراد" على أي جهاز آخر لنقل نفس البيانات إليه.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={onExportBackup} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white bg-gold">
            <Download size={15} /> تصدير نسخة احتياطية
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold" style={{ border: `1px solid ${NAVY}`, color: NAVY }}>
            <UploadCloud size={15} /> استيراد نسخة احتياطية
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) onImportBackup(e.target.files[0]); e.target.value = ""; }}
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl p-4 text-xs leading-6" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}`, color: MUTED }}>
        هذه النسب تنعكس تلقائيًا على حساب كل عميل بمجرد الحفظ. البيانات محفوظة بشكل خاص، ولا يراها إلا من يستخدم هذا الجهاز والمتصفح.
      </div>
      <style>{`
        .inp { width: 100%; margin-top: 4px; margin-bottom: 12px; padding: 8px 10px; border-radius: 8px; border: 1px solid ${BORDER}; font-size: 13px; font-family: 'Cairo', Arial, sans-serif; }
        .inp:focus { outline: 2px solid ${NAVY}; outline-offset: 0; }
      `}</style>
    </div>
  );
}

/* ============================= Stability wrapper ============================= */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div dir="rtl" style={{ fontFamily: "'Cairo', Arial, sans-serif", padding: 40, textAlign: "center", color: "#1F2937" }}>
          <h2 style={{ color: "#C00000", marginBottom: 10 }}>حدث خطأ غير متوقع في التطبيق</h2>
          <p style={{ color: "#6B7280", marginBottom: 16 }}>
            بياناتك محفوظة بأمان في المتصفح ولم تتأثر. حاول تحديث الصفحة، ولو استمرت المشكلة استخدم نسخة احتياطية سابقة من تبويب الإعدادات.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ backgroundColor: "#1F4E78", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: "bold", cursor: "pointer" }}
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function StorageUnsupported() {
  return (
    <div dir="rtl" style={{ fontFamily: "'Cairo', Arial, sans-serif", padding: 40, textAlign: "center", color: "#1F2937" }}>
      <h2 style={{ color: "#C00000", marginBottom: 10 }}>هذا المتصفح لا يدعم التخزين الدائم</h2>
      <p style={{ color: "#6B7280" }}>
        يرجى فتح هذه الأداة من متصفح حديث (Chrome / Edge / Firefox / Safari) خارج وضع التصفح الخفي، لضمان حفظ بياناتك بشكل دائم.
      </p>
    </div>
  );
}

export default function App() {
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    if (!("indexedDB" in window)) setSupported(false);
  }, []);
  if (!supported) return <StorageUnsupported />;
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
