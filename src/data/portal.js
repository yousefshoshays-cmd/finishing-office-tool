import { createClient } from "@supabase/supabase-js";
import {
  getSupabase, getCloudConfig, withTimeout,
  DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY,
} from "./storage.js";

/* ════════════════════════════════════════════════════════════════════════
   بوابة العميل والمقاول
   ------------------------------------------------------------------------
   الفكرة: لا يسجّل العميل ولا المقاول نفسه أبدًا. المكتب يضغط زرًا،
   فيولّد الخادم اسم مستخدم وكلمة سر، ويسلّمهما المكتب بيده.

   كلمة السر لا تُخزَّن — يُخزَّن تجزيؤها فقط. لذلك تظهر مرة واحدة عند
   الإصدار، وبعدها لا سبيل لقراءتها، وإنما إعادة توليدها. هذا مقصود:
   كلمة سر يمكن استرجاعها ليست سرًا.

   الدخول يمرّ بدالة واحدة في قاعدة البيانات تُرجِع بيانات صاحب الحساب
   وحده. لا جلسة، ولا صلاحية على أي جدول — فلا يوجد ما يُوسَّع نطاقه
   من المتصفح مهما جرى العبث به.
   ══════════════════════════════════════════════════════════════════════ */

/*  زائر البوابة قد يفتح الرابط من جهاز لم يُضبط عليه المكتب قط،
    فلا توجد إعدادات في متصفحه — نرجع للإعدادات الافتراضية.  */
let _anon = null;
export function portalClient() {
  const existing = getSupabase();
  if (existing) return existing;
  const cfg = getCloudConfig() || {};
  const url = cfg.url || DEFAULT_SUPABASE_URL;
  const key = cfg.anonKey || DEFAULT_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_anon) _anon = createClient(url, key);
  return _anon;
}

function rpcError(error) {
  const msg = String(error?.message || "");
  if (msg.includes("غير صحيحة")) return "اسم المستخدم أو كلمة السر غير صحيحة";
  if (msg.toLowerCase().includes("failed to fetch")) return "تعذّر الاتصال — تحقّق من الإنترنت";
  if (msg.includes("function") && msg.includes("does not exist")) {
    return "لم تُشغَّل هجرة البوابة بعد — شغّل 010 و011 في Supabase";
  }
  return msg || "حدث خطأ غير متوقع";
}

/* ───────── ما يستدعيه المكتب ───────── */

export async function issueClientAccount(clientId, clientName) {
  const sb = getSupabase();
  if (!sb) throw new Error("إصدار الحسابات يحتاج تفعيل المزامنة السحابية");
  const { data, error } = await withTimeout(
    sb.rpc("issue_client_account", { p_client_key: `client:${clientId}`, p_client_name: clientName || "" }), 15000);
  if (error) throw new Error(rpcError(error));
  const row = Array.isArray(data) ? data[0] : data;
  return { username: row?.out_username, password: row?.out_password };
}

export async function resetClientPassword(clientId) {
  const sb = getSupabase();
  if (!sb) throw new Error("يحتاج تفعيل المزامنة السحابية");
  const { data, error } = await withTimeout(
    sb.rpc("reset_client_password", { p_client_key: `client:${clientId}` }), 15000);
  if (error) throw new Error(rpcError(error));
  const row = Array.isArray(data) ? data[0] : data;
  return { username: row?.out_username, password: row?.out_password };
}

export async function revokeClientAccount(clientId) {
  const sb = getSupabase();
  if (!sb) throw new Error("يحتاج تفعيل المزامنة السحابية");
  const { error } = await withTimeout(
    sb.rpc("revoke_client_account", { p_client_key: `client:${clientId}` }), 15000);
  if (error) throw new Error(rpcError(error));
  return true;
}

export async function issueContractorAccount(name) {
  const sb = getSupabase();
  if (!sb) throw new Error("إصدار الحسابات يحتاج تفعيل المزامنة السحابية");
  const { data, error } = await withTimeout(
    sb.rpc("issue_contractor_account", { p_name: name }), 15000);
  if (error) throw new Error(rpcError(error));
  const row = Array.isArray(data) ? data[0] : data;
  return { username: row?.out_username, password: row?.out_password };
}

/*  الحسابات المُصدَرة — بلا كلمات سر، فهي غير موجودة أصلًا  */
export async function listPortalAccounts() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await withTimeout(sb.rpc("my_portal_accounts"), 15000);
  if (error) return [];
  return data || [];
}

/* ───────── ما يستدعيه العميل أو المقاول ───────── */

export async function portalLogin(username, password) {
  const sb = portalClient();
  if (!sb) throw new Error("تعذّر الاتصال بالخادم");
  const { data, error } = await withTimeout(
    sb.rpc("portal_login", { p_username: username, p_password: password }), 20000);
  if (error) throw new Error(rpcError(error));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("اسم المستخدم أو كلمة السر غير صحيحة");
  return {
    kind: row.out_kind || "client",
    key: row.out_key,
    name: row.out_name,
    orgName: row.out_org_name,
    payload: row.out_payload,
  };
}

/*  رابط البوابة الذي يُسلَّم لصاحب الحساب.
    نفس الموقع بمعامل واحد — لا نطاق جديد ولا استضافة إضافية. */
export function portalUrl() {
  if (typeof window === "undefined") return "";
  const { origin, pathname } = window.location;
  return `${origin}${pathname.replace(/index\.html$/, "")}?portal=1`;
}

/*  هل فُتحت الصفحة كبوابة لا كأداة مكتب؟ */
export function isPortalRoute() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("portal");
}
