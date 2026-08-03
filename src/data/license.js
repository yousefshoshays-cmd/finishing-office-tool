import { getSupabase } from "./storage.js";

/* حالة الترخيص كما تراها الواجهة.
   ملاحظة مهمة: هذا للعرض فقط. المنع الحقيقي يحدث في قاعدة البيانات
   عبر org_can_write() في السياسات — الواجهة تخفي الأزرار، لكن حتى لو
   تحايل أحدهم عليها فلن تقبل قاعدة البيانات الكتابة. */

export const LICENSE_UNKNOWN = {
  loaded: false,
  orgId: null,
  orgName: "",
  status: "trial",
  canWrite: true,
  daysLeft: null,
  inviteCode: null,
  seats: 0,
  membersCount: 0,
};

export async function fetchLicense() {
  const sb = getSupabase();
  if (!sb) {
    // الوضع المحلي (بدون سحابة): لا ترخيص ولا قيود
    return { ...LICENSE_UNKNOWN, loaded: true, status: "local" };
  }
  const { data, error } = await sb.rpc("my_license");
  if (error || !data || !data.length) {
    // لا نغلق الأداة عند فشل القراءة — الأمان محفوظ في قاعدة البيانات
    console.warn("[license] تعذّر قراءة الترخيص:", error?.message);
    return { ...LICENSE_UNKNOWN, loaded: true };
  }
  const r = data[0];
  return {
    loaded: true,
    orgId: r.org_id,
    orgName: r.org_name || "",
    status: r.status,
    canWrite: !!r.can_write,
    daysLeft: r.days_left,
    inviteCode: r.invite_code,
    seats: r.seats,
    membersCount: r.members_count,
  };
}

/** نص التنبيه المعروض للمستخدم، أو null إن كان كل شيء سليمًا. */
export function licenseNotice(lic) {
  if (!lic?.loaded || lic.status === "local") return null;

  if (lic.status === "suspended") {
    return { tone: "error", text: "تم إيقاف اشتراك المكتب. بياناتك محفوظة ويمكنك تصديرها. تواصل معنا لإعادة التفعيل." };
  }
  if (!lic.canWrite) {
    return { tone: "error", text: "انتهت مدة الاشتراك — الأداة الآن للقراءة والتصدير فقط. بياناتك كاملة ولم يُحذف منها شيء." };
  }
  if (lic.status === "trial") {
    const d = lic.daysLeft ?? 0;
    if (d <= 3) return { tone: "error", text: `تبقّى ${d} ${d === 1 ? "يوم" : "أيام"} على انتهاء التجربة.` };
    if (d <= 7) return { tone: "warn", text: `التجربة المجانية: باقٍ ${d} أيام.` };
    return { tone: "info", text: `تجربة مجانية — باقٍ ${d} يومًا.` };
  }
  if (lic.status === "active" && (lic.daysLeft ?? 99) <= 7) {
    return { tone: "warn", text: `يتجدّد الاشتراك خلال ${lic.daysLeft} أيام.` };
  }
  return null;
}
