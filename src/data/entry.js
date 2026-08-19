/* ════════════════════════════════════════════════════════════════════════
   أبواب الدخول — كل فئة تدخل من بابها
   ------------------------------------------------------------------------
   الشركات لا تضع كل الناس على باب واحد ثم تسألهم من أنتم. لكل فئة باب
   يعرف من يطرقه ويعرض له ما يخصّه وحده:

     فريق المكتب → الأداة كاملة، بحساب بريد وكلمة سر
     العميل      → مشروعه هو: مراحله ودفعاته وصوره
     المقاول     → حسابه الجاري عبر مشاريعه

   لماذا لا نجعل الصفحة الرئيسية أداة المكتب مباشرة كما كانت؟ لأن الرابط
   الواحد صار يُسلَّم لثلاث فئات مختلفة، ومن يفتحه أول مرة يجب أن يفهم
   في ثانية أين يذهب. ولمن يعمل يوميًا (فريق المكتب) يُحفظ اختياره فلا
   يمرّ على الصفحة الافتتاحية كل صباح.
   ══════════════════════════════════════════════════════════════════════ */

const PREF_KEY = "boq_entry_pref";

export function params() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/* أي باب طُلب؟  landing | office | client | contractor */
export function routeOf() {
  const q = params();

  if (q.has("portal")) {
    const v = (q.get("portal") || "").toLowerCase();
    if (v === "contractor" || v === "k") return "contractor";
    if (v === "client" || v === "c" || v === "1" || v === "") return "client";
    return "client";
  }
  if (q.has("preview")) return "preview";
  if (q.has("app") || q.has("office")) return "office";

  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved === "office") return "office";
  } catch { /* التخزين قد يكون معطّلًا — الصفحة الافتتاحية هي الافتراضي */ }

  return "landing";
}

/* يُستدعى حين يختار فريق المكتب بابه، فلا يُسأل مرة أخرى */
export function rememberOffice() {
  try { localStorage.setItem(PREF_KEY, "office"); } catch {}
}

export function forgetEntry() {
  try { localStorage.removeItem(PREF_KEY); } catch {}
}

/* روابط الأبواب الثلاثة — تُبنى من الرابط الحالي فلا تُكتب يدويًا */
export function doorUrls() {
  if (typeof window === "undefined") return { office: "", client: "", contractor: "" };
  const { origin, pathname } = window.location;
  const base = `${origin}${pathname.replace(/index\.html$/, "")}`;
  return {
    base,
    office: `${base}?app=1`,
    client: `${base}?portal=client`,
    contractor: `${base}?portal=contractor`,
  };
}
