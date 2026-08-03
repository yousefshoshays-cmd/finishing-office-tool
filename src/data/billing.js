import { getSupabase } from "./storage.js";

/* طبقة الاشتراكات.
   التحصيل يدوي اليوم (تحويل بنكي/محفظة) لأن بوابات الدفع المصرية تشترط
   سجلًا تجاريًا. البنية جاهزة لاستقبال بوابة لاحقًا: يكفي أن يستدعي
   الـ webhook دالة review_payment بعد تأكيد العملية. */

export const PAYMENT_METHODS = [
  { code: "instapay", label: "إنستاباي", hint: "تحويل فوري من أي بنك" },
  { code: "wallet",   label: "محفظة إلكترونية", hint: "فودافون كاش · اتصالات · أورنج" },
  { code: "bank",     label: "تحويل بنكي", hint: "قد يستغرق يوم عمل" },
];

export async function availablePlans() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("available_plans");
  if (error) throw new Error(error.message);
  return (data || []).map(p => ({
    code: p.code,
    name: p.name,
    months: p.months,
    price: Number(p.price_egp),
    seats: p.seats,
    perMonth: Math.round(Number(p.price_egp) / p.months),
  }));
}

export async function submitPayment({ plan, method, reference, note }) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("submit_payment", {
    plan,
    method,
    ref: reference || "",
    note_txt: note || "",
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function myPaymentRequests() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("my_payment_requests");
  if (error) return [];
  return data || [];
}

export async function pendingPayments() {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("admin_pending_payments");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function reviewPayment(id, approve, reason = "") {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("review_payment", {
    request_id: id,
    approve,
    reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** أفضل قيمة: أقل سعر شهري فعلي. تُستخدم لإبراز خطة واحدة. */
export function bestValuePlan(plans) {
  if (!plans.length) return null;
  return plans.reduce((a, b) => (b.perMonth < a.perMonth ? b : a)).code;
}

export function planSaving(plan, monthly) {
  if (!monthly || plan.code === monthly.code) return 0;
  const full = monthly.price * plan.months;
  return Math.max(0, Math.round(((full - plan.price) / full) * 100));
}

export const statusLabel = (s) =>
  ({ pending: "قيد المراجعة", approved: "مُعتمد", rejected: "مرفوض" }[s] || s);
