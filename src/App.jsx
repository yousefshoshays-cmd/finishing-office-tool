import React, { useState, useEffect, useMemo, useCallback , useRef} from "react";
import {
  Users, LayoutDashboard, Settings, Plus, Trash2, Download,
  Phone, MapPin, Ruler, ChevronLeft, Save, X, AlertCircle, Loader2,
  FileSpreadsheet, ExternalLink, FileText, PartyPopper, UploadCloud, ShieldCheck, Wifi, ChevronDown, CreditCard, Mail } from "lucide-react";

import {
  getCloudConfig, setCloudConfig, isCloudMode, isSimpleMode, getSupabase, withTimeout,
  storageGet, storageSet, storageDelete, storageListKeys, storageGetAllEntries, clearOrgCache,
  DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY,
} from "./data/storage.js";
import { fetchMyProfile, fetchAllProfiles, approveProfile } from "./data/profiles.js";
import { newVisit, loadVisits, saveVisit, deleteVisitEntry } from "./data/visits.js";
import { DEFAULT_PRICEBOOK, catalogueWithCustom, projectMargin, updateBookItem, staleItems, itemMargin, marginHealth, newCustomItem,
  itemAnalysis, setItemAnalysis, costAnalysis } from "./domain/pricebook.js";
import {
  COST_KINDS, KIND_LABEL, KIND_SHORT, KIND_COLOR, analysisTotal, analysisShares,
} from "./domain/costing.js";
/* كانت هاتان الدالتان تُستخدمان دون استيراد — تبويب دفتر الأسعار كان ينهار عند كل فتح. */
import { catalogueDriftReport, priceOutliers } from "./domain/suggest.js";
import { fetchLicense, licenseNotice, LICENSE_UNKNOWN } from "./data/license.js";
/* لوحة الإدارة تُحمَّل عند الطلب: مدير واحد فقط يحتاجها، فلا داعي لتحميلها للجميع. */
const AdminPanel = React.lazy(() => import("./ui/AdminPanel.jsx"));
const BillingPanel = React.lazy(() => import("./ui/BillingPanel.jsx"));
import { amIPlatformAdmin } from "./data/admin.js";
import { parseSchedule, parseCSV } from "./domain/importSchedule.js";
import {
  VARIATION_STATUS, newVariation, variationTotal, contractValue,
  newReceipt, newExpense,
  phasePaymentPlan, phaseBudget, agreedProfitPct, markPhaseDelivered, unmarkPhaseDelivered,
  newContractor, contractorLedger, plannedVsActual, siteSpendByKind, itemActualCost,
} from "./domain/finance.js";
import { ROOM_TYPES, DEFAULT_CEILING_H, newRoom, roomMetrics, deriveQuantities, suggestedQuantities, applySuggestions } from "./domain/rooms.js";
import { TEMPLATES, clientFromTemplate } from "./domain/templates.js";
import { photosAvailable, uploadPhoto, listPhotos, deletePhoto, signedUrls, humanSize, PHOTO_BUCKET } from "./data/photos.js";
import { ROLES, ASSIGNABLE_ROLES, PERMISSIONS, can, roleLabel } from "./domain/permissions.js";
import { ITEMS, SPECS, fmt, DEFAULT_SETTINGS, officeLine } from "./domain/catalogue.js";
import {
  newClient, resolveItem, calcClient, calcByPhase, migrateClient, progressFromVisits,
  ownsClient, linkEngineer, buildContractSnapshot, amendContract, effectiveTotals,
} from "./domain/pricing.js";
import {
  NAVY, NAVY_DARK, GOLD, LIGHT, BORDER, TEXT, MUTED,
  LEVELS, LEVEL_COLORS, SCOPES, STAGES, STAGE_COLORS,
  PHASES, PHASE_COLORS, PHASE_SHORT,
} from "./ui/tokens.js";
/* مكتبات التصدير (exceljs / docx / pptxgenjs) تزن أكثر من 1.3 ميجابايت مجتمعة.
   تُحمَّل الآن عند أول ضغطة على زر تصدير فقط، لا عند فتح التطبيق. */
const loadDocx  = () => import("./export/docx.js");
const loadPptx  = () => import("./export/pptx.js");
const loadExcel = () => import("./export/excel.js");

const generateContractDocx = async (...a) => (await loadDocx()).generateContractDocx(...a);
const downloadDocx = async (...a) => (await loadDocx()).downloadDocx(...a);
const buildAndDownloadClientPptx = async (...a) => (await loadPptx()).buildAndDownloadClientPptx(...a);
const exportFullBOQ = async (...a) => (await loadExcel()).exportFullBOQ(...a);
const exportLedger = async (...a) => (await import("./export/ledger.js")).exportLedger(...a);
const exportPipelineSummary = async (...a) => (await loadExcel()).exportPipelineSummary(...a);

/* ============================= Excel control hub ============================= */

/* ── حوار تأكيد للعمليات المدمّرة ─────────────────────────────────────────
   الحذف بضغطة واحدة كان أخطر عيب في الأداة: لا سؤال، لا تراجع، لا نسخة.
   هنا نطلب تأكيدًا صريحًا، ونجبر المستخدم على كتابة اسم العميل قبل الحذف. */

/* استخراج رسالة مفهومة من خطأ Supabase.
   أخطاء GoTrue أحيانًا تصل بجسم فارغ ({}) فتضيع المعلومة تمامًا،
   لذا نجمع كل الحقول المتاحة ونترجم الشائع منها للعربية. */
function authErrorText(err) {
  if (!err) return "خطأ غير معروف";
  const raw = [err.message, err.error_description, err.error, err.msg, err.hint, err.details]
    .filter(v => typeof v === "string" && v.trim() && v.trim() !== "{}")
    .join(" · ");
  const code = err.status || err.code;

  const map = [
    [/already registered|already exists/i, "هذا البريد مسجّل بالفعل. جرّب تسجيل الدخول أو استخدم بريدًا آخر."],
    [/Database error saving new user/i, "فشل إنشاء الحساب في قاعدة البيانات. غالبًا لم تُشغَّل سكربتات الترحيل، أو كود الدعوة غير صحيح."],
    [/كود الدعوة/,                        "كود الدعوة غير صحيح. تأكّد منه مع مالك المكتب."],
    [/Password should be at least/i,      "كلمة المرور قصيرة — استخدم ٦ أحرف على الأقل."],
    [/Unable to validate email|invalid format/i, "صيغة البريد الإلكتروني غير صحيحة."],
    [/rate limit|too many/i,              "محاولات كثيرة خلال وقت قصير. انتظر دقائق ثم أعد المحاولة."],
    [/signup.*disabled/i,                 "التسجيل معطّل في إعدادات Supabase."],
    [/email.*not.*confirm/i,              "لم يُؤكَّد البريد بعد. افتح رابط التأكيد في بريدك."],
  ];
  for (const [re, msg] of map) if (re.test(raw)) return msg;

  if (raw) return raw;
  if (code) return `الخادم أعاد الرمز ${code} بلا تفاصيل. راجع Supabase → Logs → Auth للسبب الدقيق.`;
  return "الخادم لم يرسل تفاصيل. راجع Supabase → Logs → Auth للسبب الدقيق.";
}

function ConfirmDialog({ open, title, body, confirmLabel = "تأكيد", danger, requireText, onConfirm, onCancel }) {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) setTyped(""); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  const ok = !requireText || typed.trim() === String(requireText).trim();
  return (
    <div dir="rtl" className="fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center sm:p-4" style={{ backgroundColor: "rgba(15,23,42,0.55)" }} onClick={onCancel}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl p-5 shadow-xl sm:p-6" style={{ backgroundColor: "#FFFFFF", fontFamily: "'Cairo', Arial, sans-serif" }} onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-2 text-base font-bold" style={{ color: danger ? "#B42318" : NAVY }}>
          <AlertCircle size={18} /> {title}
        </div>
        <div className="mb-4 text-sm leading-relaxed" style={{ color: MUTED }}>{body}</div>
        {requireText && (
          <div className="mb-4">
            <div className="mb-1.5 text-xs font-semibold" style={{ color: TEXT }}>
              للتأكيد، اكتب: <span className="font-bold" style={{ color: "#B42318" }}>{requireText}</span>
            </div>
            <input
              autoFocus
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ border: `1px solid ${BORDER}` }}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && ok) onConfirm?.(); }}
            />
          </div>
        )}
        <div className="flex gap-2">
          <button
            disabled={!ok}
            onClick={onConfirm}
            className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: danger ? "#B42318" : NAVY }}
          >
            {confirmLabel}
          </button>
          <button onClick={onCancel} className="flex-1 rounded-lg py-2.5 text-sm font-bold" style={{ border: `1px solid ${BORDER}`, color: TEXT }}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}


/* ── شريط حالة الترخيص ─────────────────────────────────────────────────────
   يظهر أعلى التطبيق. رسالته تتدرّج: معلومة → تحذير → إنذار.
   لا يمنع الاستخدام بنفسه؛ المنع في قاعدة البيانات. */
function LicenseBanner({ license, onUpgrade }) {
  const notice = licenseNotice(license);
  if (!notice) return null;
  const tones = {
    info:  { bg: "#EFF6FF", fg: "#1E40AF" },
    warn:  { bg: "#FFF7E6", fg: "#8A6D00" },
    error: { bg: "#FEF2F2", fg: "#B42318" },
  };
  const t = tones[notice.tone] || tones.info;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-2 text-center text-xs font-semibold"
         style={{ backgroundColor: t.bg, color: t.fg }}>
      <AlertCircle size={14} className="shrink-0" />
      <span>{notice.text}</span>
      {onUpgrade && (
        <button onClick={onUpgrade}
                className="rounded-md px-2.5 py-1.5 text-[11px] font-bold text-white"
                style={{ backgroundColor: t.fg }}>
          {license.canWrite ? "اشترك الآن" : "تفعيل الاشتراك"}
        </button>
      )}
    </div>
  );
}

/* ── دعوة الفريق: كود المكتب ───────────────────────────────────────────────
   يراه المالك فقط. زملاؤه يكتبونه عند التسجيل فينضمّون لمكتبه لا لمكتب آخر. */
function TeamInvite({ license }) {
  const [copied, setCopied] = useState(false);
  if (!license?.inviteCode) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(license.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* المتصفح منع النسخ — الكود ظاهر ليُكتب يدويًا */ }
  };
  return (
    <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
      <div className="mb-2 h-section">دعوة فريق المكتب</div>
      <p className="mb-3 text-xs leading-5 text-muted">
        شارك هذا الكود مع مهندسي مكتبك. يكتبونه عند إنشاء حساب فينضمّون لمكتبك،
        ثم تعتمدهم من صفحة الفريق. لا تنشره علنًا.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg px-3 py-2 text-base font-bold tracking-widest"
              style={{ backgroundColor: "#F1F5F9", color: NAVY }}>
          {license.inviteCode}
        </code>
        <button onClick={copy} className="rounded-lg px-3 py-2 text-xs font-bold"
                style={{ border: `1px solid ${BORDER}`, color: TEXT }}>
          {copied ? "✓ تم النسخ" : "نسخ"}
        </button>
        <span className="text-xs text-muted">
          الأعضاء: {license.membersCount} من {license.seats} مقعدًا
        </span>
      </div>
      {license.membersCount >= license.seats && (
        <div className="mt-2 text-xs font-semibold" style={{ color: "#8A6D00" }}>
          اكتمل عدد المقاعد — تواصل معنا لزيادتها قبل إضافة عضو جديد.
        </div>
      )}
    </div>
  );
}

function ClientsTable({ clients, settings, currentMember, priceBook, onUpdate }) {
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
          <h2 className="text-xl font-bold text-navy">ملفات ومستندات العملاء</h2>
          <p className="mt-1 text-xs text-muted">مقايسة، عقد، عرض تقديمي وكشف حركة — لكل عميل، من مكان واحد.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => exportPipelineSummary(clients, settings)} className="btn btn-primary">
            <Download size={15} /> ملخص كل العملاء
          </button>
          {/* للمحاسب: كشف حركة موحّد بدل نقل الأرقام شفهيًا */}
          <button onClick={() => exportLedger(clients)} className="btn btn-gold" title="كشف حركة بكل العقود والتحصيلات والمصروفات">
            <FileSpreadsheet size={15} /> دفتر الحركة للمحاسب
          </button>
        </div>
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
        <div className="overflow-x-auto rounded-xl shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <table className="w-full min-w-[720px] text-sm">
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
                      <button onClick={() => exportFullBOQ(c, settings, { includeCost: can(currentMember, "viewCostBasis"), priceBook })} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "#E2EFDA", color: "#1E7B45" }}>
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
                        <button onClick={() => generateContractDocx(c, calc, settings).then(d => downloadDocx(`عقد_${c.name || "عميل"}.docx`, d))} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "#FCE9B5", color: "#8A6D00" }}>
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
  const [priceBook, setPriceBook] = useState(DEFAULT_PRICEBOOK);
  const [tab, setTab] = useState("dashboard"); // dashboard | clients | pricebook | settings
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [errorToast, setErrorToast] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [license, setLicense] = useState(LICENSE_UNKNOWN);
  const [isAdmin, setIsAdmin] = useState(false);
  /* readOnly: الاشتراك منتهٍ. الأزرار تختفي، والكتابة مرفوضة من قاعدة البيانات أصلًا. */
  const readOnly = license.loaded && !license.canWrite;
  /* مرجع حتى تراه الدوال المحفوظة بـ useCallback دون إعادة إنشائها */
  const readOnlyRef = useRef(readOnly);
  useEffect(() => { readOnlyRef.current = readOnly; }, [readOnly]);
  const [team, setTeam] = useState([]);
  const [pendingMembers, setPendingMembers] = useState([]);
  const [currentMember, setCurrentMember] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const cloud = isCloudMode();
  const simpleMode = cloud && isSimpleMode();

  const reloadAll = useCallback(async () => {
    const settingsVal = await storageGet("settings:global", DEFAULT_SETTINGS);
    setSettings(settingsVal);
    setPriceBook(await storageGet("settings:pricebook", DEFAULT_PRICEBOOK));
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
    /* مسح كل ما يخصّ المكتب السابق قبل دخول مستخدم آخر.
       بدون هذا، يُكتب عمل المستخدم الجديد في مكتب من سبقه. */
    clearOrgCache();
    setClients([]);
    setSelectedId(null);
    setLicense(LICENSE_UNKNOWN);
    setIsAdmin(false);
    setTab("dashboard");
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

  useEffect(() => {
    let alive = true;
    fetchLicense().then(l => { if (alive) setLicense(l); }).catch(() => {});
    amIPlatformAdmin().then(v => { if (alive) setIsAdmin(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };
  const showError = (msg) => { setErrorToast(msg); setTimeout(() => setErrorToast(null), 5000); };

  /* أي عملية تلمس الشبكة أو التخزين تمر من هنا. قبل ذلك كان الفشل صامتًا:
     ينقطع الإنترنت في الموقع، فيظن المستخدم أن بياناته حُفظت وهي لم تُحفظ. */
  const guard = useCallback(async (fn, failMsg = "تعذّر إتمام العملية — تحقّق من الاتصال وأعد المحاولة") => {
    try {
      return await fn();
    } catch (err) {
      console.error("[operation failed]", err);
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setErrorToast(offline ? "لا يوجد اتصال بالإنترنت — لم يتم الحفظ" : failMsg);
      setTimeout(() => setErrorToast(null), 5000);
      return undefined;
    }
  }, []);

  const saveClient = useCallback(async (client) => {
    if (readOnlyRef.current) {
      setErrorToast("الاشتراك منتهٍ — لا يمكن الحفظ. يمكنك التصدير والاحتفاظ ببياناتك.");
      setTimeout(() => setErrorToast(null), 5000);
      return;
    }
    setSaving(true);
    try {
      await storageSet("client:" + client.id, client);
    } catch (err) {
      console.error("[saveClient failed]", err);
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setErrorToast(offline
        ? "⚠️ لا يوجد اتصال — التعديل الأخير لم يُحفظ. لا تغلق الصفحة."
        : "⚠️ تعذّر حفظ التعديل الأخير. لا تغلق الصفحة وأعد المحاولة.");
      setTimeout(() => setErrorToast(null), 6000);
    } finally {
      setSaving(false);
    }
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

  // القالب اختياري: بدونه عميل فارغ، ومعه مقايسة كاملة جاهزة للتعديل
  const addClient = async (template = null) => {
    const c = template ? clientFromTemplate(template) : newClient();
    if (currentMember && currentMember.role === "engineer") {
      c.engineer = currentMember.name;
      c.engineerId = currentMember.id;
    }
    setClients(prev => [c, ...prev]);
    await saveClient(c);
    setSelectedId(c.id);
    setTab("clients");
    showToast(template ? `عميل جديد من قالب "${template.name}"` : "تمت إضافة عميل جديد");
  };

  const performDeleteClient = async (id) => {
    await guard(async () => {
      await storageDelete("client:" + id);
      setClients(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) setSelectedId(null);
      showToast("تم حذف العميل");
    }, "تعذّر حذف العميل — لم يُحذف شيء. تحقّق من الاتصال.");
  };

  /* الحذف لا يحدث مباشرة أبدًا: يفتح حوار تأكيد يطلب كتابة اسم العميل. */
  const deleteClient = (id) => {
    const c = clients.find(x => x.id === id);
    if (!c) return;
    setConfirmState({
      title: "حذف العميل نهائيًا",
      body: `سيُحذف العميل "${c.name || "بدون اسم"}" وكل ما يخصّه: المقايسة، أوامر التغيير، الدفعات، الزيارات والصور. لا يمكن التراجع عن هذا الإجراء.`,
      confirmLabel: "حذف نهائي",
      danger: true,
      requireText: c.name || "حذف",
      onConfirm: async () => { setConfirmState(null); await performDeleteClient(id); },
    });
  };

  const saveSettings = async (next) => {
    setSettings(next);
    const ok = await guard(async () => { await storageSet("settings:global", next); return true; },
      "تعذّر حفظ الإعدادات — تحقّق من الاتصال");
    if (ok) showToast("تم حفظ الإعدادات");
  };

  const exportBackup = async () => {
    await guard(async () => {
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
    }, "تعذّر تصدير النسخة الاحتياطية");
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
      <div className="flex flex-col gap-3 px-4 py-3 bg-navy sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-white sm:text-lg">نظام متابعة العملاء والتسعير</div>
          <div className="truncate text-xs" style={{ color: "#AEB9C6" }}>{officeLine(settings)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
        <nav className="-mx-1 flex gap-1 overflow-x-auto rounded-lg p-1 lg:mx-0 lg:overflow-visible" style={{ backgroundColor: NAVY_DARK, scrollbarWidth: "none" }}>
          {[
            ["dashboard", "لوحة المتابعة", LayoutDashboard],
            ["clients", "العملاء", Users],
            ...(can(currentMember, "viewCostBasis") ? [["pricebook", "دفتر الأسعار", Ruler]] : []),
            ["settings", "الإعدادات", Settings],
            ...(license.loaded && license.status !== "local" ? [["billing", "الاشتراك", CreditCard]] : []),
            ...(isAdmin ? [["admin", "إدارة المنصّة", ShieldCheck]] : []),
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold transition-colors sm:px-3 sm:py-1.5 sm:text-sm"
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
        <div className="fixed left-1/2 top-4 z-50 max-w-[92vw] -translate-x-1/2 rounded-lg px-4 py-2 text-center text-sm font-semibold text-white shadow-lg" style={{ backgroundColor: "#1E7B45" }}>
          {toast}
        </div>
      )}

      {errorToast && (
        <div
          role="alert"
          className="fixed left-1/2 top-4 z-[60] flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg"
          style={{ backgroundColor: "#B42318" }}
        >
          <AlertCircle size={16} className="shrink-0" />
          <span>{errorToast}</span>
          <button onClick={() => setErrorToast(null)} className="shrink-0 opacity-80" aria-label="إغلاق التنبيه">
            <X size={15} />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title}
        body={confirmState?.body}
        confirmLabel={confirmState?.confirmLabel}
        danger={confirmState?.danger}
        requireText={confirmState?.requireText}
        onConfirm={confirmState?.onConfirm}
        onCancel={() => setConfirmState(null)}
      />

      <LicenseBanner license={license} onUpgrade={() => setTab("billing")} />

      <div className="p-3 sm:p-6">
        {tab === "dashboard" && (
          <Dashboard stats={pipelineStats} onAdd={addClient} clients={visibleClients} settings={settings} onOpenClient={(id) => { setSelectedId(id); setTab("clients"); }} />
        )}

        {tab === "clients" && !selected && (
          <>
            <ClientList clients={visibleClients} onAdd={addClient} onSelect={setSelectedId} onDelete={deleteClient} settings={settings} />
            {visibleClients.length > 0 && (
              <div className="mt-8 border-t pt-6" style={{ borderColor: BORDER }}>
                <ClientsTable clients={visibleClients} settings={settings} currentMember={currentMember} priceBook={priceBook} onUpdate={updateClient} />
              </div>
            )}
          </>
        )}

        {tab === "clients" && selected && (
          <ClientDetail
            client={selected}
            settings={settings}
            saving={saving}
            team={team}
            currentMember={currentMember}
            priceBook={priceBook}
            allClients={clients}
            onBack={() => setSelectedId(null)}
            onChange={(patch) => updateClient(selected.id, patch)}
            onDelete={() => deleteClient(selected.id)}
          />
        )}

        {tab === "pricebook" && (
          <PriceBookPanel
            clients={clients}
            book={priceBook}
            currentMember={currentMember}
            onSave={async (next) => { setPriceBook(next); await storageSet("settings:pricebook", next); }}
          />
        )}

        {tab === "billing" && (
          <React.Suspense fallback={
            <div className="flex h-64 items-center justify-center text-muted">
              <Loader2 className="animate-spin" size={24} />
            </div>
          }>
            <BillingPanel license={license} onToast={showToast} onError={showError} />
          </React.Suspense>
        )}

        {tab === "admin" && isAdmin && (
          <React.Suspense fallback={
            <div className="flex h-64 items-center justify-center text-sm text-muted">
              <Loader2 className="animate-spin" size={24} />
            </div>
          }>
            <AdminPanel onToast={showToast} onError={showError} />
          </React.Suspense>
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
            license={license}
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
          <div className="mb-3 h-section">قيمة خط الأعمال حسب المرحلة</div>
          {stats.count > 0 ? <StageValueChart stats={stats} /> : (
            <div className="flex h-40 items-center justify-center text-sm text-muted">لا يوجد بيانات بعد</div>
          )}
        </div>
        <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <div className="mb-3 h-section">نمو خط الأعمال آخر 6 أشهر</div>
          {clients.length > 0 ? <div className="gridpaper"><MonthlyTrendChart clients={clients} settings={settings} /></div> : (
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
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => onAdd()} className="btn btn-primary">
            <Plus size={15} /> عميل فارغ
          </button>
          {TEMPLATES.map(t => (
            <button
              key={t.id || t.name}
              onClick={() => onAdd(t)}
              className="btn"
              style={{ border: "1px solid var(--color-line)", color: NAVY, background: "#FFFFFF" }}
              title={`${t.area} م² — مقايسة جاهزة`}
            >
              {t.name}
            </button>
          ))}
        </div>
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
              <div key={c.id} className="sheet overflow-hidden">
                {/* شريط المرحلة: أول ما تلتقطه العين، كما في ترميز المخططات */}
                <div style={{ height: 3, backgroundColor: STAGE_COLORS[c.stage] || MUTED }} />

                {/* كتلة العنوان — مقتبسة من ركن المخطط المعماري */}
                <div className="titleblock">
                  <div>
                    <span className="tb-label">المساحة</span>
                    <span className="tb-value">{c.area} م²</span>
                  </div>
                  <div>
                    <span className="tb-label">المرحلة</span>
                    <span className="tb-value" style={{ color: STAGE_COLORS[c.stage] || MUTED, fontSize: 11 }}>{c.stage}</span>
                  </div>
                  <div>
                    <span className="tb-label">المهندس</span>
                    <span className="tb-value" style={{ fontSize: 11 }}>{c.engineer || "—"}</span>
                  </div>
                </div>

                <div className="p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="text-base font-semibold text-ink">{c.name || "بدون اسم"}</div>
                  <button onClick={() => onDelete(c.id)} className="shrink-0 text-gray-300 hover:text-red-500"><Trash2 size={15} /></button>
                </div>
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted"><MapPin size={12} />{c.address || "بدون عنوان"}</div>
                {c.phone && <div className="mb-2 flex items-center gap-1.5 text-xs text-muted num"><Phone size={12} />{c.phone}</div>}
                {(c.stage === "قيد التنفيذ" || c.progressPercent > 0) && (
                  <div className="mb-2">
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
                      <span>نسبة الإنجاز بالموقع</span>
                      <span>{c.progressPercent || 0}%</span>
                    </div>
                    <div className="h-px w-full bg-light" style={{ height: 2 }}>
                      <div style={{ width: `${c.progressPercent || 0}%`, height: 2, backgroundColor: "#1E7B45" }} />
                    </div>
                  </div>
                )}
                <div className="mb-3 flex items-baseline justify-between border-t pt-2" style={{ borderColor: "var(--color-line)" }}>
                  <span className="lbl">
                    {calc.frozen ? `متعاقد عليه · ${calc.signedAt}` : "تقديري"}
                  </span>
                  <span className="num text-base font-semibold text-navy">{fmt(calc.grandTotal)} ج.م</span>
                </div>
                <button onClick={() => onSelect(c.id)} className="w-full py-1.5 text-sm font-semibold" style={{ border: `1px solid ${NAVY}`, color: NAVY, borderRadius: 2 }}>
                  فتح التفاصيل
                </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================= Client detail ============================= */
/* ═══════════ اللوحة المالية ═══════════
   الطبقة التي كانت غائبة: ما قيمة العقد بعد التغييرات؟ كم حُصِّل؟ كم صُرف؟
   تظهر بعد التعاقد فقط — قبله لا يوجد رقم ملزم يُقاس عليه. */
/* ═══════════ جدول الغرف ═══════════
   المعماري يفكر بالغرف لا بالبنود. تُدخل الغرف مرة، فتُشتق منها كميات
   الأرضيات والسكيرتنج وسيراميك الحوائط والأسقف تلقائيًا.
   الربط بأكواد البنود الثابتة — ولهذا كان إصلاح المعرّفات شرطًا لهذه الميزة. */
/* ═══════════ العمود الفقري الزمني ═══════════
   التبويبات تُخفي التسلسل. أول سؤال يخطر لمن يفتح صفحة مشروع هو
   "أين هو الآن؟" — وهذا الشريط يجيبه قبل أي شيء آخر. */
/* ═══════════ تنبيهات التسعير ═══════════
   لا يمنع شيئًا — يعرض للمراجعة فقط. المكتب أدرى بسعره، لكن
   صفرًا زائدًا في الإدخال خطأ صامت يكلّف عقدًا كاملًا. */
function PriceAnomalies({ client, allClients, priceBook, currentMember }) {
  const outliers = useMemo(
    () => priceOutliers(client, ITEMS, allClients || [], priceBook || DEFAULT_PRICEBOOK),
    [client, allClients, priceBook]
  );
  if (!can(currentMember, "editUnitPrice") || outliers.length === 0) return null;
  return (
    <div className="sheet mt-4 p-3" style={{ borderColor: "#B45309" }}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold" style={{ color: "#B45309" }}>
        <AlertCircle size={14} /> أسعار تستحق المراجعة
      </div>
      {outliers.map(o => (
        <div key={o.id} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
          <span className="code">{o.id}</span>
          <span className="font-semibold text-ink">{o.name}</span>
          <span className="num text-muted">
            أدخلت <b style={{ color: "#C00000" }}>{fmt(o.entered)}</b> — المعتاد لديك قرابة <b>{fmt(o.reference)}</b>
          </span>
        </div>
      ))}
      <div className="mt-1.5 text-[10px] text-muted">
        قد يكون مقصودًا. هذا تنبيه لا منع.
      </div>
    </div>
  );
}

function ProjectSpine({ client }) {
  const idx = Math.max(0, STAGES.indexOf(client.stage));
  return (
    <div className="sheet mb-4 p-3">
      <div className="flex items-center">
        {STAGES.map((st, i) => {
          const done = i < idx, here = i === idx;
          const color = done || here ? (STAGE_COLORS[st] || NAVY) : "var(--color-line-firm)";
          return (
            <React.Fragment key={st}>
              <div className="flex flex-col items-center" style={{ minWidth: 0, flex: "0 0 auto" }}>
                <span
                  style={{
                    width: here ? 12 : 8, height: here ? 12 : 8, borderRadius: "50%",
                    backgroundColor: done || here ? color : "#FFFFFF",
                    border: `2px solid ${color}`,
                  }}
                />
                <span
                  className="mt-1 whitespace-nowrap text-[10px]"
                  style={{ color: here ? color : "var(--color-muted)", fontWeight: here ? 700 : 500 }}
                >
                  {st}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <span className="mx-1 flex-1" style={{ height: 2, backgroundColor: i < idx ? (STAGE_COLORS[STAGES[i + 1]] || NAVY) : "var(--color-line)" }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ما عُلّق على هذه النقطة من أحداث موثّقة */}
      {(client.contract || (client.variations || []).length > 0 || client.progressPercent > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[10px]" style={{ borderColor: "var(--color-line)" }}>
          {client.contract && <span className="text-muted">عقد مجمّد · <b className="num text-ink">{client.contract.signedAt}</b></span>}
          {(client.variations || []).length > 0 && (
            <span className="text-muted">أوامر تغيير · <b className="num text-ink">{(client.variations || []).length}</b></span>
          )}
          {client.progressPercent > 0 && (
            <span className="text-muted">تنفيذ · <b className="num text-ink">{client.progressPercent}%</b>{client.lastVisitAt ? ` حتى ${client.lastVisitAt}` : ""}</span>
          )}
        </div>
      )}
    </div>
  );
}

function RoomSchedule({ client, onChange }) {
  const [importMsg, setImportMsg] = useState([]);
  const rooms = client.rooms || [];
  const q = deriveQuantities(rooms);
  const setRooms = (next) => onChange({ rooms: next });

  const apply = (force) => {
    const res = applySuggestions({ ...client, rooms }, rooms, { force });
    onChange({ items: res.client.items, area: q.floorArea || client.area });
  };

  return (
    <div className="sheet mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="h-section">جدول الغرف</span>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setRooms([...rooms, newRoom(rooms.length + 1)])} className="btn btn-primary">
            <Plus size={14} /> غرفة
          </button>
          <label className="btn" style={{ border: "1px solid var(--color-line)", color: NAVY, cursor: "pointer" }}
                 title="صدّر Room Schedule من Revit إلى CSV واستورده هنا">
            <UploadCloud size={14} /> استيراد من BIM
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              const res = parseSchedule(parseCSV(await f.text()));
              setImportMsg(res.warnings);
              if (res.rooms.length) setRooms([...rooms, ...res.rooms]);
            }} />
          </label>
        </div>
      </div>

      {importMsg.length > 0 && (
        <div className="mb-2 p-2 text-[10px]" style={{ background: "#FFF7E6", border: "1px solid #E8C97A", borderRadius: 2 }}>
          {importMsg.map((w, i) => <div key={i} style={{ color: "#8A6D00" }}>• {w}</div>)}
        </div>
      )}
      {rooms.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted">
          أدخل الغرف يدويًا، أو استورد Room Schedule من نموذج Revit مباشرة —
          فتُحسب كميات الأرضيات والسكيرتنج وسيراميك الحمامات تلقائيًا.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {rooms.map((r, i) => {
              const m = roomMetrics(r);
              return (
                <div key={r.id || i} className="flex flex-wrap items-center gap-2">
                  <input className="inp" style={{ width: 120 }} placeholder="الاسم"
                    value={r.name || ""} onChange={e => setRooms(rooms.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <select className="inp" style={{ width: 110 }} value={r.type}
                    onChange={e => setRooms(rooms.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                    {Object.keys(ROOM_TYPES).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input className="inp num" style={{ width: 74 }} type="number" inputMode="decimal" placeholder="طول"
                    value={r.length || ""} onChange={e => setRooms(rooms.map((x, j) => j === i ? { ...x, length: Number(e.target.value) || 0 } : x))} />
                  <input className="inp num" style={{ width: 74 }} type="number" inputMode="decimal" placeholder="عرض"
                    value={r.width || ""} onChange={e => setRooms(rooms.map((x, j) => j === i ? { ...x, width: Number(e.target.value) || 0 } : x))} />
                  <span className="num text-xs text-muted" style={{ width: 70 }}>{m.area} م²</span>
                  <button onClick={() => setRooms(rooms.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 sm:grid-cols-4" style={{ borderColor: "var(--color-line)" }}>
            <div><span className="lbl">أرضيات</span><span className="tb-value">{q.floorArea} م²</span></div>
            <div><span className="lbl">سكيرتنج</span><span className="tb-value">{q.dryPerimeter} م</span></div>
            <div><span className="lbl">حوائط رطبة</span><span className="tb-value">{q.wetWallArea} م²</span></div>
            <div><span className="lbl">حمامات</span><span className="tb-value">{q.bathrooms}</span></div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => apply(false)} className="btn btn-gold">تطبيق على المقايسة</button>
            <button onClick={() => apply(true)} className="btn" style={{ border: "1px solid var(--color-line)", color: NAVY }}>
              تطبيق واستبدال اليدوي
            </button>
          </div>
          <div className="mt-1.5 text-[10px] text-muted">
            التطبيق العادي لا يمس أي كمية أدخلتها بنفسك — الاستبدال يدهسها.
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════ المقايسة موزّعة على المراحل الخمس ═══════════════════
   هذا هو العرض الذي يُقدَّم للعميل: كل مرحلة بقيمتها كاملة، وما يُحصَّل
   قبل بدئها وما يُحصَّل بعد تسليمها. الأرقام نفسها الموجودة في ملخص السعر
   — لكن مقسّمة على تسلسل التنفيذ بدل نطاقات العمل. */
export function PhaseBOQ({ client, settings, currentMember, onChange }) {
  const byPhase = useMemo(() => calcByPhase(client, settings), [client, settings]);
  const plan = useMemo(() => phasePaymentPlan(client, settings, byPhase), [client, settings, byPhase]);
  const [openPhase, setOpenPhase] = useState(null);
  const mayEditPrice = can(currentMember, "editUnitPrice");
  const usingOfficeDefault = client.agreedProfitPct === undefined || client.agreedProfitPct === "" || client.agreedProfitPct === null;

  return (
    <div className="sheet mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-navy">المقايسة بمراحل التنفيذ الخمس</div>
          <div className="text-[11px] text-muted">
            قيمة كل مرحلة تُحصَّل كاملة قبل بدء العمل فيها · نسبة الربح تُحصَّل بعد تسليم المرحلة وقبولها
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="lbl">نسبة الربح المتفق عليها</span>
          <input
            type="number" inputMode="decimal" step="0.5" min="0" max="100"
            disabled={!mayEditPrice}
            className="w-20 rounded-md px-2 py-1 text-xs font-bold disabled:opacity-40"
            style={{ border: `1px solid ${plan.pctMissing ? "#C00000" : BORDER}`, textAlign: "center" }}
            value={usingOfficeDefault ? "" : (Number(client.agreedProfitPct) * 100).toFixed(1)}
            placeholder={((Number(settings.agreedProfitPct) || 0) * 100).toFixed(1)}
            onChange={e => onChange({
              agreedProfitPct: e.target.value === "" ? undefined : Number(e.target.value) / 100,
            })}
          />
          <span className="text-xs font-bold text-muted">%</span>
        </div>
      </div>

      {plan.pctMissing && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[11px] font-semibold"
             style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
          لم تُحدَّد نسبة الربح — كل أعمدة الربح ستظهر صفرًا. اضبطها هنا لهذا العميل، أو من الإعدادات لكل العملاء.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {plan.rows.map((row, i) => {
          const p = byPhase.phases[i];
          const color = PHASE_COLORS[row.phase] || NAVY;
          const isOpen = openPhase === row.phase;
          return (
            <div key={row.phase} className="rounded-lg" style={{ border: `1px solid ${BORDER}`, opacity: row.empty ? 0.55 : 1 }}>
              <button
                onClick={() => setOpenPhase(isOpen ? null : row.phase)}
                className="flex w-full flex-wrap items-center gap-2 p-3 text-right"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: color }}>{row.order}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold" style={{ color }}>{row.phase}</span>
                  <span className="block text-[10px] text-muted">
                    {row.empty ? "لا بنود مُضمَّنة" : `${row.itemCount} بند · بنود ${fmt(row.base)} + إشراف واحتياطي وضريبة`}
                  </span>
                </span>
                <span className="text-left">
                  <span className="lbl block">قبل البدء</span>
                  <span className="num block text-sm font-bold text-navy">{fmt(row.quote)}</span>
                </span>
                <span className="text-left" style={{ minWidth: 88 }}>
                  <span className="lbl block">بعد التسليم</span>
                  <span className="num block text-sm font-bold" style={{ color: row.profitDue > 0 ? "#1E7B45" : MUTED }}>
                    {fmt(row.profitDue)}
                  </span>
                </span>
                <span className="text-left" style={{ minWidth: 92 }}>
                  <span className="lbl block">إجمالي المرحلة</span>
                  <span className="num block text-sm font-bold" style={{ color: "#8A6D00" }}>{fmt(row.phaseTotal)}</span>
                </span>
                <ChevronLeft size={14} style={{ transform: isOpen ? "rotate(-90deg)" : "none", color: MUTED }} />
              </button>

              {isOpen && !row.empty && (
                <div className="border-t px-3 py-2" style={{ borderColor: BORDER }}>
                  {p.lines.filter(l => l.included).map(l => (
                    <div key={l.id} className="flex items-center justify-between gap-2 border-b py-1 last:border-0"
                         style={{ borderColor: "var(--color-line)" }}>
                      <span className="min-w-0 flex-1 text-[11px]">{l.name}</span>
                      <span className="text-[10px] text-muted">{Math.round(l.qty * 100) / 100} {l.unit}</span>
                      <span className="num w-24 text-left text-[11px] font-bold text-navy">{fmt(l.total)} ج.م</span>
                    </div>
                  ))}
                  <div className="mt-2 flex flex-col gap-0.5 text-[11px]">
                    <div className="flex justify-between"><span className="text-muted">إجمالي البنود</span><span className="num font-bold">{fmt(p.base)}</span></div>
                    {p.supervision > 0 && <div className="flex justify-between"><span className="text-muted">إشراف هندسي</span><span className="num">{fmt(p.supervision)}</span></div>}
                    {p.contingency > 0 && <div className="flex justify-between"><span className="text-muted">احتياطي</span><span className="num">{fmt(p.contingency)}</span></div>}
                    <div className="flex justify-between"><span className="text-muted">ضريبة القيمة المضافة</span><span className="num">{fmt(p.vat)}</span></div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 border-t pt-3" style={{ borderColor: BORDER }}>
        <SummaryRow label="إجمالي المقايسة (يُحصَّل قبل المراحل)" value={plan.quoteTotal} />
        <SummaryRow label={`إجمالي الربح ${plan.pct > 0 ? `(${(plan.pct * 100).toFixed(1)}%)` : ""} — بعد التسليمات`} value={plan.profitTotal} />
        <SummaryRow label="إجمالي قيمة التعاقد" value={plan.contractTotal} bold />
      </div>
    </div>
  );
}

/* ═══════════════════ جدول التحصيل بالمراحل ═══════════════════
   العمود الفقري النقدي للمشروع: ما يجب تحصيله قبل كل مرحلة،
   وما يُستحق بعد تسليمها — ومنع اعتبار مرحلة جاهزة قبل تحصيلها. */
export function PhaseCollection({ client, settings, currentMember, onChange }) {
  const byPhase = useMemo(() => calcByPhase(client, settings), [client, settings]);
  const plan = useMemo(() => phasePaymentPlan(client, settings, byPhase), [client, settings, byPhase]);
  const mayCollect = can(currentMember, "editUnitPrice");

  const addReceiptFor = (row, kind) => {
    const list = [...(client.receipts || [])];
    const rc = newReceipt(client.id, list.length + 1, row.phase, kind);
    rc.amount = Math.round(kind === "profit" ? row.profitRemaining : row.baseRemaining);
    rc.note = `${kind === "profit" ? "ربح" : "قيمة"} — ${row.phase}`;
    onChange({ receipts: [...list, rc] });
  };
  const toggleDelivered = (row) => {
    onChange({
      phaseDelivered: row.deliveredAt
        ? unmarkPhaseDelivered(client, row.phase)
        : markPhaseDelivered(client, row.phase),
    });
  };

  const STATUS_STYLE = {
    empty:     { bg: "#F5F7FA", fg: "#9CA3AF" },
    awaiting:  { bg: "#FDECEC", fg: "#C00000" },
    ready:     { bg: "#E8EEF7", fg: "#1F4E78" },
    profitDue: { bg: "#FFF7E6", fg: "#B45309" },
    done:      { bg: "#E2EFDA", fg: "#1E7B45" },
  };

  return (
    <div className="sheet p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="h-section">جدول التحصيل بالمراحل</span>
        <span className="text-[11px] text-muted">نسبة الربح {(plan.pct * 100).toFixed(1)}%</span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: "#E2EFDA" }}>
          <div className="lbl">المحصّل</div>
          <div className="num text-sm font-bold" style={{ color: "#1E7B45" }}>{fmt(plan.collected)}</div>
        </div>
        <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: plan.dueNow > 0 ? "#FDECEC" : "#F5F7FA" }}>
          <div className="lbl">المستحق الآن</div>
          <div className="num text-sm font-bold" style={{ color: plan.dueNow > 0 ? "#C00000" : MUTED }}>{fmt(plan.dueNow)}</div>
        </div>
        <div className="rounded-lg p-2.5 text-center bg-light">
          <div className="lbl">المتبقي على التعاقد</div>
          <div className="num text-sm font-bold text-navy">{fmt(plan.outstanding)}</div>
        </div>
      </div>

      {plan.unallocated > 0 && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[11px] font-semibold" style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
          {fmt(plan.unallocated)} ج.م محصّلة غير منسوبة لأي مرحلة — دفعات سُجّلت قبل تفعيل نظام المراحل. انسبها من قائمة الدفعات أدناه.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {plan.rows.map(row => {
          const st = STATUS_STYLE[row.status];
          const color = PHASE_COLORS[row.phase] || NAVY;
          return (
            <div key={row.phase} className="rounded-lg p-3" style={{ border: `1px solid ${BORDER}`, opacity: row.empty ? 0.5 : 1 }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: color }}>{row.order}</span>
                <span className="min-w-0 flex-1 text-sm font-bold" style={{ color }}>{row.phase}</span>
                <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                      style={{ backgroundColor: st.bg, color: st.fg }}>
                  {row.statusLabel}
                </span>
              </div>

              {!row.empty && (
                <>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {/* الدفعة الأولى — قبل البدء */}
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: row.baseSettled ? "#E2EFDA" : "#FAFBFC", border: `1px solid ${BORDER}` }}>
                      <div className="flex items-baseline justify-between">
                        <span className="lbl">قيمة المرحلة — قبل البدء</span>
                        <span className="num text-sm font-bold text-navy">{fmt(row.quote)}</span>
                      </div>
                      <div className="mt-1 h-1 w-full" style={{ backgroundColor: "#E3E7EE" }}>
                        <div style={{ height: 4, width: `${row.quote > 0 ? Math.min(100, (row.paidBase / row.quote) * 100) : 100}%`, backgroundColor: "#1E7B45" }} />
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] text-muted">
                          محصّل {fmt(row.paidBase)} · متبقٍ {fmt(row.baseRemaining)}
                        </span>
                        {mayCollect && row.baseRemaining > 0.5 && (
                          <button onClick={() => addReceiptFor(row, "base")}
                                  className="text-[10px] font-bold underline" style={{ color: NAVY }}>
                            تسجيل تحصيل
                          </button>
                        )}
                      </div>
                    </div>

                    {/* الدفعة الثانية — بعد التسليم */}
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: row.deliveredAt && row.profitSettled ? "#E2EFDA" : "#FAFBFC", border: `1px solid ${BORDER}` }}>
                      <div className="flex items-baseline justify-between">
                        <span className="lbl">نسبة الربح — بعد التسليم</span>
                        <span className="num text-sm font-bold" style={{ color: "#1E7B45" }}>{fmt(row.profitDue)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] text-muted">
                          {row.deliveredAt
                            ? `سُلّمت ${row.deliveredAt} · محصّل ${fmt(row.paidProfit)}`
                            : "غير مستحقة — المرحلة لم تُسلَّم بعد"}
                        </span>
                        {mayCollect && row.profitClaimable && row.profitRemaining > 0.5 && (
                          <button onClick={() => addReceiptFor(row, "profit")}
                                  className="text-[10px] font-bold underline" style={{ color: "#1E7B45" }}>
                            تسجيل تحصيل
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    {!row.mayStart ? (
                      <span className="text-[11px] font-bold" style={{ color: "#C00000" }}>
                        ⛔ لا تبدأ التنفيذ — لم يُحصَّل {fmt(row.baseRemaining)} ج.م من قيمة المرحلة
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold" style={{ color: "#1E7B45" }}>
                        ✅ قيمة المرحلة محصّلة — مسموح بالبدء
                      </span>
                    )}
                    {mayCollect && (
                      <button onClick={() => toggleDelivered(row)}
                              className="rounded-md px-2.5 py-1 text-[11px] font-bold"
                              style={{
                                backgroundColor: row.deliveredAt ? "#FFFFFF" : NAVY,
                                color: row.deliveredAt ? "#C00000" : "#FFFFFF",
                                border: `1px solid ${row.deliveredAt ? "#C00000" : NAVY}`,
                              }}>
                        {row.deliveredAt ? "إلغاء تعليم التسليم" : "تعليم المرحلة مُسلَّمة"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* شريط نِسَب الفئات — يُستعمل في التحليل وفي المقارنة */
function KindBar({ kinds, total }) {
  const t = total || COST_KINDS.reduce((s, k) => s + (kinds[k] || 0), 0);
  if (!(t > 0)) return null;
  return (
    <>
      <div className="flex h-2 w-full overflow-hidden rounded" style={{ backgroundColor: "#E3E7EE" }}>
        {COST_KINDS.filter(k => (kinds[k] || 0) > 0).map(k => (
          <div key={k} title={`${KIND_LABEL[k]} — ${fmt(kinds[k])} ج.م`}
               style={{ width: `${((kinds[k] || 0) / t) * 100}%`, backgroundColor: KIND_COLOR[k] }} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        {COST_KINDS.filter(k => (kinds[k] || 0) > 0).map(k => (
          <span key={k} style={{ color: KIND_COLOR[k] }}>
            {KIND_SHORT[k]} <b className="num">{fmt(kinds[k])}</b> ({(((kinds[k] || 0) / t) * 100).toFixed(0)}%)
          </span>
        ))}
      </div>
    </>
  );
}

/* ═══════════════════ تحليل تكلفة المشروع ═══════════════════
   الوجه المخطَّط من المعادلة: كم قدّرنا لكل فئة، مرحلةً مرحلة وبندًا بندًا.
   يُعرض فقط لمن يرى أساس التكلفة — المهندس المنفّذ لا يرى تكاليف المكتب. */
export function CostAnalysis({ client, priceBook, currentMember }) {
  const [openPhase, setOpenPhase] = useState(null);
  const analysis = useMemo(() => {
    const list = catalogueWithCustom(priceBook);
    const rows = list.map(it => resolveItem(client, it, Number(client.area) || 0));
    return costAnalysis(priceBook, rows, Object.fromEntries(list.map(i => [i[5], i])));
  }, [client, priceBook]);

  if (!can(currentMember, "viewCostBasis")) return null;

  return (
    <div className="sheet mt-4 p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="h-section">تحليل تكلفة المشروع</span>
        <span className="num text-sm font-bold text-navy">{fmt(analysis.totalCost)} ج.م</span>
      </div>
      <div className="mb-3 text-[11px] text-muted">
        من دفتر الأسعار — بنفس التصنيف الذي تُسجَّل به مصروفات الموقع، فتصبح المقارنة ممكنة.
      </div>

      {analysis.totalCost > 0 && (
        <div className="mb-3"><KindBar kinds={analysis.byKind} total={analysis.totalCost} /></div>
      )}

      {!analysis.complete && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-5"
             style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
          {analysis.coverage === 0
            ? "لا يوجد بند محلَّل بعد — حلّل البنود من دفتر الأسعار ليصبح لهذا التقرير معنى."
            : `التحليل يغطي ${(analysis.coverage * 100).toFixed(0)}% من قيمة المشروع — ${analysis.unanalysed.length} بندًا بلا تحليل.`}
          {analysis.unanalysed.length > 0 && (
            <div className="mt-1">أكبرها: {analysis.unanalysed.slice(0, 3).map(u => u.name).join(" · ")}</div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {analysis.phases.filter(p => p.total > 0).map(p => {
          const isOpen = openPhase === p.phase;
          return (
            <div key={p.phase} className="rounded-lg p-2.5" style={{ border: `1px solid ${BORDER}` }}>
              <button onClick={() => setOpenPhase(isOpen ? null : p.phase)}
                      className="flex w-full flex-wrap items-baseline justify-between gap-2 text-right">
                <span className="text-xs font-bold" style={{ color: PHASE_COLORS[p.phase] || NAVY }}>{p.phase}</span>
                <span className="num text-xs font-bold text-navy">
                  {fmt(p.analysed)} ج.م
                  {p.unanalysed > 0 && <span className="mr-1 font-normal text-muted"> (+{fmt(p.unanalysed)} غير محلَّل)</span>}
                </span>
              </button>
              {p.analysed > 0 && <div className="mt-1.5"><KindBar kinds={p.kinds} total={p.analysed} /></div>}

              {isOpen && p.items.length > 0 && (
                <div className="mt-2 border-t pt-2" style={{ borderColor: BORDER }}>
                  {p.items.map(l => (
                    <div key={l.id} className="border-b py-1 last:border-0" style={{ borderColor: "var(--color-line)" }}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[11px] font-semibold">{l.name}</span>
                        <span className="text-[10px] text-muted">
                          تكلفة الوحدة <b className="num">{fmt(l.unitCost)}</b> × {Math.round(l.qty * 100) / 100} {l.unit}
                          {" = "}<b className="num" style={{ color: NAVY }}>{fmt(l.cost)}</b>{" · ربح "}
                          <b className="num" style={{ color: l.profit >= 0 ? "#1E7B45" : "#C00000" }}>{fmt(l.profit)}</b>
                          {l.ratio != null && ` (${(l.ratio * 100).toFixed(0)}%)`}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[9px]">
                        {COST_KINDS.filter(k => (l.kinds[k] || 0) > 0).map(k => (
                          <span key={k} style={{ color: KIND_COLOR[k] }}>{KIND_SHORT[k]} {fmt(l.kinds[k])}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════ حسابات مقاولي الباطن ═══════════════════ */
export function ContractorLedger({ client, onChange }) {
  const led = useMemo(() => contractorLedger(client), [client]);

  const add = () => {
    const list = [...(client.contractors || [])];
    onChange({ contractors: [...list, newContractor(client.id, list.length + 1)] });
  };
  const patch = (id, p) =>
    onChange({ contractors: (client.contractors || []).map(k => k.id === id ? { ...k, ...p } : k) });
  const remove = (id) =>
    onChange({ contractors: (client.contractors || []).filter(k => k.id !== id) });

  return (
    <div className="sheet p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="h-section">حسابات مقاولي الباطن</span>
        <button onClick={add} className="btn btn-primary"><Plus size={14} /> مقاول</button>
      </div>

      {led.rows.length === 0 ? (
        <div className="py-3 text-center text-xs text-muted">
          لا يوجد مقاولون. أضف المقاول بقيمة تعاقده، ثم اربط مصروفاته به ليُحسب المتبقي والمحتجز تلقائيًا.
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["قيمة التعاقدات", led.contracted, NAVY],
              ["مصروف فعلي", led.paid, "#C2410C"],
              ["محتجز ضمان", led.retained, "#B45309"],
              ["متبقٍ لهم", led.remaining, "#1E7B45"]].map(([lbl, val, col]) => (
              <div key={lbl} className="rounded-lg p-2 text-center bg-light">
                <div className="lbl">{lbl}</div>
                <div className="num text-sm font-bold" style={{ color: col }}>{fmt(val)}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            {led.rows.map(k => (
              <div key={k.id} className="rounded-lg p-2.5" style={{ border: `1px solid ${k.overCertified ? "#C00000" : BORDER}` }}>
                <div className="flex flex-wrap items-center gap-2">
                  <input className="inp" style={{ width: 130, marginBottom: 0 }} placeholder="اسم المقاول"
                    value={k.name} onChange={e => patch(k.id, { name: e.target.value })} />
                  <input className="inp" style={{ width: 100, marginBottom: 0 }} placeholder="الصنعة"
                    value={k.trade} onChange={e => patch(k.id, { trade: e.target.value })} />
                  <select className="inp" style={{ width: 140, marginBottom: 0 }} value={k.phase || ""}
                    onChange={e => patch(k.id, { phase: e.target.value })}>
                    <option value="">— المرحلة —</option>
                    {PHASES.map(p => <option key={p} value={p}>{PHASE_SHORT[p]}</option>)}
                  </select>
                  <input className="inp num" style={{ width: 110, marginBottom: 0 }} type="number" inputMode="decimal"
                    placeholder="قيمة التعاقد" value={k.contractValue || ""}
                    onChange={e => patch(k.id, { contractValue: Number(e.target.value) || 0 })} />
                  <span className="code">{k.id}</span>
                  <button onClick={() => remove(k.id)} className="text-xs" style={{ color: "#C00000" }}>✕</button>
                </div>

                <div className="mt-2 h-1.5 w-full" style={{ backgroundColor: "#E3E7EE" }}>
                  <div style={{ height: 6, width: `${Math.min(100, k.progress * 100)}%`,
                                backgroundColor: k.overCertified ? "#C00000" : "#1E7B45" }} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px]">
                  <span className="text-muted">مستخلصات <b className="num">{k.payments}</b></span>
                  <span className="text-muted">مصروف <b className="num">{fmt(k.paid)}</b></span>
                  <span style={{ color: "#B45309" }}>محتجز <b className="num">{fmt(k.retained)}</b></span>
                  <span className="text-muted">معتمد <b className="num">{fmt(k.certified)}</b></span>
                  <span style={{ color: k.remaining < 0 ? "#C00000" : "#1E7B45" }}>
                    متبقٍ <b className="num">{fmt(k.remaining)}</b>
                  </span>
                </div>
                {k.overCertified && (
                  <div className="mt-1 text-[10px] font-bold" style={{ color: "#C00000" }}>
                    ⛔ المصروف تجاوز قيمة التعاقد بـ {fmt(-k.remaining)} ج.م — راجع قبل أي صرف آخر
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {led.orphanTotal > 0 && (
        <div className="mt-3 rounded-lg px-3 py-2 text-[11px] font-semibold" style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
          {fmt(led.orphanTotal)} ج.م مصروفات مقاولي باطن غير منسوبة لمقاول معيّن
          ({led.orphanPayments.length} مصروف) — انسبها ليظهر متبقي كل مقاول بدقة.
        </div>
      )}
    </div>
  );
}

/* المصروف الفعلي مقابل مقايسة كل مرحلة — للمالك ومدير المشاريع فقط */
export function PhaseSpend({ client, settings, priceBook, onChange }) {
  const byPhase = useMemo(() => calcByPhase(client, settings), [client, settings]);
  const bud = useMemo(() => phaseBudget(client, byPhase), [client, byPhase]);
  const analysis = useMemo(() => {
    const list = catalogueWithCustom(priceBook || DEFAULT_PRICEBOOK);
    const rows = list.map(it => resolveItem(client, it, Number(client.area) || 0));
    return costAnalysis(priceBook || DEFAULT_PRICEBOOK, rows, Object.fromEntries(list.map(i => [i[5], i])));
  }, [client, priceBook]);
  const pva = useMemo(() => plannedVsActual(client, analysis), [client, analysis]);
  const contractors = client.contractors || [];
  const [openPhase, setOpenPhase] = useState(null);

  const addExpense = (phase) => {
    const list = [...(client.expenses || [])];
    onChange({ expenses: [...list, newExpense(client.id, list.length + 1, phase)] });
  };
  const patchExpense = (id, patch) => {
    onChange({ expenses: (client.expenses || []).map(e => e.id === id ? { ...e, ...patch } : e) });
  };
  const removeExpense = (id) => onChange({ expenses: (client.expenses || []).filter(e => e.id !== id) });

  return (
    <div className="sheet p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="h-section">مصروفات الموقع مقابل المقايسة</span>
        <button onClick={() => addExpense("")} className="btn btn-primary"><Plus size={14} /> مصروف</button>
      </div>
      <div className="mb-3 text-[11px] leading-5 text-muted">
        كل مصروف يُصنَّف بنفس فئات تحليل السعر — فيصبح السؤال قابلًا للإجابة:
        هل التجاوز في الخامة أم في العمالة أم في المقاول؟ المصروف بلا بند (ونش، نقل، أمن)
        يُعتبر غير مباشر ويُوزَّع على بنود مرحلته بالتناسب.
      </div>

      {/* الإجمالي بالفئة: مخطط مقابل فعلي */}
      {(pva.plannedTotal > 0 || pva.spentTotal > 0) && (
        <div className="mb-3 rounded-lg p-3" style={{ border: `1px solid ${BORDER}` }}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="lbl">إجمالي المشروع بالفئة</span>
            <span className="text-[11px]">
              <span className="text-muted">مخطط </span>
              <b className="num">{fmt(pva.plannedTotal)}</b>
              <span className="text-muted"> · فعلي </span>
              <b className="num" style={{ color: pva.diff < 0 ? "#C00000" : "#1E7B45" }}>{fmt(pva.spentTotal)}</b>
            </span>
          </div>
          {pva.totals.filter(t => t.planned > 0 || t.spent > 0).map(t => {
            const max = Math.max(t.planned, t.spent) || 1;
            return (
              <div key={t.kind} className="mb-1.5">
                <div className="flex items-baseline justify-between text-[10px]">
                  <span style={{ color: KIND_COLOR[t.kind] }}>{KIND_LABEL[t.kind]}</span>
                  <span className="num">
                    <span className="text-muted">{fmt(t.planned)}</span>
                    {" → "}
                    <b style={{ color: t.overrun ? "#C00000" : "#1E7B45" }}>{fmt(t.spent)}</b>
                    {t.overrun && <span style={{ color: "#C00000" }}> (+{fmt(-t.diff)})</span>}
                  </span>
                </div>
                <div className="mt-0.5 flex gap-0.5">
                  <div style={{ height: 5, width: `${(t.planned / max) * 100}%`, backgroundColor: KIND_COLOR[t.kind], opacity: 0.35 }} />
                </div>
                <div className="flex gap-0.5">
                  <div style={{ height: 5, width: `${(t.spent / max) * 100}%`, backgroundColor: t.overrun ? "#C00000" : KIND_COLOR[t.kind] }} />
                </div>
              </div>
            );
          })}
          {pva.worstKind && (
            <div className="mt-2 text-[10px] font-bold" style={{ color: "#C00000" }}>
              أكبر تجاوز في {KIND_LABEL[pva.worstKind.kind]}: {fmt(pva.worstKind.spent - pva.worstKind.planned)} ج.م فوق المخطط
            </div>
          )}
          {pva.coverage < 1 && (
            <div className="mt-1 text-[10px]" style={{ color: "#8A6D00" }}>
              التحليل يغطي {(pva.coverage * 100).toFixed(0)}% من المشروع — المقارنة تخصّ المحلَّل وحده.
            </div>
          )}
        </div>
      )}

      {/* كل مرحلة: قيمة المقايسة، المصروف، والتفصيل بالفئة */}
      <div className="flex flex-col gap-2">
        {bud.lines.map((l) => {
          const ph = pva.phases.find(x => x.phase === l.phase);
          const isOpen = openPhase === l.phase;
          return (
            <div key={l.phase} className="rounded-lg p-2.5" style={{ border: `1px solid ${BORDER}`, opacity: l.empty ? 0.5 : 1 }}>
              <button onClick={() => setOpenPhase(isOpen ? null : l.phase)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 text-right">
                <span className="text-xs font-bold" style={{ color: PHASE_COLORS[l.phase] || NAVY }}>{l.phase}</span>
                <span className="num text-xs font-bold" style={{ color: l.overrun ? "#C00000" : "#1E7B45" }}>
                  {fmt(l.spent)} / {fmt(l.planned)} ج.م
                </span>
              </button>
              <div className="mt-1 h-1.5 w-full" style={{ backgroundColor: "#E3E7EE" }}>
                <div style={{ height: 6, width: `${Math.min(100, l.ratio * 100)}%`, backgroundColor: l.overrun ? "#C00000" : "#1E7B45" }} />
              </div>
              {l.overrun && (
                <div className="mt-1 text-[10px] font-bold" style={{ color: "#C00000" }}>
                  تجاوز {fmt(-l.diff)} ج.م فوق قيمة بنود المقايسة
                </div>
              )}
              {ph && ph.indirect > 0 && (
                <div className="mt-1 text-[10px]" style={{ color: "#8A6D00" }}>
                  منها {fmt(ph.indirect)} ج.م مصروفات غير مباشرة (معدات ونقل وخلافه) تُوزَّع على بنود المرحلة
                </div>
              )}

              {isOpen && ph && (
                <div className="mt-2 border-t pt-2" style={{ borderColor: BORDER }}>
                  {!ph.comparable ? (
                    <div className="text-[10px]" style={{ color: "#8A6D00" }}>
                      لا يوجد تحليل سعر لبنود هذه المرحلة — المقارنة بالفئة بلا معنى حتى تُحلَّل من دفتر الأسعار.
                    </div>
                  ) : ph.kinds.filter(k => !k.silent).map(k => (
                    <div key={k.kind} className="flex items-baseline justify-between border-b py-1 last:border-0 text-[10px]"
                         style={{ borderColor: "var(--color-line)" }}>
                      <span style={{ color: KIND_COLOR[k.kind] }}>{KIND_LABEL[k.kind]}</span>
                      <span className="num">
                        <span className="text-muted">مخطط {fmt(k.planned)}</span>
                        {" · "}
                        <b style={{ color: k.overrun ? "#C00000" : "#1E7B45" }}>فعلي {fmt(k.spent)}</b>
                        {k.overrun && <span style={{ color: "#C00000" }}> (+{fmt(-k.diff)})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(client.expenses || []).length > 0 && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: BORDER }}>
          <div className="lbl mb-2">سجل مصروفات الموقع</div>
          <div className="flex flex-col gap-2">
            {(client.expenses || []).map(e => (
              <div key={e.id} className="rounded-lg p-2" style={{ backgroundColor: LIGHT }}>
                <div className="flex flex-wrap items-center gap-2">
                  <input className="inp" style={{ width: 128, marginBottom: 0 }} type="date"
                    value={e.date || ""} onChange={ev => patchExpense(e.id, { date: ev.target.value })} />
                  <select className="inp" style={{ width: 140, marginBottom: 0 }}
                    value={COST_KINDS.includes(e.kind) ? e.kind : "other"}
                    onChange={ev => patchExpense(e.id, { kind: ev.target.value })}>
                    {COST_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                  <select className="inp" style={{ width: 140, marginBottom: 0 }} value={e.phase || ""}
                    onChange={ev => patchExpense(e.id, { phase: ev.target.value })}>
                    <option value="">— بلا مرحلة —</option>
                    {PHASES.map(p => <option key={p} value={p}>{PHASE_SHORT[p]}</option>)}
                  </select>
                  <input className="inp num" style={{ width: 100, marginBottom: 0 }} type="number" inputMode="decimal" placeholder="المبلغ"
                    value={e.amount || ""} onChange={ev => patchExpense(e.id, { amount: Number(ev.target.value) || 0 })} />
                  <input className="inp flex-1" style={{ minWidth: 110, marginBottom: 0 }} placeholder="المورد / البيان"
                    value={e.vendor || ""} onChange={ev => patchExpense(e.id, { vendor: ev.target.value })} />
                  <button onClick={() => removeExpense(e.id)} className="text-xs" style={{ color: "#C00000" }}>✕</button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <select className="inp" style={{ width: 160, marginBottom: 0 }} value={e.itemId || ""}
                    onChange={ev => patchExpense(e.id, { itemId: ev.target.value })}>
                    <option value="">— غير مباشر (يُوزَّع) —</option>
                    {analysis.lines.filter(l => !e.phase || l.phase === e.phase)
                      .map(l => <option key={l.id} value={l.id}>{l.name.slice(0, 30)}</option>)}
                  </select>
                  {e.kind === "subcontract" && (
                    <>
                      <select className="inp" style={{ width: 150, marginBottom: 0 }} value={e.contractorId || ""}
                        onChange={ev => patchExpense(e.id, { contractorId: ev.target.value })}>
                        <option value="">— المقاول —</option>
                        {contractors.map(k => <option key={k.id} value={k.id}>{k.name || k.id}</option>)}
                      </select>
                      <input className="inp num" style={{ width: 120, marginBottom: 0 }} type="number" inputMode="decimal"
                        placeholder="محتجز ضمان" value={e.retained || ""}
                        onChange={ev => patchExpense(e.id, { retained: Number(ev.target.value) || 0 })} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs font-bold">
            <span className="text-muted">إجمالي المصروف</span>
            <span className="num" style={{ color: bud.remaining < 0 ? "#C00000" : TEXT }}>{fmt(bud.spent)} ج.م</span>
          </div>
          {pva.unassigned > 0 && (
            <div className="mt-1 text-[10px]" style={{ color: "#8A6D00" }}>
              منها {fmt(pva.unassigned)} ج.م بلا مرحلة — لا تدخل مقارنة أي مرحلة حتى تُنسب.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FinancePanel({ client, settings, priceBook, currentMember, onChange }) {
  const maySeeCost = can(currentMember, "viewCostBasis");
  const cv = contractValue(client);

  const addVariation = () => {
    const list = [...(client.variations || [])];
    onChange({ variations: [...list, newVariation(client.id, list.length + 1)] });
  };
  const patchVariation = (id, patch) => {
    onChange({ variations: (client.variations || []).map(v => v.id === id ? { ...v, ...patch } : v) });
  };
  const addReceipt = () => {
    const list = [...(client.receipts || [])];
    onChange({ receipts: [...list, newReceipt(client.id, list.length + 1)] });
  };
  const patchReceipt = (id, patch) => {
    onChange({ receipts: (client.receipts || []).map(r => r.id === id ? { ...r, ...patch } : r) });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* التحصيل بالمراحل — العمود الفقري النقدي للمشروع */}
      <PhaseCollection client={client} settings={settings} currentMember={currentMember} onChange={onChange} />

      {/* قيمة العقد */}
      <div className="sheet p-4">
        <div className="mb-3 h-section">قيمة العقد</div>
        <SummaryRow label={`الأصل — متعاقد ${client.contract.signedAt}`} value={cv.base} />
        <SummaryRow label="أوامر تغيير معتمدة" value={cv.variations} />
        <SummaryRow label="القيمة الحالية" value={cv.total} bold />
        {cv.pendingCount > 0 && (
          <div className="mt-2 text-xs" style={{ color: "#B45309" }}>
            {cv.pendingCount} أمر تغيير بانتظار موافقة العميل بقيمة {fmt(cv.pendingValue)} ج.م — غير محتسبة أعلاه
          </div>
        )}
      </div>

      {/* أوامر التغيير */}
      <div className="sheet p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="h-section">أوامر التغيير</span>
          <button onClick={addVariation} className="btn btn-gold"><Plus size={14} /> أمر جديد</button>
        </div>
        {(client.variations || []).length === 0 ? (
          <div className="py-4 text-center text-xs text-muted">
            لا توجد أوامر تغيير. سجّل هنا أي طلب من العميل بعد التعاقد ليُوثَّق بقيمته وتاريخه.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(client.variations || []).map(v => (
              <div key={v.id} className="flex flex-wrap items-center gap-2 border-b pb-2" style={{ borderColor: "var(--color-line)" }}>
                <input className="inp flex-1" style={{ minWidth: 140 }} placeholder="وصف التغيير"
                  value={v.title || ""} onChange={e => patchVariation(v.id, { title: e.target.value })} />
                <input className="inp num" style={{ width: 110 }} type="number" inputMode="decimal" placeholder="القيمة"
                  value={v.lines?.[0]?.price ?? ""} disabled={!maySeeCost}
                  onChange={e => patchVariation(v.id, { lines: [{ name: v.title || "تغيير", qty: 1, price: Number(e.target.value) || 0 }] })} />
                <select className="inp" style={{ width: 150 }} value={v.status}
                  onChange={e => patchVariation(v.id, { status: e.target.value })}>
                  {Object.entries(VARIATION_STATUS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <span className="num text-xs font-bold text-navy" style={{ width: 90 }}>{fmt(variationTotal(v))} ج.م</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* سجل الدفعات — كل دفعة منسوبة لمرحلة ونوع، وإلا لم تُحتسب في جدول التحصيل */}
      <div className="sheet p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="h-section">سجل الدفعات</span>
          <button onClick={addReceipt} className="btn btn-primary"><Plus size={14} /> دفعة</button>
        </div>
        {(client.receipts || []).length === 0 ? (
          <div className="py-4 text-center text-xs text-muted">
            لا توجد دفعات مسجّلة. سجّلها من جدول التحصيل أعلاه ليُنسب كل مبلغ لمرحلته تلقائيًا.
          </div>
        ) : (
          <>
            <div className="mb-2 text-[11px] text-muted">
              دفعة بلا مرحلة تُحسب في الإجمالي لكنها لا تفتح البدء في أي مرحلة — انسبها هنا.
            </div>
            <div className="flex flex-col gap-2">
              {(client.receipts || []).map(r => (
                <div key={r.id} className="flex flex-wrap items-center gap-2">
                  <input className="inp" style={{ width: 130 }} type="date"
                    value={r.date || ""} onChange={e => patchReceipt(r.id, { date: e.target.value })} />
                  <select className="inp" style={{ width: 150 }}
                    value={r.phase || ""}
                    onChange={e => patchReceipt(r.id, { phase: e.target.value })}>
                    <option value="">— بلا مرحلة —</option>
                    {PHASES.map(p => <option key={p} value={p}>{PHASE_SHORT[p]}</option>)}
                  </select>
                  <select className="inp" style={{ width: 110 }}
                    value={r.kind === "profit" ? "profit" : "base"}
                    onChange={e => patchReceipt(r.id, { kind: e.target.value })}>
                    <option value="base">قيمة المرحلة</option>
                    <option value="profit">نسبة الربح</option>
                  </select>
                  <input className="inp num" style={{ width: 110 }} type="number" inputMode="decimal" placeholder="المبلغ"
                    value={r.amount || ""} onChange={e => patchReceipt(r.id, { amount: Number(e.target.value) || 0 })} />
                  <input className="inp flex-1" style={{ minWidth: 110 }} placeholder="ملاحظة"
                    value={r.note || ""} onChange={e => patchReceipt(r.id, { note: e.target.value })} />
                  <button onClick={() => onChange({ receipts: (client.receipts || []).filter(x => x.id !== r.id) })}
                          className="text-xs" style={{ color: "#C00000" }}>✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* المقاولون ومصروفات الموقع — للمالك والمدير فقط */}
      {maySeeCost && <ContractorLedger client={client} onChange={onChange} />}
      {maySeeCost && (
        <PhaseSpend client={client} settings={settings} priceBook={priceBook} onChange={onChange} />
      )}
    </div>
  );
}

function ClientDetail({ client, settings, priceBook, allClients, saving, team, currentMember, onBack, onChange, onDelete }) {
  const calc = useMemo(() => effectiveTotals(client, settings), [client, settings]);
  const margin = useMemo(() => {
    if (!can(currentMember, "viewCostBasis")) return null;
    const list = catalogueWithCustom(priceBook);
    const rows = list.map(it => resolveItem(client, it, Number(client.area) || 0));
    return projectMargin(priceBook, rows, Object.fromEntries(list.map(i => [i[5], i])));
  }, [client, priceBook, currentMember]);
  const [innerTab, setInnerTab] = useState("pricing"); // pricing | site

  /* ورقة المصروفات تُدرج فقط لمن يرى أساس التكلفة — المهندس يصدّر المقايسة
     والتحصيل، ولا يصدّر ما دفعه المكتب لمورديه. */
  const exportExcel = () => exportFullBOQ(client, settings, { includeCost: can(currentMember, "viewCostBasis"), priceBook });

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
            onClick={() => generateContractDocx(client, calc, settings).then(d => downloadDocx(`عقد_${client.name || "عميل"}.docx`, d))}
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
          <div className="sheet p-4">
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
            <Field label="المساحة (م²)"><input type="number" inputMode="decimal" className="inp" value={client.area} onChange={e => onChange({ area: e.target.value })} /></Field>
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
          <ProjectSpine client={client} />
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
            {client.contract && (
              <button
                onClick={() => setInnerTab("finance")}
                className="flex-1 rounded-md py-2 text-sm font-bold transition-colors"
                style={{ backgroundColor: innerTab === "finance" ? NAVY : "transparent", color: innerTab === "finance" ? "#FFFFFF" : TEXT }}
              >
                المالية
              </button>
            )}
          </div>

          {innerTab === "finance" && client.contract && (
            <FinancePanel
              client={client}
              settings={settings}
              priceBook={priceBook}
              currentMember={currentMember}
              onChange={onChange}
            />
          )}

          {innerTab === "pricing" && (
            <>
          <div className="sheet p-4">
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

          <PhaseBOQ client={client} settings={settings} currentMember={currentMember} onChange={onChange} />
          <CostAnalysis client={client} priceBook={priceBook} currentMember={currentMember} />

          <PriceAnomalies client={client} allClients={allClients} priceBook={priceBook} currentMember={currentMember} />
          <RoomSchedule client={client} onChange={onChange} />
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
            <div className="mt-3 flex items-center justify-between px-3 py-2.5 bg-gold" style={{ borderRadius: 2 }}>
              <span className="text-sm font-bold" style={{ color: "#1F1F1F" }}>الإجمالي النهائي المستحق</span>
              <span className="num text-lg font-bold" style={{ color: "#1F1F1F" }}>{fmt(calc.grandTotal)} ج.م</span>
            </div>

            {/* الهامش — الرقم الذي لم يكن النظام يعرفه إطلاقًا.
                يُعرض فقط لمن يملك صلاحية رؤية التكلفة: المهندس المنفّذ لا يراه. */}
            {can(currentMember, "viewCostBasis") && margin && (
              <div className="sheet mt-3 p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="lbl">هامش الربح المتوقع</span>
                  {margin.ratio == null ? (
                    <span className="text-sm font-semibold text-muted">غير معروف</span>
                  ) : (
                    <span
                      className="num text-lg font-semibold"
                      style={{ color: marginHealth(margin.ratio, priceBook.minMargin) === "ok" ? "#1E7B45"
                             : marginHealth(margin.ratio, priceBook.minMargin) === "thin" ? "#B45309" : "#C00000" }}
                    >
                      {(margin.ratio * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                {margin.ratio != null && (
                  <div className="mb-2 flex justify-between text-xs text-muted">
                    <span>تكلفة <b className="num">{fmt(margin.cost)}</b></span>
                    <span>ربح <b className="num">{fmt(margin.profit)}</b></span>
                  </div>
                )}
                {/* الصدق هنا أهم من الرقم: نقول بوضوح كم من المشروع نعرف تكلفته */}
                {!margin.complete && (
                  <div className="text-[10px]" style={{ color: "#8A6D00" }}>
                    {margin.coverage === 0
                      ? `لا توجد تكاليف مُدخلة — ${margin.unknownItems.length} بندًا. أدخلها من دفتر الأسعار.`
                      : `الهامش يخص ${(margin.coverage * 100).toFixed(0)}% من قيمة المشروع فقط — ${margin.unknownItems.length} بندًا بلا تكلفة.`}
                  </div>
                )}
                {margin.weakItems.length > 0 && (
                  <div className="mt-2 border-t pt-2 text-[10px]" style={{ borderColor: "var(--color-line)", color: "#C00000" }}>
                    بنود تحت الحد الأدنى للهامش: {margin.weakItems.slice(0, 3).map(w => w.name).join(" · ")}
                  </div>
                )}
              </div>
            )}
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
                  className="grid grid-cols-12 items-center gap-2 px-2 py-2"
                  style={{ backgroundColor: isCustom ? "#FFFBEB" : (i % 2 ? "#FFFFFF" : LIGHT) }}
                >
                  <div className="col-span-12 flex items-center gap-2 sm:col-span-3">
                    <input
                      type="checkbox"
                      checked={r.included}
                      onChange={e => patchItem(r.id, "included", e.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold leading-4">{name}</span>
                      <span className="code mt-0.5 inline-block">{r.id}</span>
                    </span>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <input
                      type="number" inputMode="decimal"
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
                      type="number" inputMode="decimal"
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

/* ═══════════ صور الزيارة ═══════════
   الروابط موقّتة لأن مساحة التخزين خاصة — صور مواقع العملاء ليست محتوى عامًا.
   الضغط يحدث في المتصفح قبل الرفع (انظر data/photos.js). */
function VisitPhotos({ clientId, visit }) {
  const [items, setItems] = useState([]);
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const available = photosAvailable();

  const refresh = useCallback(async () => {
    if (!available) return;
    const list = await listPhotos(clientId, visit.id);
    setItems(list);
    if (list.length) setUrls(await signedUrls(list.map(i => i.path)));
  }, [clientId, visit.id, available]);

  useEffect(() => { refresh(); }, [refresh]);

  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true); setErr("");
    let saved = 0;
    for (const f of files) {
      try { await uploadPhoto(clientId, visit.id, f); saved++; }
      catch (ex) { setErr(ex.message); }
    }
    setBusy(false);
    if (saved) await refresh();
  };

  const remove = async (path) => {
    if (await deletePhoto(path)) refresh();
  };

  if (!available) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn" style={{ border: "1px solid var(--color-line)", color: NAVY, cursor: "pointer" }}>
          <UploadCloud size={14} /> {busy ? "جاري الرفع…" : "إضافة صور"}
          <input type="file" accept="image/*" multiple className="hidden" onChange={onPick} disabled={busy} />
        </label>
        {items.length > 0 && <span className="text-[10px] text-muted">{items.length} صورة</span>}
      </div>
      {err && <div className="mt-1 text-[10px]" style={{ color: "#C00000" }}>{err}</div>}
      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map(it => (
            <div key={it.path} className="relative" style={{ width: 84, height: 84 }}>
              {urls[it.path] ? (
                <a href={urls[it.path]} target="_blank" rel="noreferrer">
                  <img src={urls[it.path]} alt="صورة موقع" style={{ width: 84, height: 84, objectFit: "cover", border: "1px solid var(--color-line)", borderRadius: 2 }} />
                </a>
              ) : (
                <div className="bg-light" style={{ width: 84, height: 84, borderRadius: 2 }} />
              )}
              <button
                onClick={() => remove(it.path)}
                className="absolute text-white"
                style={{ top: 2, left: 2, background: "rgba(0,0,0,.55)", borderRadius: 2, padding: "1px 3px" }}
                aria-label="حذف الصورة"
              >
                <X size={11} />
              </button>
            </div>
          ))}
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
            <Field label="مجلد صور خارجي (اختياري — الرفع المباشر متاح بعد الحفظ)">
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
                    <ExternalLink size={12} /> مجلد خارجي
                  </a>
                )}
                <VisitPhotos clientId={client.id} visit={v} />
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
        <div className="mb-6 text-center text-xs text-muted">مكتب الاستشارات المعمارية</div>

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
  const [joinMode, setJoinMode] = useState("join"); // join = بكود دعوة | create = مكتب جديد
  const [inviteCode, setInviteCode] = useState("");
  const [officeName, setOfficeName] = useState("");

  const handleSignIn = async () => {
    setError(""); setBusy(true);
    try {
      const sb = getSupabase();
      const { error: err } = await withTimeout(sb.auth.signInWithPassword({ email: email.trim(), password }), 10000);
      if (err) { setError("تعذّر تسجيل الدخول — " + authErrorText(err)); setBusy(false); return; }
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
        sb.auth.signUp({
          email: email.trim(),
          password,
          options: { data: {
            name: name.trim(),
            invite_code: joinMode === "join" ? inviteCode.trim().toUpperCase() : "",
            office_name: joinMode === "create" ? officeName.trim() : "",
          } },
        }),
        10000
      );
      if (err) { setError("تعذّر إنشاء الحساب — " + authErrorText(err)); setBusy(false); return; }
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
        <div className="mb-6 text-center text-xs text-muted">مكتب الاستشارات المعمارية</div>

        {pendingConfirm ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
                 style={{ backgroundColor: "#ECFDF5" }}>
              <Mail size={26} style={{ color: "#047857" }} />
            </div>
            <div className="mb-2 text-base font-bold text-navy">تفقّد بريدك الإلكتروني</div>
            <p className="mb-4 text-sm leading-6 text-muted">
              أرسلنا رابط تأكيد إلى <span className="font-bold" style={{ color: TEXT }}>{email}</span>.
              اضغط الرابط لتفعيل حسابك، ثم عد إلى هنا لتسجيل الدخول.
            </p>
            <div className="rounded-lg p-3 text-right text-xs leading-6" style={{ backgroundColor: "#F8FAFC", color: MUTED }}>
              <div className="mb-1 font-bold" style={{ color: TEXT }}>لم تجد الرسالة؟</div>
              • تحقّق من مجلد البريد المزعج (Spam)<br />
              • قد تستغرق دقيقة أو دقيقتين<br />
              • تأكّد من صحة البريد الذي كتبته
            </div>
            <button
              onClick={() => { setPendingConfirm(false); setMode("signin"); }}
              className="mt-4 w-full rounded-lg py-2.5 text-sm font-bold"
              style={{ border: `1px solid ${BORDER}`, color: TEXT }}>
              أكّدت بريدي — سجّل الدخول
            </button>
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

                <div className="mb-3 flex gap-1 rounded-lg p-1" style={{ backgroundColor: "#F1F5F9" }}>
                  <button onClick={() => setJoinMode("join")} className="flex-1 rounded-md py-1.5 text-xs font-bold"
                    style={{ backgroundColor: joinMode === "join" ? "#FFFFFF" : "transparent", color: TEXT }}>
                    انضمام لمكتب
                  </button>
                  <button onClick={() => setJoinMode("create")} className="flex-1 rounded-md py-1.5 text-xs font-bold"
                    style={{ backgroundColor: joinMode === "create" ? "#FFFFFF" : "transparent", color: TEXT }}>
                    مكتب جديد
                  </button>
                </div>

                {joinMode === "join" ? (
                  <>
                    <input className="inp tracking-widest" placeholder="كود الدعوة" value={inviteCode}
                      onChange={e => setInviteCode(e.target.value.toUpperCase())} />
                    <div className="mb-3 flex items-start gap-1.5 text-xs leading-5 text-muted">
                      <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                      اطلب الكود من مالك مكتبك. بعد التسجيل يظل حسابك بانتظار موافقته.
                    </div>
                  </>
                ) : (
                  <>
                    <input className="inp" placeholder="اسم المكتب" value={officeName}
                      onChange={e => setOfficeName(e.target.value)} />
                    <div className="mb-3 flex items-start gap-1.5 text-xs leading-5 text-muted">
                      <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                      ستكون مالك هذا المكتب، وتبدأ بتجربة مجانية ١٤ يومًا. بياناتك معزولة تمامًا عن أي مكتب آخر.
                    </div>
                  </>
                )}
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
function SettingsPanel({ settings, onSave, onExportBackup, onImportBackup, clientCount, team, currentMember, onAddMember, onRemoveMember, cloud, pendingMembers, onApproveMember, license }) {
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

      <div className="sheet p-4">
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

      <TeamInvite license={license} />

      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 h-section">هوية المكتب</div>
        {!(local.officeName || "").trim() && (
          <div className="mb-3 flex items-start gap-2 rounded-lg p-3 text-xs leading-5" style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>أدخل اسم مكتبك قبل تصدير أي عقد أو عرض للعميل — بدونه سيظهر اسم عام في المستندات.</span>
          </div>
        )}
        <Field label="اسم المكتب">
          <input
            className="inp"
            placeholder="مثال: النخبة"
            value={local.officeName || ""}
            onChange={e => setLocal({ ...local, officeName: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") onSave(local); }}
          />
        </Field>
        <Field label="هاتف المكتب">
          <input
            className="inp"
            placeholder="01xxxxxxxxx"
            inputMode="tel"
            value={local.officePhone || ""}
            onChange={e => setLocal({ ...local, officePhone: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") onSave(local); }}
          />
        </Field>
        <Field label="عنوان المكتب">
          <input
            className="inp"
            value={local.officeAddress || ""}
            onChange={e => setLocal({ ...local, officeAddress: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") onSave(local); }}
          />
        </Field>

        <div className="mb-3 mt-5 h-section">النسب المالية</div>
        <Field label="نسبة أتعاب الإشراف الهندسي %">
          <input type="number" inputMode="decimal" step="0.1" className="inp" value={(local.supervisionPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, supervisionPct: Number(e.target.value) / 100 })} />
        </Field>
        <Field label="نسبة احتياطي الأعمال غير المنظورة %">
          <input type="number" inputMode="decimal" step="0.1" className="inp" value={(local.contingencyPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, contingencyPct: Number(e.target.value) / 100 })} />
        </Field>
        <Field label="نسبة ضريبة القيمة المضافة %">
          <input type="number" inputMode="decimal" step="0.1" className="inp" value={(local.vatPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, vatPct: Number(e.target.value) / 100 })} />
        </Field>
        <Field label="نسبة الربح المتفق عليها مع العميل % — تُحصَّل بعد تسليم كل مرحلة">
          <input type="number" inputMode="decimal" step="0.5" min="0" className="inp"
            value={((local.agreedProfitPct || 0) * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, agreedProfitPct: Number(e.target.value) / 100 })}
            onKeyDown={e => { if (e.key === "Enter") onSave(local); }} />
        </Field>
        {!(local.agreedProfitPct > 0) && (
          <div className="-mt-2 mb-3 text-[11px] leading-5" style={{ color: "#8A6D00" }}>
            بصفر، جدول التحصيل هيعرض قيمة المراحل بدون أي ربح للمكتب. ده رقمك أنت — النظام
            لا يخترعه، لأن عقدًا مبنيًا على نسبة لم يتفق عليها أحد أسوأ من عقد بلا نسبة.
            يمكن تجاوز هذه النسبة لكل عميل على حدة من صفحة المقايسة.
          </div>
        )}
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


/* ============================= دفتر الأسعار =============================
   أثمن ما يملكه المكتب: خلاصة تكاليف كل مشروع نفّذه. كان مدفونًا في الكود
   ولا يُعدَّل إلا بمبرمج — الآن يملكه المكتب ويحدّثه بنفسه. */
function PriceBookPanel({ book, onSave, currentMember, clients }) {
  const [q, setQ] = useState("");
  const mayEdit = can(currentMember, "editUnitPrice");
  const list = useMemo(() => catalogueWithCustom(book), [book]);
  const stale = useMemo(() => new Set(staleItems(book).map(x => x.id)), [book]);
  // ما تتجاوز سعره يدويًا في كل مرة — علامة أن الكتالوج نفسه متأخر عن السوق
  const drift = useMemo(
    () => catalogueDriftReport(clients || [], catalogueWithCustom(book), book, 1),
    [clients, book]
  );

  const visible = list.filter(it =>
    !q.trim() || it[1].includes(q.trim()) || it[5].toLowerCase().includes(q.trim().toLowerCase()));

  const setCost = (id, levelIdx, value) => {
    const entry = (book.items || {})[id] || {};
    const cost = [...(entry.cost || [0, 0, 0, 0])];
    cost[levelIdx] = Number(value) || 0;
    onSave(updateBookItem(book, id, { cost }));
  };

  /* تحليل سعر البند: أي بند مفتوح الآن وعند أي مستوى */
  const [openAnalysis, setOpenAnalysis] = useState(null);   // { id, levelIdx }
  const patchAnalysis = (id, levelIdx, kind, value) =>
    onSave(setItemAnalysis(book, id, levelIdx, { [kind]: Number(value) || 0 }));

  if (!mayEdit) {
    return <div className="sheet p-6 text-center text-sm text-muted">
      دفتر الأسعار متاح لمدير المشاريع أو مالك المكتب فقط.
    </div>;
  }

  return (
    <div className="sheet p-4">
      <div className="mb-1 h-section">دفتر أسعار المكتب</div>
      <p className="mb-3 text-xs text-muted">
        أدخل تكلفة الوحدة لكل مستوى. بدونها يقدّر النظام التكلفة، ويظل رقم الهامش غير موثوق.
        البند الذي لم يُحدَّث منذ 6 أشهر معلَّم — أسعار السوق تتحرك بسرعة.
      </p>

      <input className="inp mb-3" placeholder="بحث بالاسم أو الكود…" value={q} onChange={e => setQ(e.target.value)} />

      <div className="overflow-x-auto">
      {drift.length > 0 && (
        <div className="sheet mb-3 p-3" style={{ borderColor: "#BF9000" }}>
          <div className="mb-2 text-xs font-bold" style={{ color: "#8A6D00" }}>
            بنود تسعّرها فعليًا بغير سعر الكتالوج
          </div>
          {drift.slice(0, 6).map(d => (
            <div key={d.id} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
              <span className="code">{d.id}</span>
              <span className="font-semibold text-ink">{d.name}</span>
              <span className="num text-muted">
                الكتالوج <b>{fmt(d.catalogue)}</b> · المعتاد لديك <b style={{ color: "#1E7B45" }}>{fmt(d.suggested)}</b>
                {" "}({d.drift > 0 ? "+" : ""}{(d.drift * 100).toFixed(0)}% من {d.samples} مشاريع)
              </span>
            </div>
          ))}
          <div className="mt-1.5 text-[10px] text-muted">
            مستنتَج من مشاريعك أنت — لا من أي مصدر خارجي. حدّث الكتالوج ليوفّر عليك التجاوز اليدوي كل مرة.
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--color-line)" }}>
              <th className="p-2 text-right lbl">البند</th>
              {LEVELS.map(lv => <th key={lv} className="p-2 text-center lbl">{lv}</th>)}
              <th className="p-2 text-center lbl">الهامش</th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, 60).map(it => {
              const [, name, unit, , prices, id] = it;
              const entry = (book.items || {})[id] || {};
              const m = itemMargin(book, it, 1, prices[1]);
              return [
                <tr key={id} className="border-b" style={{ borderColor: "var(--color-line)" }}>
                  <td className="p-2">
                    <span className="block font-semibold leading-4">{name}</span>
                    <span className="code mt-0.5 inline-block">{id}</span>
                    {stale.has(id) && <span className="mr-1 text-[9px]" style={{ color: "#B45309" }}>غير محدَّث</span>}
                  </td>
                  {LEVELS.map((lv, i) => (
                    <td key={lv} className="p-1 text-center">
                      <div className="num text-[10px] text-muted">بيع {prices[i]}</div>
                      <input
                        type="number" inputMode="decimal"
                        className="num w-16 rounded px-1 py-0.5 text-center text-[11px]"
                        style={{ border: "1px solid var(--color-line)" }}
                        placeholder="تكلفة"
                        value={entry.cost?.[i] || ""}
                        onChange={e => setCost(id, i, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="p-2 text-center">
                    {m.known ? (
                      <span
                        className="num font-bold"
                        style={{ color: marginHealth(m.ratio, book.minMargin) === "ok" ? "#1E7B45"
                               : marginHealth(m.ratio, book.minMargin) === "thin" ? "#B45309" : "#C00000" }}
                      >
                        {(m.ratio * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted">—</span>
                    )}
                  </td>
                </tr>,
                /* ═══ تحليل سعر البند: من أين تتكوّن التكلفة فعلًا ═══ */
                <tr key={id + "-an"} className="border-b" style={{ borderColor: "var(--color-line)" }}>
                  <td colSpan={LEVELS.length + 2} className="px-2 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setOpenAnalysis(
                          openAnalysis?.id === id ? null : { id, levelIdx: openAnalysis?.levelIdx ?? 1 })}
                        className="rounded px-2 py-0.5 text-[10px] font-bold"
                        style={{ border: `1px solid ${BORDER}`, color: NAVY }}
                      >
                        {openAnalysis?.id === id ? "إخفاء التحليل" : "تحليل السعر"}
                      </button>
                      {LEVELS.map((lv, i) => itemAnalysis(book, id, i) && (
                        <span key={lv} className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                              style={{ backgroundColor: "#E2EFDA", color: "#1E7B45" }}>
                          {lv} محلَّل
                        </span>
                      ))}
                    </div>

                    {openAnalysis?.id === id && (
                      <div className="mt-2 rounded-lg p-2.5" style={{ backgroundColor: LIGHT, border: `1px solid ${BORDER}` }}>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="lbl">تحليل تكلفة {unit} واحد عند مستوى:</span>
                          {LEVELS.map((lv, i) => (
                            <button key={lv} onClick={() => setOpenAnalysis({ id, levelIdx: i })}
                              className="rounded px-2 py-0.5 text-[10px] font-bold"
                              style={{
                                backgroundColor: openAnalysis.levelIdx === i ? LEVEL_COLORS[lv] : "#FFFFFF",
                                color: openAnalysis.levelIdx === i ? "#FFFFFF" : TEXT,
                                border: `1px solid ${openAnalysis.levelIdx === i ? LEVEL_COLORS[lv] : BORDER}`,
                              }}>{lv}</button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {COST_KINDS.map(k => {
                            const cur = itemAnalysis(book, id, openAnalysis.levelIdx) || {};
                            return (
                              <div key={k} style={{ minWidth: 96 }}>
                                <div className="text-[9px] font-bold" style={{ color: KIND_COLOR[k] }}>{KIND_SHORT[k]}</div>
                                <input type="number" inputMode="decimal" placeholder="0"
                                  className="num w-full rounded px-1 py-0.5 text-center text-[11px]"
                                  style={{ border: `1px solid ${BORDER}` }}
                                  value={cur[k] || ""}
                                  onChange={e => patchAnalysis(id, openAnalysis.levelIdx, k, e.target.value)} />
                              </div>
                            );
                          })}
                          <div style={{ minWidth: 110 }}>
                            <div className="text-[9px] font-bold text-muted">إجمالي التكلفة</div>
                            <div className="num rounded px-1 py-0.5 text-center text-[11px] font-bold"
                                 style={{ border: `1px solid ${BORDER}`, backgroundColor: "#FFFFFF" }}>
                              {fmt(analysisTotal(itemAnalysis(book, id, openAnalysis.levelIdx) || {}))}
                            </div>
                          </div>
                          <div style={{ minWidth: 90 }}>
                            <div className="text-[9px] font-bold text-muted">سعر البيع</div>
                            <div className="num rounded px-1 py-0.5 text-center text-[11px] font-bold"
                                 style={{ border: `1px solid ${BORDER}`, backgroundColor: "#FFFFFF", color: NAVY }}>
                              {fmt(prices[openAnalysis.levelIdx])}
                            </div>
                          </div>
                        </div>
                        {(() => {
                          const an = itemAnalysis(book, id, openAnalysis.levelIdx);
                          if (!an) return (
                            <div className="mt-2 text-[10px] text-muted">
                              أدخل ما تدفعه فعليًا لكل فئة عن {unit} واحد. المجموع يصبح تكلفة البند،
                              ويُقارَن لاحقًا بمصروفات الموقع بنفس التصنيف.
                            </div>
                          );
                          const shares = analysisShares(an);
                          const total = analysisTotal(an);
                          const sell = prices[openAnalysis.levelIdx];
                          return (
                            <>
                              <div className="mt-2 flex h-2 w-full overflow-hidden rounded" style={{ backgroundColor: "#E3E7EE" }}>
                                {COST_KINDS.filter(k => (an[k] || 0) > 0).map(k => (
                                  <div key={k} title={KIND_LABEL[k]}
                                       style={{ width: `${shares[k] * 100}%`, backgroundColor: KIND_COLOR[k] }} />
                                ))}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 text-[10px]">
                                {COST_KINDS.filter(k => (an[k] || 0) > 0).map(k => (
                                  <span key={k} style={{ color: KIND_COLOR[k] }}>
                                    {KIND_SHORT[k]} {(shares[k] * 100).toFixed(0)}%
                                  </span>
                                ))}
                                <span className="font-bold" style={{ color: sell > total ? "#1E7B45" : "#C00000" }}>
                                  الهامش {sell > 0 ? (((sell - total) / sell) * 100).toFixed(0) : 0}%
                                  {" "}({fmt(sell - total)} ج.م لكل {unit})
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
        </div>
      </div>
      {visible.length > 60 && (
        <div className="mt-2 text-center text-xs text-muted">يُعرض 60 من {visible.length} — استخدم البحث</div>
      )}
    </div>
  );
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
