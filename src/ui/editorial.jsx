import React, { useRef, useState } from "react";
import { INK, PAPER, STONE, LINE, MUTED, STAGE_COLORS } from "./tokens.js";
import { t, useLang, setLang, getLang } from "./i18n.js";

/* ════════════════════════════════════════════════════════════════════════
   الطبقة التحريرية — ما يفصل واجهة مكتب معماري عن برنامج محاسبة
   ------------------------------------------------------------------------
   المحاولة السابقة أخطأت حين رسمت واجهات معمارية بالكود. لا مكتب في
   العالم يفعل ذلك: الصورة إما حقيقية أو لا تكون. الرسم المولَّد يشبه
   «زخرفة تملأ الفراغ» — وهذا بالضبط ما يجعل الواجهة تبدو هاوية.

   البديل الذي تعتمده المكاتب فعلًا:
     • الصورة الحقيقية بطلة الشاشة، بمساحة كبيرة وبلا إطار ولا انحناء.
     • حين لا توجد صورة: حقل حيادي نظيف يدعو لرفع واحدة — صمت مهذّب
       لا ادّعاء بصري.
     • البيانات تُقرأ كركن مخطط: تسمية صغيرة جدًا فوق قيمة أوضح منها.
     • العنوان كبير وخفيف الوزن، يفصله عن المحتوى خط شَعري واحد.
   ════════════════════════════════════════════════════════════════════════ */

/* ── تسمية صغيرة (Eyebrow) ── */
export function Eyebrow({ children, style, className = "" }) {
  return <span className={`eyebrow ${className}`} style={style}>{children}</span>;
}

/* ── خط شَعري فاصل ── */
export function Rule({ firm = false, style }) {
  return <div style={{ height: 1, backgroundColor: firm ? INK : LINE, ...style }} />;
}

/* ── خانة بيانات: تسمية فوق قيمة ── */
export function Meta({ label, value, color }) {
  return (
    <div>
      <span className="eyebrow">{t(label)}</span>
      <span className="metaval" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

/* ── شبكة خانات البيانات ── */
export function MetaGrid({ items = [], cols = 3, style }) {
  return (
    <div className="metagrid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, columnGap: 18, ...style }}>
      {items.filter(Boolean).map((it, i) => (
        <Meta key={i} label={it.label} value={it.value} color={it.color} />
      ))}
    </div>
  );
}

/* ── الإطار: الصورة بطلة، وإن غابت فحقل حيادي ── */
export function Frame({ url, alt = "", height, ratio = "4 / 3", children, className = "", style }) {
  const box = height ? { height } : { aspectRatio: ratio };
  return (
    <div className={`frame ${className}`} style={{ ...box, ...style }}>
      {url
        ? <img src={url} alt={alt} loading="lazy" />
        : <div className="plate">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" />
              <path d="M3 16l5-5 4 4 3-3 6 6" />
              <circle cx="8.5" cy="9" r="1.4" />
            </svg>
            <span style={{ fontSize: 10.5, letterSpacing: getLang() === "en" ? "0.14em" : 0, textTransform: "uppercase" }}>
              {t("أضف صورة المشروع")}
            </span>
          </div>}
      {children}
    </div>
  );
}

/* مصدر غلاف المشروع: غلاف مرفوع ← أحدث صورة موقع ← لا شيء */
export function coverSourceOf(client, signedUrls = {}) {
  if (client?.coverUrl) return { kind: "uploaded", url: client.coverUrl };
  const p = client?.coverPath || client?.lastPhotoPath;
  if (p && signedUrls[p]) return { kind: "photo", url: signedUrls[p] };
  return { kind: "empty" };
}

/* ── غلاف المشروع (يُبقي توقيع الاستدعاء القديم كما هو) ── */
export function ProjectCover({ client, urls = {}, height = 132, radius = 0, children, ratio = "4 / 3" }) {
  const src = coverSourceOf(client, urls);
  return (
    <Frame url={src.url} height={height} ratio={ratio}
           alt={client?.name || ""} style={radius ? { borderRadius: radius } : undefined}>
      {children && (
        <>
          {src.url && (
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(to top, rgba(10,9,8,.72) 0%, rgba(10,9,8,.16) 46%, rgba(10,9,8,0) 72%)",
            }} />
          )}
          <div style={{
            position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, bottom: 0,
            padding: "12px 14px",
            color: src.url ? "#FFFFFF" : INK,
          }}>
            {children}
          </div>
        </>
      )}
    </Frame>
  );
}

/* ── علامة الحالة: نقطة + نص، لا قرص ملوّن ── */
export function StagePill({ stage, onDark = true }) {
  return (
    <span className="stagebar" style={{ color: onDark ? "#FFFFFF" : INK }}>
      <i className="stagedot" style={{ backgroundColor: STAGE_COLORS[stage] || MUTED }} />
      {t(stage)}
    </span>
  );
}

/* ── ترويسة القسم: عنوان كبير خفيف + خط شَعري، بلا صورة مصطنعة ── */
export function SectionHead({ title, subtitle, eyebrow, children }) {
  return (
    <header style={{ marginBottom: 26 }}>
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 16, flexWrap: "wrap", paddingBottom: 14,
      }}>
        <div style={{ minWidth: 0 }}>
          {eyebrow && <Eyebrow style={{ marginBottom: 6 }}>{eyebrow}</Eyebrow>}
          <h1 className="h-page" style={{ margin: 0 }}>{title}</h1>
          {subtitle && (
            <div style={{ marginTop: 7, fontSize: 13, color: MUTED, fontWeight: 400 }}>{subtitle}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>
      </div>
      <Rule firm />
    </header>
  );
}

/* الاسم القديم مبقى فلا ينكسر أي استدعاء قائم */
export const SectionHero = SectionHead;

/* المولَّد السابق أُلغي عمدًا — أبقيناه اسمًا فقط لئلا ينكسر استيراد قديم */
export function GeneratedCover({ className = "", style }) {
  return <div className={`plate ${className}`} style={{ position: "relative", ...style }} />;
}

/* ── مبدّل اللغة ── */
export function LangToggle({ compact = false }) {
  const lang = useLang();
  const btn = (code, label) => (
    <button key={code} onClick={() => setLang(code)}
            aria-pressed={lang === code}
            style={{
              padding: compact ? "4px 7px" : "5px 9px",
              fontSize: 10.5, fontWeight: lang === code ? 600 : 400,
              letterSpacing: "0.1em", textTransform: "uppercase",
              color: lang === code ? INK : MUTED,
              background: "transparent", border: "none", cursor: "pointer",
              borderBottom: `1px solid ${lang === code ? INK : "transparent"}`,
            }}>{label}</button>
  );
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {btn("ar", "ع")}
      <span style={{ color: LINE }}>|</span>
      {btn("en", "EN")}
    </span>
  );
}

/* ── رفع صورة غلاف المشروع ──
   نفس مسار صور الموقع (مجلد cover لكل مشروع)، فلا سياسة تخزين جديدة
   ولا احتمال تسريب: أول جزء من المسار هو معرّف المكتب كما هو. */
export function CoverUpload({ clientId, onUploaded, uploadPhoto, disabled }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  const pick = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const res = await uploadPhoto(clientId, "cover", file);
      onUploaded?.(res.path);
    } catch (ex) { setErr(ex.message || "تعذّر الرفع"); }
    setBusy(false);
  };

  return (
    <span>
      <button type="button" className="btn" disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}>
        {busy ? t("جاري الرفع…") : t("صورة الغلاف")}
      </button>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={pick} />
      {err && <span style={{ marginInlineStart: 8, fontSize: 10.5, color: "#9E2B22" }}>{err}</span>}
    </span>
  );
}
