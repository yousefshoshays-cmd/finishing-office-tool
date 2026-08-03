import { getSupabase } from "./storage.js";

/* طبقة إدارة المنصّة.
   كل دالة هنا تنادي إجراءً في قاعدة البيانات يتحقّق من الصلاحية بنفسه.
   إخفاء التبويب في الواجهة راحةٌ للعين، لا حماية — الحماية في قاعدة البيانات. */

export async function amIPlatformAdmin() {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { data, error } = await sb.rpc("am_i_platform_admin");
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function listOrgs() {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("admin_list_orgs");
  if (error) throw new Error(error.message);
  return (data || []).map(o => ({
    id: o.id,
    name: o.name || "(بلا اسم)",
    status: o.status,
    daysLeft: o.days_left,
    seats: o.seats,
    members: o.members,
    pending: o.pending,
    inviteCode: o.invite_code,
    ownerEmail: o.owner_email || "—",
    createdAt: o.created_at,
    lastActive: o.last_active,
  }));
}

export async function summary() {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("admin_summary");
  if (error) throw new Error(error.message);
  const r = (data || [])[0] || {};
  return {
    total: r.total_orgs ?? 0,
    active: r.active_orgs ?? 0,
    trial: r.trial_orgs ?? 0,
    expiringSoon: r.expiring_soon ?? 0,
    expired: r.expired_orgs ?? 0,
  };
}

export async function setLicense(orgId, action, extraDays = 7) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("admin_set_license", {
    target_org: orgId,
    action,
    extra_days: extraDays,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function setSeats(orgId, seats) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("admin_set_seats", {
    target_org: orgId,
    new_seats: seats,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function renameOrg(orgId, name) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("admin_rename_org", {
    target_org: orgId,
    new_name: name,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** تصنيف المكتب لغرض العرض واللون. */
export function orgHealth(org) {
  if (org.status === "suspended") return { key: "suspended", label: "موقوف", tone: "danger" };
  if (org.daysLeft <= 0) return { key: "expired", label: "منتهٍ", tone: "danger" };
  if (org.daysLeft <= 3) return { key: "urgent", label: `${org.daysLeft} أيام`, tone: "danger" };
  if (org.status === "trial") return { key: "trial", label: `تجربة · ${org.daysLeft} يوم`, tone: "warn" };
  return { key: "active", label: `مشترك · ${org.daysLeft} يوم`, tone: "ok" };
}

/** هل المكتب مستخدم فعلًا؟ مكتب بلا نشاط لن يشترك مهما تابعته. */
export function activityNote(org) {
  if (!org.lastActive) return "لم يبدأ الاستخدام";
  const days = Math.floor((Date.now() - new Date(org.lastActive)) / 86400000);
  if (days === 0) return "نشط اليوم";
  if (days === 1) return "نشط أمس";
  if (days <= 7) return `آخر نشاط قبل ${days} أيام`;
  return `خامل ${days} يومًا`;
}
