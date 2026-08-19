import React, { useEffect, useState } from "react";
import { INK, PAPER, MUTED, LINE, STONE, COPPER } from "./tokens.js";
import { Eyebrow, LangToggle } from "./editorial.jsx";
import { t, useLang, applyDocumentLang } from "./i18n.js";
import { doorUrls, rememberOffice } from "../data/entry.js";
import { localGet } from "../data/storage.js";

/* ════════════════════════════════════════════════════════════════════════
   الصفحة الافتتاحية — ثلاثة أبواب
   ------------------------------------------------------------------------
   مبنية على منطق واجهات الشركات: صورة واسعة تحمل الهوية، واسم المكتب
   بحجم يليق، وتحته أبواب مرقّمة لا أزرار مبعثرة. الصف كله قابل للضغط
   لا كلمة صغيرة فيه، ويمتلئ بالحبر عند المرور فيُعرف أنه حيّ.
   ══════════════════════════════════════════════════════════════════════ */

const DOORS = [
  {
    key: "office",
    n: "01",
    title: "فريق المكتب",
    desc: "المشاريع والمقايسات والتحصيل ودفتر المقاولين",
    hint: "بحساب البريد وكلمة السر",
  },
  {
    key: "client",
    n: "02",
    title: "العميل",
    desc: "متابعة مشروعك: المراحل والدفعات وصور التنفيذ",
    hint: "باسم مستخدم يسلّمه لك المكتب",
  },
  {
    key: "contractor",
    n: "03",
    title: "المقاول",
    desc: "حسابك الجاري في كل مشروع: المعتمد والمحتجز والمتبقي",
    hint: "باسم مستخدم يسلّمه لك المكتب",
  },
];

export default function Landing() {
  const lang = useLang();
  const [office, setOffice] = useState({ name: "", cover: "" });
  const [ready, setReady] = useState(false);
  const urls = doorUrls();

  useEffect(() => { applyDocumentLang(); }, [lang]);

  useEffect(() => {
    let alive = true;
    /* اسم المكتب وصورته يُقرآن محليًا إن وُجدا (جهاز المكتب)، ويُتخطّيان
       بهدوء عند زائر لا يملك بيانات — لا شاشة خطأ لأن اسمًا لم يوجد. */
    localGet("settings:global", null).then(s => {
      if (!alive || !s) return;
      setOffice({ name: s.officeName || "", cover: s.landingImage || "" });
    }).catch(() => {}).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  const go = (key) => {
    if (key === "office") rememberOffice();
    window.location.href = urls[key];
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: PAPER, color: INK }}>
      {/* ── الترويسة ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, padding: "18px 22px", borderBottom: `1px solid ${LINE}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }} className="truncate">
            {office.name || "مكتب الاستشارات المعمارية"}
          </div>
          <Eyebrow>{t("نظام متابعة العملاء والتسعير")}</Eyebrow>
        </div>
        <LangToggle />
      </header>

      {/* ── الواجهة: صورة عريضة أو حقل حيادي ── */}
      <div className="frame reveal" style={{ height: "min(46vh, 380px)", opacity: ready ? 1 : 0 }}>
        {office.cover
          ? <img src={office.cover} alt="" className="kenburns" />
          : <div className="plate" style={{ background: `linear-gradient(180deg, ${STONE} 0%, #F7F5F2 100%)` }} />}
        <div style={{
          position: "absolute", inset: 0,
          background: office.cover
            ? "linear-gradient(to top, rgba(10,9,8,.70) 0%, rgba(10,9,8,.15) 55%, rgba(10,9,8,0) 100%)"
            : "none",
          display: "flex", alignItems: "flex-end", padding: "0 24px 26px",
        }}>
          <div>
            <Eyebrow style={{ color: office.cover ? "#E7E2DA" : MUTED }}>
              {t("بوابة الدخول")}
            </Eyebrow>
            <h1 className="h-page" style={{ margin: "4px 0 0", color: office.cover ? "#FFFFFF" : INK }}>
              {t("اختر بابك")}
            </h1>
          </div>
        </div>
      </div>

      {/* ── الأبواب ── */}
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "34px 22px 70px" }}>
        <div style={{ borderTop: `1px solid ${INK}` }}>
          {DOORS.map((d, i) => (
            <button key={d.key} onClick={() => go(d.key)}
                    className="door reveal"
                    style={{ animationDelay: `${90 + i * 90}ms` }}>
              <span className="doornum num">{d.n}</span>
              <span className="doorbody">
                <span className="doortitle">{t(d.title)}</span>
                <span className="doordesc">{t(d.desc)}</span>
              </span>
              <span className="doorhint">{t(d.hint)}</span>
              <span className="doorarrow" aria-hidden="true">←</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 26, fontSize: 11.5, color: MUTED, lineHeight: 2 }}>
          {t("لا يُنشئ العميل ولا المقاول حسابًا بنفسه — المكتب يُصدر الحساب ويسلّمه.")}
        </div>
      </main>
    </div>
  );
}
