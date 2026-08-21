import React, { useEffect, useState } from "react";
import { INK, PAPER, MUTED, LINE } from "./tokens.js";
import { Eyebrow, LangToggle } from "./editorial.jsx";
import { t, useLang, applyDocumentLang } from "./i18n.js";
import { ClientView } from "./Portal.jsx";
import { localGet } from "../data/storage.js";
import { DEFAULT_SETTINGS } from "../domain/catalogue.js";

/* ════════════════════════════════════════════════════════════════════════
   معاينة بوابة العميل
   ------------------------------------------------------------------------
   يفتحها المكتب ليرى ما يراه عميله قبل أن يسلّمه الحساب. تقرأ بيانات
   المشروع من الجهاز مباشرة بلا دخول — لأن من يفتحها موظّف مسجَّل أصلًا
   في هذا المتصفح، ولا تُعرض إلا لمن يملك بيانات المكتب على جهازه.
   ══════════════════════════════════════════════════════════════════════ */
export default function PortalPreview() {
  const lang = useLang();
  const [state, setState] = useState({ loading: true, client: null, settings: DEFAULT_SETTINGS });

  useEffect(() => { applyDocumentLang(); }, [lang]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") || "";
    let alive = true;
    Promise.all([
      localGet(`client:${id}`, null),
      localGet("settings:global", DEFAULT_SETTINGS),
    ]).then(([client, settings]) => {
      if (alive) setState({ loading: false, client, settings: settings || DEFAULT_SETTINGS });
    }).catch(() => { if (alive) setState({ loading: false, client: null, settings: DEFAULT_SETTINGS }); });
    return () => { alive = false; };
  }, []);

  if (state.loading) {
    return <div style={{ padding: 60, textAlign: "center", color: MUTED }}>…</div>;
  }
  if (!state.client) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: MUTED, fontSize: 13 }}>
        لم يُعثر على المشروع على هذا الجهاز — افتح المعاينة من صفحة المشروع نفسها.
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: PAPER, color: INK }}>
      <header style={{ borderBottom: `1px solid ${LINE}`, padding: "14px 20px",
                       display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{state.settings?.officeName || ""}</div>
          <Eyebrow>{t("معاينة — هكذا يرى العميل صفحته")}</Eyebrow>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LangToggle />
          <button onClick={() => window.close()} className="eyebrow"
                  style={{ background: "none", border: "none", cursor: "pointer", color: INK }}>
            {t("إغلاق")}
          </button>
        </div>
      </header>

      <main>
        <ClientView session={{
          kind: "client",
          name: state.client.name,
          orgName: state.settings?.officeName || "",
          payload: { client: state.client, settings: state.settings },
        }} />
      </main>
    </div>
  );
}
