import React, { useState } from "react";
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
function LoginScreen({ onDone }) {
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

        <Eyebrow>{t("بوابة الدخول")}</Eyebrow>
        <h1 className="h-page" style={{ margin: "6px 0 8px" }}>{t("متابعة مشروعك")}</h1>
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

/* ───────────────────────── شاشة العميل ───────────────────────── */
export function ClientView({ session }) {
  useLang();
  const raw = session.payload?.client || session.payload || {};
  const client = migrateClient(raw);
  const settings = { ...DEFAULT_SETTINGS, ...(session.payload?.settings || {}) };
  const byPhase = calcByPhase(client, settings);
  const plan = phasePaymentPlan(client, settings, byPhase);

  const receipts = (client.receipts || []).filter(r => Number(r.amount) > 0);

  return (
    <div>
      <SectionHead eyebrow={session.orgName || ""}
                   title={client.name || t("مشروعك")}
                   subtitle={client.address || ""} />

      <MetaGrid cols={4} style={{ columnGap: 20, marginBottom: 26 }} items={[
        { label: "الحالة", value: t(client.stage || "—") },
        { label: "المساحة", value: `${client.area || 0} م²` },
        { label: "قيمة العقد", value: `${fmt(plan.contractTotal)} ${currency()}` },
        { label: "المحصّل", value: `${fmt(plan.collected)} ${currency()}`, color: SAGE },
      ]} />

      {plan.dueNow > 0.5 && (
        <div style={{ ...card, borderTopColor: COPPER }}>
          <Eyebrow>{t("المستحق الآن")}</Eyebrow>
          <div className="num" style={{ fontSize: 30, fontWeight: 400, color: COPPER, marginTop: 4 }}>
            {fmt(plan.dueNow)} {currency()}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
            {t("يشمل ما يسبق بدء المرحلة القادمة وما استُحق بعد تسليم مرحلة سابقة")}
          </div>
        </div>
      )}

      {/* ── المراحل: ما دُفع، وما يُدفع قبل البدء، وما يُدفع بعد التسليم ── */}
      <div style={card}>
        <div className="h-section" style={{ marginBottom: 12 }}>{t("المراحل")}</div>
        {plan.rows.filter(r => !r.empty).map(r => (
          <div key={r.phase} style={{ borderBottom: `1px solid ${LINE}`, padding: "13px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <i className="stagedot" style={{ backgroundColor: PHASE_COLORS[r.phase] || INK }} />
                <b style={{ fontSize: 14, fontWeight: 500 }}>{t(r.phase)}</b>
              </span>
              <span className="num" style={{ fontSize: 13.5 }}>{fmt(r.phaseTotal)} {currency()}</span>
            </div>

            <div className="metagrid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", columnGap: 14, marginTop: 10, borderTop: "none" }}>
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
      </div>

      {/* ── سجل الدفعات: ما وصل المكتب فعلًا ── */}
      <div style={card}>
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
      </div>

      <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.9, marginTop: 30 }}>
        {t("هذه الصفحة للاطلاع فقط — أي تعديل يتم من المكتب. للاستفسار تواصل مع المهندس المسؤول.")}
      </div>
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
export default function Portal() {
  const [session, setSession] = useState(null);
  const lang = useLang();
  React.useEffect(() => { applyDocumentLang(); }, [lang]);

  if (!session) return <LoginScreen onDone={setSession} />;

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

      <main style={{ maxWidth: 940, margin: "0 auto", padding: "34px 20px 70px" }}>
        {session.kind === "contractor" ? <ContractorView session={session} /> : <ClientView session={session} />}
      </main>
    </div>
  );
}
