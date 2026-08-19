import React, { useState, useEffect } from "react";
import { INK, PAPER, MUTED, LINE, STONE, SAGE, COPPER, DANGER, PHASE_COLORS, STAGE_COLORS } from "./tokens.js";
import { Eyebrow, Rule, Meta, MetaGrid, SectionHead, LangToggle } from "./editorial.jsx";
import { t, useLang, applyDocumentLang, currency } from "./i18n.js";
import { portalLogin } from "../data/portal.js";
import { fmt, DEFAULT_SETTINGS } from "../domain/catalogue.js";
import { calcByPhase, migrateClient } from "../domain/pricing.js";
import { phasePaymentPlan } from "../domain/finance.js";

/* ════════════════════════════════════════════════════════════════════════
   بوابة العميل والمقاول
   ------------------------------------------------------------------------
   شاشة واحدة يفتحها صاحب الحساب برابط المكتب نفسه + ‎?portal=1‎
   لا تسجيل ذاتي، ولا استعادة كلمة سر بالبريد: المكتب يُصدر ويسلّم.

   القاعدة التي تحكم ما يُعرض هنا: كل رقم يراه العميل رقم اتفق عليه.
   لا تكلفة، ولا هامش، ولا اسم مقاول، ولا مصروف موقع. والمقاول بالمثل:
   حسابه هو وحده — لا قيمة عقد العميل ولا زملاؤه في الموقع.
   ══════════════════════════════════════════════════════════════════════ */

const card = { borderTop: `1px solid ${INK}`, paddingTop: 12, marginBottom: 22 };

/* ───────────────────────── شاشة الدخول ───────────────────────── */
function LoginScreen({ onDone, kindHint = "client" }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useLang();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { onDone(await portalLogin(u.trim(), p.trim())); }
    catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 26 }}><LangToggle /></div>

        <Eyebrow>{kindHint === "contractor" ? t("بوابة المقاول") : t("بوابة العميل")}</Eyebrow>
        <h1 className="h-page" style={{ margin: "6px 0 8px" }}>
          {kindHint === "contractor" ? t("حسابك الجاري") : t("متابعة مشروعك")}
        </h1>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 26 }}>
          {t("ادخل باسم المستخدم وكلمة السر اللذين سلّمهما لك المكتب")}
        </div>
        <Rule firm />

        <div style={{ marginTop: 22 }}>
          <Eyebrow>{t("اسم المستخدم")}</Eyebrow>
          <input className="inp" value={u} onChange={e => setU(e.target.value.toUpperCase())}
                 autoCapitalize="characters" autoCorrect="off" spellCheck="false"
                 style={{ letterSpacing: "0.12em", fontWeight: 600 }} />
        </div>
        <div style={{ marginTop: 14 }}>
          <Eyebrow>{t("كلمة السر")}</Eyebrow>
          <input className="inp" type="password" value={p} onChange={e => setP(e.target.value)}
                 autoComplete="current-password" />
        </div>

        {err && <div style={{ marginTop: 14, fontSize: 12, color: DANGER }}>{err}</div>}

        <button type="submit" className="btn btn-primary" disabled={busy || !u || !p}
                style={{ width: "100%", marginTop: 24 }}>
          {busy ? t("جاري الدخول…") : t("دخول")}
        </button>

        <div style={{ marginTop: 20, fontSize: 11.5, color: MUTED, lineHeight: 1.9 }}>
          {t("نسيت كلمة السر؟ اطلب من المكتب إصدار كلمة سر جديدة — لا يمكن استرجاع القديمة لأنها غير مخزَّنة أصلًا.")}
        </div>
      </form>
    </div>
  );
}

/* ───────────────────────── صندوق الصورة المكبّرة ───────────────────────── */
function Lightbox({ url, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <img src={url} alt="" />
    </div>
  );
}

/* ───────────────────────── شاشة العميل ─────────────────────────
   المبدأ: العميل لا يقرأ جدولًا، بل يرى مشروعه. لذلك:
     • صورة واجهة كاملة العرض بزحف بطيء تحتها اسم المشروع وحالته
     • المعرض بعدها مباشرة — لأن أول سؤال في ذهنه «وصلنا لفين؟»
     • ثم شريط المراحل، وفيه ما دُفع وما يُدفع قبل البدء وبعد التسليم
     • والأرقام كبيرة هادئة، تظهر بحركة صعود خفيفة عند فتح الصفحة
   وكل ذلك بلا لون صارخ: اللون يأتي من صور المشروع وحدها. */
export function ClientView({ session }) {
  useLang();
  const [zoom, setZoom] = useState("");
  const raw = session.payload?.client || session.payload || {};
  const client = migrateClient(raw);
  const settings = { ...DEFAULT_SETTINGS, ...(session.payload?.settings || {}) };
  const byPhase = calcByPhase(client, settings);
  const plan = phasePaymentPlan(client, settings, byPhase);

  const gallery = (client.gallery || []).filter(g => g && (g.url || g.path));
  const hero = gallery[0]?.url || client.coverUrl || "";
  /* الصورة الأولى صارت الواجهة، فلا تُكرَّر في المعرض تحتها مباشرة */
  const rest = gallery[0]?.url && gallery[0].url === hero ? gallery.slice(1) : gallery;
  const receipts = (client.receipts || []).filter(r => Number(r.amount) > 0);
  const progress = Number(client.progressPercent) || 0;

  return (
    <div>
      {/* ══ الواجهة ══ */}
      <div className="frame reveal" style={{ height: "min(58vh, 460px)", marginBottom: 30 }}>
        {hero
          ? <img src={hero} alt="" className="kenburns" />
          : <div className="plate" />}
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "flex-end",
          padding: "0 22px 24px",
          background: hero
            ? "linear-gradient(to top, rgba(10,9,8,.78) 0%, rgba(10,9,8,.18) 52%, rgba(10,9,8,0) 100%)"
            : "none",
        }}>
          <div style={{ minWidth: 0, color: hero ? "#FFFFFF" : INK }}>
            <Eyebrow style={{ color: hero ? "#E7E2DA" : MUTED }}>{session.orgName || ""}</Eyebrow>
            <h1 style={{ fontSize: "clamp(26px,4.6vw,46px)", fontWeight: 400,
                         letterSpacing: "-.02em", lineHeight: 1.25, margin: "6px 0 8px" }}>
              {client.name || t("مشروعك")}
            </h1>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14,
                          fontSize: 12.5, color: hero ? "#E7E2DA" : MUTED }}>
              <span>{t(client.stage || "")}</span>
              {client.address && <span>· {client.address}</span>}
              {client.area > 0 && <span>· {client.area} م²</span>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 22px 70px" }}>
        {/* ══ نسبة الإنجاز ══ */}
        {progress > 0 && (
          <div className="reveal" style={{ marginBottom: 30 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <Eyebrow>{t("الإنجاز")}</Eyebrow>
              <span className="num" style={{ fontSize: 22, fontWeight: 400 }}>{progress}%</span>
            </div>
            <div style={{ height: 3, backgroundColor: STONE, marginTop: 8 }}>
              <div style={{ height: 3, width: `${Math.min(100, progress)}%`, backgroundColor: INK,
                            transition: "width 1.2s cubic-bezier(.16,.84,.44,1)" }} />
            </div>
          </div>
        )}

        {/* ══ الأرقام ══ */}
        <MetaGrid cols={4} style={{ columnGap: 20, marginBottom: 34 }} items={[
          { label: "قيمة العقد", value: `${fmt(plan.contractTotal)} ${currency()}` },
          { label: "المحصّل", value: `${fmt(plan.collected)} ${currency()}`, color: SAGE },
          { label: "المتبقي", value: `${fmt(Math.max(0, plan.contractTotal - plan.collected))} ${currency()}` },
          { label: "المستحق الآن", value: `${fmt(plan.dueNow)} ${currency()}`,
            color: plan.dueNow > 0.5 ? COPPER : undefined },
        ]} />

        {/* ══ المعرض ══ */}
        {rest.length > 0 && (
          <section className="reveal" style={{ marginBottom: 36 }}>
            <div className="h-section" style={{ marginBottom: 12 }}>{t("من الموقع")}</div>
            <div className="gallery">
              {rest.map((g, i) => (
                <div key={g.path || i} className="frame" onClick={() => setZoom(g.url || "")}>
                  <img src={g.url} alt="" loading="lazy" />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ══ المراحل ══ */}
        <section className="reveal" style={{ ...card }}>
          <div className="h-section" style={{ marginBottom: 12 }}>{t("المراحل")}</div>
          {plan.rows.filter(r => !r.empty).map(r => (
            <div key={r.phase} style={{ borderBottom: `1px solid ${LINE}`, padding: "14px 0" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
                            gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <i className="stagedot" style={{
                    backgroundColor: r.status === "done" ? SAGE : PHASE_COLORS[r.phase] || INK }} />
                  <b style={{ fontSize: 14.5, fontWeight: 500 }}>{t(r.phase)}</b>
                </span>
                <span className="num" style={{ fontSize: 13.5 }}>{fmt(r.phaseTotal)} {currency()}</span>
              </div>

              <div className="metagrid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))",
                                                 columnGap: 14, marginTop: 10, borderTop: "none" }}>
                <Meta label="قبل البدء" value={fmt(r.quote)} />
                <Meta label="بعد التسليم" value={fmt(r.profitDue)} />
                <Meta label="المدفوع" value={fmt(r.paidBase + r.paidProfit)}
                      color={r.baseSettled && r.profitSettled ? SAGE : undefined} />
              </div>

              <div style={{ marginTop: 8, fontSize: 11, color: r.status === "done" ? SAGE : MUTED }}>
                {t(r.statusLabel || "")}{r.deliveredAt ? ` · ${r.deliveredAt}` : ""}
              </div>
            </div>
          ))}
        </section>

        {/* ══ الدفعات ══ */}
        <section className="reveal" style={{ ...card }}>
          <div className="h-section" style={{ marginBottom: 10 }}>{t("الدفعات")}</div>
          {receipts.length === 0
            ? <div style={{ fontSize: 12.5, color: MUTED, padding: "10px 0" }}>{t("لا توجد دفعات مسجّلة بعد")}</div>
            : (
              <table className="editorial">
                <thead><tr>
                  <th>{t("التاريخ")}</th><th>{t("المرحلة")}</th><th>{t("البند")}</th>
                  <th style={{ textAlign: "end" }}>{t("المبلغ")}</th>
                </tr></thead>
                <tbody>
                  {receipts.map(r => (
                    <tr key={r.id}>
                      <td className="num">{r.date || "—"}</td>
                      <td>{r.phase ? t(r.phase) : "—"}</td>
                      <td>{r.kind === "profit" ? t("نسبة الربح") : t("قيمة المرحلة")}</td>
                      <td className="num" style={{ textAlign: "end" }}>{fmt(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </section>

        <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.9, marginTop: 30 }}>
          {t("هذه الصفحة للاطلاع فقط — أي تعديل يتم من المكتب. للاستفسار تواصل مع المهندس المسؤول.")}
        </div>
      </div>

      {zoom && <Lightbox url={zoom} onClose={() => setZoom("")} />}
    </div>
  );
}


/* ───────────────────────── شاشة المقاول ───────────────────────── */
export function ContractorView({ session }) {
  useLang();
  const rows = Array.isArray(session.payload) ? session.payload : [];

  /*  الحساب الجاري: المعتمد = المصروف + المحتجز.
      المحتجز عمل نُفّذ واستُحق لكنه لم يُصرف بعد — إخفاؤه يجعل
      المقاول يظن أن المكتب ينقصه، وإظهاره يقطع النزاع. */
  const totals = rows.reduce((acc, r) => {
    for (const k of r.contractors || []) acc.contract += Number(k.contractValue) || 0;
    for (const p of r.payments || []) {
      acc.paid += Number(p.amount) || 0;
      acc.retained += Number(p.retained) || 0;
    }
    return acc;
  }, { contract: 0, paid: 0, retained: 0 });
  const certified = totals.paid + totals.retained;

  return (
    <div>
      <SectionHead eyebrow={session.orgName || ""}
                   title={session.name || t("حسابك الجاري")}
                   subtitle={t("حسابك عبر مشاريع المكتب")} />

      <MetaGrid cols={4} style={{ columnGap: 20, marginBottom: 26 }} items={[
        { label: "قيمة التعاقدات", value: `${fmt(totals.contract)} ${currency()}` },
        { label: "المعتمد", value: `${fmt(certified)} ${currency()}` },
        { label: "محتجز الضمان", value: `${fmt(totals.retained)} ${currency()}`, color: COPPER },
        { label: "المتبقي لك", value: `${fmt(totals.contract - certified)} ${currency()}`, color: SAGE },
      ]} />

      {rows.length === 0 && (
        <div style={{ fontSize: 13, color: MUTED, padding: "30px 0", borderTop: `1px solid ${LINE}` }}>
          {t("لا توجد أعمال مسجّلة باسمك بعد")}
        </div>
      )}

      {rows.map((r, i) => {
        const contract = (r.contractors || []).reduce((s, k) => s + (Number(k.contractValue) || 0), 0);
        const paid = (r.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const retained = (r.payments || []).reduce((s, p) => s + (Number(p.retained) || 0), 0);
        const trades = [...new Set((r.contractors || []).map(k => k.trade).filter(Boolean))];
        return (
          <div key={i} style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <b style={{ fontSize: 15.5, fontWeight: 500 }}>{r.project}</b>
                {r.address && <span style={{ fontSize: 11.5, color: MUTED }}> · {r.address}</span>}
              </div>
              {trades.length > 0 && <Eyebrow>{trades.join(" · ")}</Eyebrow>}
            </div>

            <MetaGrid cols={4} style={{ columnGap: 14, marginTop: 12 }} items={[
              { label: "قيمة التعاقد", value: fmt(contract) },
              { label: "المصروف", value: fmt(paid) },
              { label: "محتجز الضمان", value: fmt(retained), color: COPPER },
              { label: "المتبقي", value: fmt(contract - paid - retained), color: SAGE },
            ]} />

            {(r.payments || []).length > 0 && (
              <table className="editorial" style={{ marginTop: 14 }}>
                <thead><tr>
                  <th>{t("التاريخ")}</th><th>{t("المرحلة")}</th>
                  <th style={{ textAlign: "end" }}>{t("المصروف")}</th>
                  <th style={{ textAlign: "end" }}>{t("محتجز")}</th>
                </tr></thead>
                <tbody>
                  {r.payments.map((p, j) => (
                    <tr key={j}>
                      <td className="num">{p.date || "—"}</td>
                      <td>{p.phase ? t(p.phase) : "—"}</td>
                      <td className="num" style={{ textAlign: "end" }}>{fmt(Number(p.amount) || 0)}</td>
                      <td className="num" style={{ textAlign: "end", color: COPPER }}>{fmt(Number(p.retained) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.9, marginTop: 30 }}>
        {t("محتجز الضمان يُصرف بعد انتهاء فترة الضمان المتفق عليها.")}
      </div>
    </div>
  );
}

/* ───────────────────────── الغلاف ───────────────────────── */
export default function Portal({ kindHint = "client" }) {
  const [session, setSession] = useState(null);
  const lang = useLang();
  React.useEffect(() => { applyDocumentLang(); }, [lang]);

  if (!session) return <LoginScreen onDone={setSession} kindHint={kindHint} />;

  /* شاشة العميل تُدير هوامشها بنفسها لأن صورتها تمتد من حافة لحافة،
     بينما شاشة المقاول جدول حسابات فيلزمها عمود مقروء محدود العرض. */
  const isClient = session.kind !== "contractor";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: PAPER, color: INK }}>
      <header style={{ borderBottom: `1px solid ${LINE}`, padding: "16px 20px",
                       display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }} className="truncate">{session.orgName || ""}</div>
          <Eyebrow>{session.kind === "contractor" ? t("بوابة المقاول") : t("بوابة العميل")}</Eyebrow>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LangToggle />
          <button onClick={() => setSession(null)} className="eyebrow"
                  style={{ background: "none", border: "none", cursor: "pointer", color: INK }}>
            {t("خروج")}
          </button>
        </div>
      </header>

      {isClient
        ? <main><ClientView session={session} /></main>
        : <main style={{ maxWidth: 940, margin: "0 auto", padding: "34px 20px 70px" }}>
            <ContractorView session={session} />
          </main>}
    </div>
  );
}
