import React, { useState, useEffect, useMemo } from "react";
import { Loader2, Check, AlertCircle, Copy } from "lucide-react";
import {
  availablePlans, submitPayment, myPaymentRequests,
  PAYMENT_METHODS, bestValuePlan, planSaving, statusLabel,
} from "../data/billing.js";

const NAVY = "#1F4E78";
const BORDER = "#E2E8F0";
const TEXT = "#0F172A";
const MUTED = "#64748B";
const GOLD = "#BF9000";

/* بيانات التحصيل — عدّلها مرة واحدة هنا وتظهر في كل مكان.
   وُضعت في ملف الواجهة لا في قاعدة البيانات كي تعدّلها دون SQL. */
export const PAYOUT = {
  instapayHandle: "yourname@instapay",
  walletNumber:   "01xxxxxxxxx",
  bankName:       "بنك ..........",
  bankAccount:    "0000000000000",
  bankIban:       "EG000000000000000000000000",
  whatsapp:       "201xxxxxxxxx",
};

function CopyField({ label, value }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
         style={{ backgroundColor: "#F8FAFC", border: `1px solid ${BORDER}` }}>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold" style={{ color: MUTED }}>{label}</div>
        <div className="truncate text-sm font-bold" style={{ color: TEXT }}>{value}</div>
      </div>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          } catch { /* المتصفح منع النسخ — القيمة ظاهرة للنسخ اليدوي */ }
        }}
        className="shrink-0 rounded-md px-2 py-1.5 text-[11px] font-bold"
        style={{ border: `1px solid ${BORDER}`, color: done ? "#047857" : TEXT }}>
        {done ? "✓" : <Copy size={12} />}
      </button>
    </div>
  );
}

/* ── صفحة الاشتراك ─────────────────────────────────────────────────────────
   يراها مالك المكتب. تعرض الخطط، ثم تعليمات التحويل، ثم نموذج تسجيل الطلب. */
export default function BillingPanel({ license, onToast, onError }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState(null);
  const [method, setMethod] = useState("instapay");
  const [reference, setReference] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([availablePlans(), myPaymentRequests()]);
      setPlans(p);
      setHistory(h);
      if (p.length && !chosen) setChosen(bestValuePlan(p));
    } catch (e) {
      onError?.("تعذّر تحميل الخطط: " + e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const monthly = useMemo(() => plans.find(p => p.months === 1), [plans]);
  const best = useMemo(() => bestValuePlan(plans), [plans]);
  const selected = plans.find(p => p.code === chosen);
  const openRequest = history.find(h => h.status === "pending");

  const send = async () => {
    if (!selected) return;
    setSending(true);
    try {
      const msg = await submitPayment({ plan: selected.code, method, reference });
      onToast?.(msg);
      setReference("");
      await load();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" style={{ color: MUTED }}>
        <Loader2 className="animate-spin" size={26} />
      </div>
    );
  }

  const isOwner = !!license?.inviteCode; // كود الدعوة لا يظهر إلا للمالك

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-xl font-bold" style={{ color: NAVY }}>الاشتراك</h2>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        {license?.status === "trial"
          ? `تجربتك المجانية باقٍ منها ${license.daysLeft} يومًا. اشترك قبل انتهائها لتستمر بلا انقطاع.`
          : license?.canWrite
            ? `اشتراكك سارٍ — يتبقّى ${license.daysLeft} يومًا.`
            : "انتهى اشتراكك. بياناتك كاملة ومحفوظة، وتعود فورًا بعد التفعيل."}
      </p>

      {!isOwner && (
        <div className="mt-4 flex items-start gap-2 rounded-lg p-3 text-xs leading-5"
             style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          مالك المكتب وحده يستطيع إدارة الاشتراك. تواصل معه لتجديد الاشتراك.
        </div>
      )}

      {openRequest && (
        <div className="mt-4 flex items-start gap-2 rounded-lg p-3 text-xs leading-5"
             style={{ backgroundColor: "#EFF6FF", color: "#1E40AF" }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          لديك طلب قيد المراجعة (رقم العملية: {openRequest.reference || "—"}).
          يُراجَع عادةً خلال ساعات العمل. لا حاجة لإرساله مرة أخرى.
        </div>
      )}

      {/* ── الخطط ── */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {plans.map(p => {
          const isSel = p.code === chosen;
          const save = planSaving(p, monthly);
          return (
            <button
              key={p.code}
              onClick={() => setChosen(p.code)}
              className="relative rounded-xl p-4 text-right transition-all"
              style={{
                backgroundColor: "#FFFFFF",
                border: `2px solid ${isSel ? NAVY : BORDER}`,
                boxShadow: isSel ? "0 4px 14px rgba(31,78,120,0.14)" : "none",
              }}>
              {p.code === best && (
                <span className="absolute -top-2 left-3 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: GOLD }}>
                  الأوفر
                </span>
              )}
              <div className="text-sm font-bold" style={{ color: NAVY }}>{p.name}</div>
              <div className="mt-1 text-2xl font-bold" style={{ color: TEXT }}>
                {p.price.toLocaleString("ar-EG")}
                <span className="text-xs font-semibold" style={{ color: MUTED }}> ج.م</span>
              </div>
              <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                {p.months > 1 ? `${p.perMonth.toLocaleString("ar-EG")} ج.م شهريًا` : "شهريًا"}
              </div>
              {save > 0 && (
                <div className="mt-1 text-[11px] font-bold" style={{ color: "#047857" }}>
                  توفير {save}٪
                </div>
              )}
              <div className="mt-2 flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                <Check size={12} /> حتى {p.seats} مهندسين
              </div>
            </button>
          );
        })}
      </div>

      {isOwner && !openRequest && selected && (
        <>
          {/* ── تعليمات التحويل ── */}
          <div className="mt-6 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
            <div className="mb-1 text-sm font-bold" style={{ color: NAVY }}>
              ١. حوّل {selected.price.toLocaleString("ar-EG")} ج.م
            </div>
            <p className="mb-3 text-xs" style={{ color: MUTED }}>
              اختر الوسيلة الأنسب لك، ثم احتفظ برقم العملية.
            </p>

            <div className="mb-3 flex flex-wrap gap-1 rounded-lg p-1" style={{ backgroundColor: "#F1F5F9" }}>
              {PAYMENT_METHODS.map(m => (
                <button key={m.code} onClick={() => setMethod(m.code)}
                        className="flex-1 rounded-md px-2 py-2 text-xs font-bold"
                        style={{ backgroundColor: method === m.code ? "#FFFFFF" : "transparent", color: TEXT }}>
                  {m.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {method === "instapay" && <CopyField label="عنوان إنستاباي" value={PAYOUT.instapayHandle} />}
              {method === "wallet"   && <CopyField label="رقم المحفظة" value={PAYOUT.walletNumber} />}
              {method === "bank" && (
                <>
                  <CopyField label="البنك" value={PAYOUT.bankName} />
                  <CopyField label="رقم الحساب" value={PAYOUT.bankAccount} />
                  <CopyField label="IBAN" value={PAYOUT.bankIban} />
                </>
              )}
            </div>
            <div className="mt-2 text-[11px]" style={{ color: MUTED }}>
              {PAYMENT_METHODS.find(m => m.code === method)?.hint}
            </div>
          </div>

          {/* ── تسجيل الطلب ── */}
          <div className="mt-3 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
            <div className="mb-1 text-sm font-bold" style={{ color: NAVY }}>٢. سجّل عمليتك</div>
            <p className="mb-3 text-xs" style={{ color: MUTED }}>
              اكتب رقم العملية من إيصال التحويل. هذا ما يتيح لنا مطابقة الدفعة وتفعيل اشتراكك.
            </p>
            <input
              className="mb-3 w-full rounded-lg px-3 py-2.5 text-sm"
              style={{ border: `1px solid ${BORDER}` }}
              placeholder="رقم العملية / المرجع"
              value={reference}
              onChange={e => setReference(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && reference.trim()) send(); }}
            />
            <button
              disabled={sending || !reference.trim()}
              onClick={send}
              className="w-full rounded-lg py-3 text-sm font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: NAVY }}>
              {sending ? "جارٍ الإرسال…" : "أرسل طلب التفعيل"}
            </button>
            <p className="mt-2 text-center text-[11px]" style={{ color: MUTED }}>
              يُراجَع الطلب يدويًا خلال ساعات العمل. ستصلك رسالة عند التفعيل.
            </p>
          </div>
        </>
      )}

      {/* ── سجل الطلبات ── */}
      {history.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-xs font-bold" style={{ color: MUTED }}>سجل الطلبات</div>
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs"
                   style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
                <span style={{ color: TEXT }}>
                  {Number(h.amount_egp).toLocaleString("ar-EG")} ج.م · {h.reference || "بلا مرجع"}
                </span>
                <span className="font-bold" style={{
                  color: h.status === "approved" ? "#047857" : h.status === "rejected" ? "#B42318" : "#8A6D00",
                }}>
                  {statusLabel(h.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-[11px]" style={{ color: MUTED }}>
        للاستفسار:{" "}
        <a href={`https://wa.me/${PAYOUT.whatsapp}`} target="_blank" rel="noreferrer"
           className="font-bold" style={{ color: NAVY }}>
          تواصل عبر واتساب
        </a>
      </p>
    </div>
  );
}
