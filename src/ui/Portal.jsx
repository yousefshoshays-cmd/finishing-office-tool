import React, { useState, useEffect } from "react";
import { INK, PAPER, MUTED, LINE, STONE, SAGE, COPPER, DANGER, PHASE_COLORS, PHASE_SHORT, PHASES, STAGE_COLORS } from "./tokens.js";
import { Eyebrow, Rule, Meta, MetaGrid, SectionHead, LangToggle } from "./editorial.jsx";
import { t, useLang, applyDocumentLang, currency } from "./i18n.js";
import { portalLogin, portalBrand, changePortalPassword } from "../data/portal.js";
import { fmt, DEFAULT_SETTINGS } from "../domain/catalogue.js";
import { calcByPhase, migrateClient } from "../domain/pricing.js";
import { phasePaymentPlan } from "../domain/finance.js";
import { passwordCheck, showShort, showMismatch, MIN_PASSWORD } from "../domain/password.js";

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

/* ───────────────────────── شاشة الدخول ─────────────────────────
   أول ما يراه العميل، فهي التي تصنع الانطباع لا الصفحة التي بعدها.
   نموذج أبيض في وسط فراغ يقول «برنامج»، والمكاتب تقول شيئًا آخر:
   نصف الشاشة صورة تحمل الهوية، ونصفها نموذج هادئ.

   الهوية تصل من الرابط الذي سلّمه المكتب (اسم المكتب وصورته)، وتُحفظ
   في متصفح صاحب الحساب فتظهر في الزيارات التالية ولو كتب الرابط مجرّدًا.
   وحين لا توجد صورة، البديل ليس فراغًا أبيض بل لوح حبري بورق مخطط —
   صمت مقصود لا نقص. */
function LoginScreen({ onDone, kindHint = "client" }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const brand = portalBrand();
  useLang();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const s = await portalLogin(u.trim(), p.trim());
      /*  الاسم يُحفظ مع الجلسة لا ليُعرض، بل ليكفي صاحبَ الحساب كتابةَ
          كلمتَي السر وحدهما عند التغيير. كلمة السر نفسها لا تُحفظ.  */
      onDone({ ...s, username: u.trim().toUpperCase() });
    }
    catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const isContractor = kindHint === "contractor";

  return (
    <div className="loginsplit">
      {/* ══ نصف الهوية ══ */}
      <aside className="loginart">
        {brand.image
          ? <img src={brand.image} alt="" className="kenburns" />
          : <div className="blueprint" />}
        <div className="loginartveil" />
        <div className="loginartbody">
          <Eyebrow style={{ color: "#DCD6CC" }}>
            {isContractor ? t("بوابة المقاول") : t("بوابة العميل")}
          </Eyebrow>
          <div className="loginartname">
            {brand.name || t("نظام متابعة العملاء والتسعير")}
          </div>
          <div className="loginartline">
            {isContractor
              ? t("حسابك الجاري في كل مشروع: المعتمد والمحتجز والمتبقي")
              : t("متابعة مشروعك: المراحل والدفعات وصور التنفيذ")}
          </div>
        </div>
      </aside>

      {/* ══ نصف النموذج ══ */}
      <main className="loginform">
        <form onSubmit={submit} style={{ width: "100%", maxWidth: 380 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 30 }}>
            <LangToggle />
          </div>

          <h1 className="h-page" style={{ margin: "0 0 8px" }}>
            {isContractor ? t("حسابك الجاري") : t("متابعة مشروعك")}
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

          {err && <div style={{ marginTop: 14, fontSize: 12, color: DANGER, lineHeight: 1.8 }}>{err}</div>}

          <button type="submit" className="btn btn-primary" disabled={busy || !u || !p}
                  style={{ width: "100%", marginTop: 24 }}>
            {busy ? t("جاري الدخول…") : t("دخول")}
          </button>

          <div style={{ marginTop: 20, fontSize: 11.5, color: MUTED, lineHeight: 1.9 }}>
            {t("نسيت كلمة السر؟ اطلب من المكتب إصدار كلمة سر جديدة — لا يمكن استرجاع القديمة لأنها غير مخزَّنة أصلًا.")}
          </div>
        </form>
      </main>
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

  /*  المرحلة الحالية والمُسلَّمة — من بيانات العميل نفسها، بلا حساب جديد.
      المُسلَّم: ما له تاريخ تسليم فعليّ (لا ما اكتمل سداده — العميل يهمّه
      أين وصل البناء لا أين وصل الدفع). الحالية: أول مرحلة لم تُسلَّم بعد. */
  const deliveredSet = new Set(
    (plan.rows || []).filter(r => r.deliveredAt).map(r => r.phase)
  );
  const currentPhase = PHASES.find(ph => !deliveredSet.has(ph)) || null;

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
              {client.area > 0 && <span>· {client.area} {t("م²")}</span>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 22px 70px" }}>
        {/* ══ سطر الطمأنينة: أين وصلنا، بلغة بشر لا أرقام ══
            العميل يريد أولًا أن يطمئن أنه في مشروعه هو وأنه يعرف موضعه. */}
        <div className="reveal" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: "clamp(17px,2.6vw,22px)", fontWeight: 300, lineHeight: 1.5 }}>
            {currentPhase
              ? <>{t("مشروعك في مرحلة")} <b style={{ fontWeight: 600 }}>{t(currentPhase)}</b>{progress > 0 ? <> — {progress}% {t("مكتمل")}</> : null}</>
              : (progress > 0 ? <>{progress}% {t("مكتمل")}</> : t("مشروعك قيد المتابعة"))}
          </div>
        </div>

        {/* ══ العمود الفقري: المراحل الخمس خطًّا زمنيًّا مرئيًّا ══
            أقوى عنصر طمأنة — يرى مشروعه كخطّ يتقدّم: المسلَّم ✓، والجاري مُبرَز. */}
        <section className="reveal spine" aria-label={t("مراحل المشروع")}>
          {PHASES.map((ph, i) => {
            const done = deliveredSet.has(ph);
            const isNow = ph === currentPhase;
            return (
              <div key={ph} className={"spine-step" + (done ? " is-done" : "") + (isNow ? " is-now" : "")}>
                <span className="spine-dot" style={{ backgroundColor: done ? SAGE : (isNow ? INK : STONE) }}>
                  {done ? "✓" : i + 1}
                </span>
                <span className="spine-lbl">{t(PHASE_SHORT[ph] || ph)}</span>
              </div>
            );
          })}
        </section>

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

        {/* ══ المعرض: الحمولة العاطفية — أن يرى مشروعه يكبر ══ */}
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

        {/* ══ مالُه هو، بعينه هو — بلا رقم داخليّ واحد للمكتب ══ */}
        <MetaGrid cols={4} style={{ columnGap: 20, marginBottom: 34 }} items={[
          { label: "قيمة العقد", value: `${fmt(plan.contractTotal)} ${currency()}` },
          { label: "المحصّل", value: `${fmt(plan.collected)} ${currency()}`, color: SAGE },
          { label: "المتبقي", value: `${fmt(Math.max(0, plan.contractTotal - plan.collected))} ${currency()}` },
          { label: "المستحق الآن", value: `${fmt(plan.dueNow)} ${currency()}`,
            color: plan.dueNow > 0.5 ? COPPER : undefined },
        ]} />

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
                <Meta label={t("قبل البدء")} value={fmt(r.quote)} />
                <Meta label={t("بعد التسليم")} value={fmt(r.profitDue)} />
                <Meta label={t("المدفوع")} value={fmt(r.paidBase + r.paidProfit)}
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

      {/*  الهرمية هنا: رقمان كبيران يجيبان سؤالَي المقاول قبل أي شيء —
          «كم لي؟» و«كم محتجَز عليّ؟» — بخطّ ضخم على ورق فاتح عالي التباين،
          يُقرأ على هاتف في الشمس. التفصيل والتعاقد أرقام هادئة تحتهما.

          المتبقي = التعاقد − المعتمد. فإن لم تُسجَّل قيمة تعاقد أصلًا صار
          الناتج سالبًا بحجم ما صُرف — فيقرأ المقاول أنه مدينٌ وهو دائن.
          فحين يغيب التعاقد نعرض «المعتمد لك» بدل «المتبقي» ونقول السبب.  */}
      <div className="paybig reveal">
        <div className="paybig-cell">
          <div className="paybig-lbl">{totals.contract > 0 ? t("المتبقّي لك") : t("المعتمد لك")}</div>
          <div className="paybig-num" style={{ color: INK }}>
            {fmt(totals.contract > 0 ? totals.contract - certified : certified)}
            <span className="paybig-cur">{currency()}</span>
          </div>
        </div>
        <div className="paybig-div" />
        <div className="paybig-cell">
          <div className="paybig-lbl">{t("محتجز الضمان")}</div>
          <div className="paybig-num" style={{ color: COPPER }}>
            {fmt(totals.retained)}
            <span className="paybig-cur">{currency()}</span>
          </div>
        </div>
      </div>

      {/* أرقام هادئة داعمة — تُبقي قيمة التعاقدات والمعتمد في المشهد بلا مزاحمة */}
      <MetaGrid cols={2} style={{ columnGap: 20, marginBottom: 26, maxWidth: 460 }} items={[
        { label: "قيمة التعاقدات", value: totals.contract > 0 ? `${fmt(totals.contract)} ${currency()}` : "—" },
        { label: "المعتمد", value: `${fmt(certified)} ${currency()}` },
      ]} />
      {totals.contract === 0 && rows.length > 0 && (
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.9, marginTop: -14, marginBottom: 24 }}>
          {t("لم تُسجَّل قيمة تعاقد في هذه المشاريع بعد، فلا يمكن حساب المتبقي — المعروض أعلاه ما اعتُمد لك فعلًا. راجع المكتب لتسجيل قيمة التعاقد.")}
        </div>
      )}

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
              {trades.length > 0 && <Eyebrow>{trades.map(x => t(x)).join(" · ")}</Eyebrow>}
            </div>

            <MetaGrid cols={4} style={{ columnGap: 14, marginTop: 12 }} items={[
              { label: "قيمة التعاقد", value: contract > 0 ? fmt(contract) : "—" },
              { label: "المصروف", value: fmt(paid) },
              { label: "محتجز الضمان", value: fmt(retained), color: COPPER },
              { label: "المتبقي", value: contract > 0 ? fmt(contract - paid - retained) : "—", color: SAGE },
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


/* ──────────────────── تغيير كلمة السر ────────────────────
   كلمة السر التي يُصدرها المكتب يعرفها اثنان. وكلمة سر يعرفها اثنان
   ليست كلمة سرّ صاحبها. هنا يجعلها سرًّا لا يعرفه سواه.

   لا نطلب اسم المستخدم — هو محفوظ من لحظة الدخول. ولا نطلب كلمة السر
   الحالية ثقةً بالشاشة: الخادم هو من يتحقّق منها قبل أن يغيّر شيئًا. */
export function ChangePassword({ username, onClose }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  useLang();

  const short = showShort(newPw);
  const mismatch = showMismatch(newPw, again);
  const ready = passwordCheck(oldPw, newPw, again).ok && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setErr("");
    try { await changePortalPassword(username, oldPw, newPw); setDone(true); }
    catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <div onClick={e => e.stopPropagation()}
           style={{ background: PAPER, color: INK, width: "min(420px, 92vw)",
                    padding: "30px 30px 26px", border: `1px solid ${LINE}`, textAlign: "start" }}>
        {done ? (
          <>
            <Eyebrow>{t("تم")}</Eyebrow>
            <div style={{ fontSize: 19, fontWeight: 300, margin: "10px 0 8px" }}>
              {t("تغيّرت كلمة السر")}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.95, marginBottom: 22 }}>
              {t("استعملها في المرة القادمة. لا أحد يعرفها الآن سواك — ولا المكتب.")}
            </div>
            <button className="btn btn-primary" onClick={onClose} style={{ width: "100%" }}>
              {t("إغلاق")}
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <Eyebrow>{t("الحساب")}</Eyebrow>
            <div style={{ fontSize: 19, fontWeight: 300, margin: "10px 0 6px" }}>
              {t("تغيير كلمة السر")}
            </div>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.9, marginBottom: 20 }}>
              {t("ثمانية أحرف على الأقل. اختر ما تحفظه أنت — فالمكتب لن يستطيع قراءتها.")}
            </div>

            <Eyebrow>{t("كلمة السر الحالية")}</Eyebrow>
            <input className="inp" type="password" value={oldPw} autoComplete="current-password"
                   onChange={e => setOldPw(e.target.value)} />

            <div style={{ marginTop: 14 }}>
              <Eyebrow>{t("كلمة السر الجديدة")}</Eyebrow>
              <input className="inp" type="password" value={newPw} autoComplete="new-password"
                     onChange={e => setNewPw(e.target.value)} />
              {short && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>
                {t("ثمانية أحرف على الأقل")}</div>}
            </div>

            <div style={{ marginTop: 14 }}>
              <Eyebrow>{t("أعدها مرة أخرى")}</Eyebrow>
              <input className="inp" type="password" value={again} autoComplete="new-password"
                     onChange={e => setAgain(e.target.value)} />
              {mismatch && <div style={{ fontSize: 11.5, color: DANGER, marginTop: 6 }}>
                {t("الكلمتان غير متطابقتين")}</div>}
            </div>

            {err && <div style={{ marginTop: 14, fontSize: 12, color: DANGER, lineHeight: 1.8 }}>{err}</div>}

            <button type="submit" className="btn btn-primary" disabled={!ready}
                    style={{ width: "100%", marginTop: 22 }}>
              {busy ? t("جاري الحفظ…") : t("حفظ كلمة السر")}
            </button>
            <button type="button" onClick={onClose}
                    style={{ width: "100%", marginTop: 10, background: "none", border: "none",
                             cursor: "pointer", color: MUTED, fontSize: 12, fontFamily: "inherit" }}>
              {t("إلغاء")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── الغلاف ───────────────────────── */
export default function Portal({ kindHint = "client" }) {
  const [session, setSession] = useState(null);
  const [changing, setChanging] = useState(false);
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
          <button onClick={() => setChanging(true)} className="eyebrow"
                  style={{ background: "none", border: "none", cursor: "pointer", color: INK }}>
            {t("كلمة السر")}
          </button>
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

      {changing && (
        <ChangePassword username={session.username} onClose={() => setChanging(false)} />
      )}
    </div>
  );
}
