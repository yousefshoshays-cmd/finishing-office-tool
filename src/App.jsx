import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users, LayoutDashboard, Settings, Plus, Trash2, Download,
  Phone, MapPin, Ruler, ChevronLeft, Save, X, AlertCircle, Loader2,
  FileSpreadsheet, ExternalLink, FileText, PartyPopper, UploadCloud, ShieldCheck, Wifi, ChevronDown,
} from "lucide-react";
import * as ExcelJS from "exceljs";
import pptxgen from "pptxgenjs";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, Header, Footer, PageNumber, VerticalAlign } from "docx";
import { saveAs } from "file-saver";
import { openDB } from "idb";
import { createClient } from "@supabase/supabase-js";

/* ============================= Persistent storage: local (IndexedDB) or cloud (Supabase) =============================
   By default this app runs fully standalone — data lives in this browser's IndexedDB only, and
   does NOT sync between devices. If the office configures cloud sync (Settings → المزامنة السحابية)
   with a Supabase project, every read/write below transparently goes to a shared Postgres table
   instead, so every engineer's device sees the same live data. The rest of the app never needs to
   know which mode is active — it always just calls storageGet/storageSet/storageDelete/storageListKeys. */
const DB_NAME = "boq_office_db";
const STORE = "kv";
const CLOUD_CONFIG_KEY = "boq_cloud_config"; // raw localStorage key — must exist before we know which mode to use

// Built into this deployment so anyone opening the site is connected automatically —
// no copy/paste setup per device. The publishable key is safe to ship in client code
// by design; real protection comes from the database's row-level security policies,
// not from hiding this value. To point this deployment at a different Supabase
// project, just change these two lines and rebuild.
const DEFAULT_SUPABASE_URL = "https://oovityllspqojxexkrxg.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_xDKo_zVZU606enHf-RtOIw_e_uabv4Y";
// SECURITY: simple mode grants every anonymous visitor full read/write on all client
// data. It must never be the default for a publicly reachable deployment. The owner can
// still turn it on deliberately from Settings for offline testing.
const DEFAULT_SIMPLE_MODE = false;

let dbPromise = null;
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

function getCloudConfig() {
  try {
    const raw = window.localStorage.getItem(CLOUD_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.disabled) return null; // person explicitly chose local-only
      if (parsed && parsed.url && parsed.anonKey) return parsed; // explicit override (e.g. switched modes)
    }
  } catch {
    /* fall through to default below */
  }
  if (DEFAULT_SUPABASE_URL && DEFAULT_SUPABASE_ANON_KEY) {
    return { url: DEFAULT_SUPABASE_URL, anonKey: DEFAULT_SUPABASE_ANON_KEY, simpleMode: DEFAULT_SIMPLE_MODE };
  }
  return null;
}
function setCloudConfig(cfg) {
  try {
    if (cfg) window.localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cfg));
    else window.localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify({ disabled: true }));
  } catch (e) {
    console.error("setCloudConfig failed", e);
  }
}
function isCloudMode() {
  const cfg = getCloudConfig();
  return !!(cfg && cfg.url && cfg.anonKey);
}
function isSimpleMode() {
  const cfg = getCloudConfig();
  return !!(cfg && cfg.simpleMode);
}
let _supabaseClient = null;
function getSupabase() {
  const cfg = getCloudConfig();
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  if (_supabaseClient && _supabaseClient.__url === cfg.url) return _supabaseClient;
  _supabaseClient = createClient(cfg.url, cfg.anonKey);
  _supabaseClient.__url = cfg.url;
  return _supabaseClient;
}

async function localGet(key, fallback) {
  try {
    const db = await getDB();
    const v = await db.get(STORE, key);
    return v !== undefined ? v : fallback;
  } catch (e) {
    console.error("localGet failed", key, e);
    return fallback;
  }
}
async function localSet(key, value) {
  try {
    const db = await getDB();
    await db.put(STORE, value, key);
    return true;
  } catch (e) {
    console.error("localSet failed", key, e);
    return false;
  }
}
async function localDelete(key) {
  try {
    const db = await getDB();
    await db.delete(STORE, key);
  } catch (e) {
    console.error("localDelete failed", key, e);
  }
}
async function localListKeys(prefix) {
  try {
    const db = await getDB();
    const all = await db.getAllKeys(STORE);
    return all.filter((k) => typeof k === "string" && k.startsWith(prefix));
  } catch (e) {
    console.error("localListKeys failed", prefix, e);
    return [];
  }
}
async function localGetAllEntries() {
  try {
    const db = await getDB();
    const keys = await db.getAllKeys(STORE);
    const entries = await Promise.all(keys.map(async (k) => [k, await db.get(STORE, k)]));
    return entries;
  } catch (e) {
    console.error("localGetAllEntries failed", e);
    return [];
  }
}

function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function cloudGet(key, fallback) {
  const sb = getSupabase();
  try {
    const { data, error } = await withTimeout(sb.from("kv").select("value").eq("key", key).maybeSingle());
    if (error || !data) return fallback;
    return data.value;
  } catch (e) {
    console.error("cloudGet failed", key, e);
    return fallback;
  }
}
async function cloudSet(key, value) {
  const sb = getSupabase();
  try {
    const { error } = await withTimeout(sb.from("kv").upsert({ key, value, updated_at: new Date().toISOString() }));
    return !error;
  } catch (e) {
    console.error("cloudSet failed", key, e);
    return false;
  }
}
async function cloudDelete(key) {
  const sb = getSupabase();
  try {
    await withTimeout(sb.from("kv").delete().eq("key", key));
  } catch (e) {
    console.error("cloudDelete failed", key, e);
  }
}
async function cloudListKeys(prefix) {
  const sb = getSupabase();
  try {
    const { data, error } = await withTimeout(sb.from("kv").select("key").like("key", prefix + "%"));
    if (error || !data) return [];
    return data.map((r) => r.key);
  } catch (e) {
    console.error("cloudListKeys failed", prefix, e);
    return [];
  }
}
async function cloudGetAllEntries() {
  const sb = getSupabase();
  try {
    const { data, error } = await withTimeout(sb.from("kv").select("key,value"));
    if (error || !data) return [];
    return data.map((r) => [r.key, r.value]);
  } catch (e) {
    console.error("cloudGetAllEntries failed", e);
    return [];
  }
}

async function storageGet(key, fallback) {
  return isCloudMode() ? cloudGet(key, fallback) : localGet(key, fallback);
}
async function storageSet(key, value) {
  return isCloudMode() ? cloudSet(key, value) : localSet(key, value);
}
async function storageDelete(key) {
  return isCloudMode() ? cloudDelete(key) : localDelete(key);
}
async function storageListKeys(prefix) {
  return isCloudMode() ? cloudListKeys(prefix) : localListKeys(prefix);
}
async function storageGetAllEntries() {
  return isCloudMode() ? cloudGetAllEntries() : localGetAllEntries();
}

/* ============================= Cloud profiles (server-enforced roles) =============================
   Unlike the local-mode "team" list (a plain kv record anyone can edit), profiles in cloud mode
   live in their own Postgres table with row-level security: a user's own role can only ever be
   changed by an existing owner, never by themselves. See the SQL script in Settings for the schema. */
async function fetchMyProfile(userId) {
  const sb = getSupabase();
  try {
    const { data, error } = await withTimeout(sb.from("profiles").select("*").eq("id", userId).maybeSingle());
    if (error || !data) return null;
    return data;
  } catch (e) {
    console.error("fetchMyProfile failed", e);
    return null;
  }
}
async function fetchAllProfiles() {
  const sb = getSupabase();
  try {
    const { data, error } = await withTimeout(sb.from("profiles").select("*"));
    if (error || !data) return [];
    return data;
  } catch (e) {
    console.error("fetchAllProfiles failed", e);
    return [];
  }
}
async function approveProfile(id, role) {
  const sb = getSupabase();
  try {
    const { error } = await withTimeout(sb.from("profiles").update({ role }).eq("id", id));
    return !error;
  } catch (e) {
    console.error("approveProfile failed", e);
    return false;
  }
}

/* ============================= Permissions =============================
   One place that answers "may this role do this?". The UI reads from here so a
   permission is never re-implemented (and quietly diverged) in two components.

   IMPORTANT: this is presentation only. It hides controls a role shouldn't use,
   it does NOT protect data — a determined user can call the API directly. The
   real boundary is the Postgres row-level-security policy (see Settings → SQL).
   Every rule below must have a matching server-side policy. */

const ROLES = {
  owner:    { label: "مالك المكتب", color: "#BF9000", textOn: "#1F1F1F" },
  manager:  { label: "مدير مشاريع", color: "#1E7B45", textOn: "#FFFFFF" },
  engineer: { label: "مهندس",       color: "#2E5395", textOn: "#FFFFFF" },
  pending:  { label: "بانتظار الموافقة", color: "#B45309", textOn: "#FFFFFF" },
};
const ASSIGNABLE_ROLES = ["engineer", "manager", "owner"];

const PERMISSIONS = {
  viewAllClients:   ["owner", "manager"],
  editUnitPrice:    ["owner", "manager"],
  viewCostBasis:    ["owner", "manager"],
  advanceToSigned:  ["owner", "manager"],
  deleteClient:     ["owner"],
  manageTeam:       ["owner"],
  editClientData:   ["owner", "manager", "engineer"],
  logSiteVisit:     ["owner", "manager", "engineer"],
};

function can(member, action) {
  const allowed = PERMISSIONS[action];
  if (!allowed) return false;
  return !!member && allowed.includes(member.role);
}

function roleLabel(role) {
  return (ROLES[role] || ROLES.engineer).label;
}

/* ============================= Brand ============================= */
const NAVY = "#1F4E78";
const NAVY_DARK = "#163A57";
const GOLD = "#BF9000";
const LIGHT = "#F5F7FA";
const BORDER = "#E3E7EE";
const TEXT = "#1F2937";
const MUTED = "#6B7280";

const LEVELS = ["اقتصادي", "متوسط", "لوكس", "سوبر لوكس"];
const LEVEL_COLORS = { "اقتصادي": "#6B7280", "متوسط": "#2E5395", "لوكس": "#BF9000", "سوبر لوكس": "#1F1F1F" };

const SCOPES = [
  "تصميم",
  "تعديلات معمارية (هدم وبناء)",
  "التشطيبات المعمارية والتنفيذ",
  "الكهرباء",
  "السباكة والتكييف",
  "الفرش والأثاث",
];

const STAGES = ["عميل محتمل", "قيد التصميم", "تم التعاقد", "قيد التنفيذ", "تم التسليم"];
const STAGE_COLORS = {
  "عميل محتمل": "#9CA3AF",
  "قيد التصميم": "#2E5395",
  "تم التعاقد": "#BF9000",
  "قيد التنفيذ": "#C2410C",
  "تم التسليم": "#1E7B45",
};

/* ============================= Item catalogue (mirrors the office BOQ) ============================= */
// qty(area) returns quantity for a given apartment area in m²
const ITEMS = [
  ["تصميم", "رسومات التوزيع المعماري وإعادة توزيع الفراغات الداخلية", "م²", a => a, [20, 35, 55, 80]],
  ["تصميم", "تصميم ديكور داخلي (Mood Board + لوحات مرجعية)", "م²", a => a, [30, 50, 80, 120]],
  ["تصميم", "تصميم إنارة (Lighting Layout)", "م²", a => a, [15, 25, 40, 60]],
  ["تصميم", "مخططات كهروميكانيكال (توزيع الأحمال والنقاط)", "م²", a => a, [15, 25, 35, 50]],
  ["تصميم", "تصميم ثلاثي الأبعاد 3D Visualization (لكل مشهد)", "مشهد", () => 6, [800, 1200, 2000, 3500]],
  ["تصميم", "إعداد كتالوج ولوحة الخامات والتشطيبات النهائية", "شقة", () => 1, [1500, 2500, 4000, 6000]],

  ["تعديلات معمارية (هدم وبناء)", "تكسير حوائط طوب داخلية غير إنشائية", "م²", () => 15, [60, 70, 80, 90]],
  ["تعديلات معمارية (هدم وبناء)", "بناء حوائط طوب جديدة (أحمر/بلوك) شامل المونة", "م²", () => 15, [180, 200, 220, 250]],
  ["تعديلات معمارية (هدم وبناء)", "فتح فتحات أبواب / شبابيك جديدة بالحوائط", "فتحة", () => 4, [250, 300, 350, 400]],
  ["تعديلات معمارية (هدم وبناء)", "ردم وتسوية أرضيات تمهيداً للتشطيب", "م²", a => a, [40, 50, 60, 70]],
  ["تعديلات معمارية (هدم وبناء)", "أعمال عزل مائي للحمامات والمطبخ", "م²", () => 25, [90, 110, 140, 170]],
  ["تعديلات معمارية (هدم وبناء)", "نقل ورفع مخلفات ومعدات الهدم", "شقة", () => 1, [3000, 4000, 5000, 6000]],

  ["التشطيبات المعمارية والتنفيذ", "أرضيات بورسلين / سيراميك للصالات والغرف", "م²", a => a * 1.05, [350, 550, 850, 1400]],
  ["التشطيبات المعمارية والتنفيذ", "سيراميك حوائط الحمامات والمطبخ", "م²", () => 40, [250, 380, 550, 800]],
  ["التشطيبات المعمارية والتنفيذ", "وزرة / سكيرتنج الأرضيات", "متر طولي", a => a * 0.8, [45, 65, 90, 130]],
  ["التشطيبات المعمارية والتنفيذ", "أسقف جبس بورد عادي", "م²", a => a * 0.5, [220, 280, 350, 450]],
  ["التشطيبات المعمارية والتنفيذ", "أسقف جبس بورد مفرغ ديكوري", "م²", a => a * 0.15, [320, 420, 550, 750]],
  ["التشطيبات المعمارية والتنفيذ", "معجون ودهانات حوائط وأسقف (3 أوجه)", "م²", a => a * 3.2, [45, 60, 85, 120]],
  ["التشطيبات المعمارية والتنفيذ", "أبواب داخلية خشب شامل الكوالين والإكسسوار", "عدد", () => 7, [3500, 5500, 8500, 13000]],
  ["التشطيبات المعمارية والتنفيذ", "باب رئيسي أمان للشقة", "عدد", () => 1, [6000, 9000, 14000, 22000]],
  ["التشطيبات المعمارية والتنفيذ", "شبابيك ألوميتال / UPVC مزدوجة الزجاج", "م²", () => 22, [1800, 2400, 3200, 4200]],
  ["التشطيبات المعمارية والتنفيذ", "وحدات مطبخ خشب شامل الكاونتر", "متر طولي", () => 6, [4500, 7000, 11000, 18000]],
  ["التشطيبات المعمارية والتنفيذ", "تجهيزات صحية كاملة", "طقم", () => 2, [9000, 15000, 25000, 40000]],

  ["الكهرباء", "تمديد أسلاك ومواسير كهرباء لكل نقطة", "نقطة", () => 90, [180, 220, 260, 320]],
  ["الكهرباء", "لوحة توزيع رئيسية وفرعية", "عدد", () => 1, [2500, 3500, 5000, 7500]],
  ["الكهرباء", "تركيب إنارة (سبوت لايت / ليست جبس)", "نقطة", () => 45, [90, 140, 220, 350]],
  ["الكهرباء", "مفاتيح وبرايز فئة عالية", "عدد", () => 70, [60, 110, 180, 300]],
  ["الكهرباء", "تأريض ومانع صواعق", "شقة", () => 1, [1500, 2200, 3000, 4000]],

  ["السباكة والتكييف", "تمديد مواسير مياه باردة وساخنة PPR", "نقطة", () => 20, [220, 280, 350, 450]],
  ["السباكة والتكييف", "تمديد صرف صحي PVC", "نقطة", () => 14, [250, 320, 400, 500]],
  ["السباكة والتكييف", "سخان مياه كهربائي / غاز", "عدد", () => 2, [3500, 5000, 7500, 11000]],
  ["السباكة والتكييف", "تكييف سبليت توريد وتركيب", "عدد", () => 4, [14000, 18000, 24000, 32000]],
  ["السباكة والتكييف", "عزل مواسير التكييف والصرف", "متر طولي", () => 30, [40, 55, 75, 100]],

  ["الفرش والأثاث", "غرفة معيشة كاملة", "شقة", () => 1, [45000, 75000, 130000, 220000]],
  ["الفرش والأثاث", "غرفة نوم رئيسية كاملة", "غرفة", () => 1, [60000, 95000, 160000, 280000]],
  ["الفرش والأثاث", "غرف نوم إضافية / أطفال", "غرفة", () => 2, [35000, 55000, 90000, 150000]],
  ["الفرش والأثاث", "غرفة سفرة", "شقة", () => 1, [25000, 40000, 70000, 120000]],
  ["الفرش والأثاث", "أجهزة مطبخ", "شقة", () => 1, [35000, 55000, 90000, 150000]],
  ["الفرش والأثاث", "ستائر وموكيت وسجاد", "شقة", () => 1, [20000, 32000, 50000, 85000]],
  ["الفرش والأثاث", "إكسسوارات وإضاءة ديكورية", "شقة", () => 1, [8000, 14000, 22000, 35000]],
];

/* Indicative material/type specification per finishing level, for the items where the
   type of material meaningfully changes look, feel, and durability across tiers. */
const SPECS = {
  "أرضيات بورسلين / سيراميك للصالات والغرف": ["بورسلين محلي 60×60 سم", "بورسلين مستورد 80×80 سم", "بورسلين إيطالي كبير المقاس / رخام طبيعي مختار", "رخام طبيعي نادر (كالاكاتا / ستاتواريو)"],
  "سيراميك حوائط الحمامات والمطبخ": ["سيراميك محلي لامع", "سيراميك مستورد مطفي", "بورسلين حوائط كبير المقاس", "رخام / حجر طبيعي للحوائط"],
  "أسقف جبس بورد عادي": ["جبس بورد مسطح بسيط بدون تعرجات", "جبس بورد بكسرات بسيطة وإضاءة جزئية", "جبس بورد مفرغ بالكامل بإضاءة معمارية", "تصميم جبسي متعدد المستويات بالكامل"],
  "معجون ودهانات حوائط وأسقف (3 أوجه)": ["دهان بلاستيك مطفي اقتصادي", "دهان سيمي جلوس + حائط مميز (Feature Wall)", "دهان فاخر مستورد قابل للغسيل", "دهان صديق للبيئة عالي الأداء + تأثيرات ديكورية (Venetian Plaster)"],
  "أبواب داخلية خشب شامل الكوالين والإكسسوار": ["خشب مضغوط (MDF) بدهان رش", "خشب زان أو صاج بديل خشب", "خشب طبيعي مصمت بمقابض فاخرة", "خشب مصمت عازل للصوت بتشطيب يدوي"],
  "باب رئيسي أمان للشقة": ["باب أمان اقتصادي طبقة واحدة", "باب أمان مقاوم للحريق طبقتين", "باب أمان مستورد بمقبض فاخر", "باب أمان فاخر بتصميم مخصص + قفل بصمة ذكي"],
  "شبابيك ألوميتال / UPVC مزدوجة الزجاج": ["ألوميتال عادي بزجاج مفرد", "ألوميتال / UPVC بزجاج مزدوج عازل", "UPVC ألماني عازل حراري وصوتي", "نظام عزل صوتي كامل + زجاج ذكي متغير الشفافية"],
  "وحدات مطبخ خشب شامل الكاونتر": ["ميلامين + كاونتر جرانيت محلي", "أكريليك + كاونتر كوارتز", "لاكيه لامع + كاونتر كوارتز مستورد", "خشب طبيعي مصمت + كاونتر جرانيت / رخام فاخر"],
  "تجهيزات صحية كاملة": ["تجهيزات محلية اقتصادية", "تجهيزات محلية فئة أولى (Ideal Standard)", "تجهيزات مستوردة (Grohe / Duravit)", "تجهيزات فاخرة (Kohler / Villeroy & Boch) + خلاطات ذكية"],
  "تركيب إنارة (سبوت لايت / ليست جبس)": ["سبوت لايت عادي", "سبوت لايت LED + ليست جبس بسيط", "إضاءة معمارية موجهة بدرجة حرارة لون متحكم بها", "نظام إضاءة ذكي متكامل (Smart Lighting)"],
  "مفاتيح وبرايز فئة عالية": ["مفاتيح تجارية محلية", "مفاتيح Schneider / MK", "مفاتيح Legrand / ABB", "مفاتيح Gira / JUNG بتحكم لمسي ذكي"],
  "تكييف سبليت توريد وتركيب": ["سبليت تجاري محلي", "سبليت فئة تجارية جيدة (Midea / Carrier)", "سبليت انفرتر موفر للطاقة (LG / Samsung)", "تكييف مركزي (دكت) بتحكم مركزي ذكي"],
};

const fmt = (n) => Math.round(n).toLocaleString("en-US");

const DEFAULT_SETTINGS = { supervisionPct: 0.08, contingencyPct: 0.05, vatPct: 0.14 };

function newClient() {
  const id = "c" + Date.now() + Math.floor(Math.random() * 1000);
  return {
    id,
    name: "",
    phone: "",
    address: "",
    area: 150,
    stage: "عميل محتمل",
    style: "",
    notes: "",
    createdAt: new Date().toISOString().slice(0, 10),
    folderLink: "",
    engineer: "",
    progressPercent: 0,
    lastVisitAt: "",
    scopeLevel: Object.fromEntries(SCOPES.map(s => [s, "متوسط"])),
    scopeIncluded: Object.fromEntries(SCOPES.map(s => [s, s !== "الفرش والأثاث"])),
    itemLevel: {},      // { [itemName]: level } — overrides the scope's default level for one specific item
    itemIncluded: {},   // { [itemName]: boolean } — overrides the scope's include/exclude for one item
    itemQty: {},        // { [itemName]: number } — overrides the formula-computed quantity for one item
    itemPrice: {},       // { [itemName]: number } — overrides the catalogue unit price (market price changed)
    itemPriceDate: {},   // { [itemName]: "YYYY-MM-DD" } — when that price override was set, for audit purposes
  };
}

/* Resolve one catalogue item's effective state for a given client — this is the single
   source of truth used everywhere (live totals, the editable BOQ table, and every export)
   so per-item overrides always stay consistent across the whole app. */
function resolveItem(client, item, area) {
  const [scope, name, unit, qtyFn, prices] = item;
  const itemIncluded = client.itemIncluded || {};
  const itemLevel = client.itemLevel || {};
  const itemQty = client.itemQty || {};
  const itemPrice = client.itemPrice || {};
  const itemPriceDate = client.itemPriceDate || {};
  const included = Object.prototype.hasOwnProperty.call(itemIncluded, name)
    ? itemIncluded[name] : client.scopeIncluded[scope];
  const level = itemLevel[name] || client.scopeLevel[scope] || "متوسط";
  const levelIdx = LEVELS.indexOf(level);
  const hasQtyOverride = Object.prototype.hasOwnProperty.call(itemQty, name) && itemQty[name] !== "" && itemQty[name] !== null && itemQty[name] !== undefined;
  const qty = hasQtyOverride ? Number(itemQty[name]) : qtyFn(area);
  const basePrice = prices[levelIdx];
  const hasPriceOverride = Object.prototype.hasOwnProperty.call(itemPrice, name) && itemPrice[name] !== "" && itemPrice[name] !== null && itemPrice[name] !== undefined;
  const price = hasPriceOverride ? Number(itemPrice[name]) : basePrice;
  return {
    scope, name, unit, included, level, levelIdx, qty, price, basePrice,
    total: included ? qty * price : 0,
    hasQtyOverride, hasPriceOverride, isCustomLevel: !!itemLevel[name],
    priceDate: itemPriceDate[name] || "",
  };
}

/* ============================= Site visit log (work-progress tracking) ============================= */
function newVisit(clientId) {
  return {
    id: "v" + Date.now() + Math.floor(Math.random() * 1000),
    clientId,
    date: new Date().toISOString().slice(0, 10),
    engineer: "",
    percent: 0,
    notes: "",
    photoLink: "",
    createdAt: new Date().toISOString(),
  };
}
async function loadVisits(clientId) {
  const keys = await storageListKeys(`visit:${clientId}:`);
  const visits = [];
  for (const k of keys) {
    const v = await storageGet(k, null);
    if (v) visits.push(v);
  }
  visits.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  return visits;
}
async function saveVisit(visit) {
  await storageSet(`visit:${visit.clientId}:${visit.id}`, visit);
}
async function deleteVisitEntry(clientId, id) {
  await storageDelete(`visit:${clientId}:${id}`);
}

/* ============================= Payment schedule (mirrors office contract) ============================= */
const PAYMENT_STAGES = [
  { pct: 0.20, label: "دفعة مقدمة عند توقيع العقد" },
  { pct: 0.20, label: "بعد استلام الخامات وبدء أعمال الهدم والبناء" },
  { pct: 0.30, label: "بعد الانتهاء من التشطيبات الأساسية (أرضيات، حوائط، أسقف)" },
  { pct: 0.20, label: "بعد الانتهاء من التركيبات النهائية (أبواب، كهرباء، سباكة، مطبخ وحمامات)" },
  { pct: 0.10, label: "عند التسليم النهائي والمعاينة المشتركة" },
];

function rtlP(opts) { return new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, ...opts }); }
function rtlR(text, opts = {}) { return new TextRun({ text, rightToLeft: true, font: "Arial", ...opts }); }
function docH1(text) {
  return rtlP({
    spacing: { before: 320, after: 150 },
    shading: { type: ShadingType.CLEAR, fill: "1F4E78" },
    children: [rtlR(text, { bold: true, color: "FFFFFF", size: 24 })],
  });
}
function docBody(text, opts = {}) {
  return rtlP({ spacing: { after: 160 }, children: [rtlR(text, { size: 21, ...opts })] });
}
function docCell(text, w, opts = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [rtlP({ alignment: opts.align || AlignmentType.RIGHT, children: [rtlR(text, { size: 20, bold: !!opts.bold, color: opts.color || "000000" })] })],
  });
}
const DOC_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  left: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  right: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
  insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D8DEE7" },
};
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 850;
const CONTENT_W = PAGE_W - 2 * MARGIN;

function generateContractDocx(client, calc) {
  const today = new Date().toLocaleDateString("ar-EG");
  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "BF9000" } },
    children: [rtlR("عقد تنفيذ أعمال تشطيب وديكور", { bold: true, size: 38, color: "1F4E78" })],
  }));

  children.push(docH1("أطراف التعاقد"));
  children.push(docBody(`إنه في يوم ${today}، تم الاتفاق بين كل من:`));
  children.push(docBody('الطرف الأول: مكتب __________ للاستشارات المعمارية (ويشار إليه بـ "المكتب").', { bold: true }));
  children.push(docBody(`الطرف الثاني: ${client.name || "__________"}، مقيم بـ ${client.address || "__________"} (ويشار إليه بـ "العميل").`, { bold: true }));

  children.push(docH1("أولاً: نطاق العمل"));
  children.push(docBody(`يلتزم المكتب بتنفيذ أعمال التصميم والتشطيب لشقة العميل بمساحة تقريبية ${client.area} م²، وفقاً للمقايسة التفصيلية المعتمدة والموقعة من الطرفين والمرفقة بهذا العقد.`));

  children.push(docH1("ثانياً: قيمة العقد"));
  children.push(docBody(`القيمة الإجمالية لهذا العقد شاملة الضريبة: ${fmt(calc.grandTotal)} جنيهاً مصرياً.`, { bold: true }));

  children.push(docH1("ثالثاً: جدول الدفعات"));
  const w = [Math.round(CONTENT_W * 0.08), Math.round(CONTENT_W * 0.50), Math.round(CONTENT_W * 0.14), 0];
  w[3] = CONTENT_W - w[0] - w[1] - w[2];
  const payRows = PAYMENT_STAGES.map((p, i) => new TableRow({ children: [
    docCell(String(i + 1), w[0], { align: AlignmentType.CENTER, bold: true, fill: i % 2 ? "FFFFFF" : "F5F7FA" }),
    docCell(p.label, w[1], { fill: i % 2 ? "FFFFFF" : "F5F7FA" }),
    docCell((p.pct * 100).toFixed(0) + "%", w[2], { align: AlignmentType.CENTER, bold: true, fill: i % 2 ? "FFFFFF" : "F5F7FA" }),
    docCell(fmt(calc.grandTotal * p.pct) + " ج.م", w[3], { align: AlignmentType.CENTER, fill: i % 2 ? "FFFFFF" : "F5F7FA" }),
  ]}));
  children.push(new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: w,
    borders: DOC_BORDERS,
    rows: [
      new TableRow({ tableHeader: true, children: [
        docCell("م", w[0], { fill: "1F4E78", bold: true, color: "FFFFFF", align: AlignmentType.CENTER }),
        docCell("المرحلة", w[1], { fill: "1F4E78", bold: true, color: "FFFFFF" }),
        docCell("النسبة", w[2], { fill: "1F4E78", bold: true, color: "FFFFFF", align: AlignmentType.CENTER }),
        docCell("القيمة", w[3], { fill: "1F4E78", bold: true, color: "FFFFFF", align: AlignmentType.CENTER }),
      ]}),
      ...payRows,
    ],
  }));
  children.push(new Paragraph({ spacing: { before: 150 }, children: [] }));
  children.push(docBody("تُسدد كل دفعة خلال مدة أقصاها 3 أيام عمل من تاريخ إخطار العميل باكتمال المرحلة المرتبطة بها.", { italics: true, color: "6B7280" }));

  children.push(docH1("رابعاً: مدة التنفيذ"));
  children.push(docBody("مدة التنفيذ الإجمالية __________ يوم عمل من تاريخ استلام الموقع وتحصيل الدفعة المقدمة."));

  children.push(docH1("خامساً: الضمانات وفسخ العقد"));
  children.push(docBody("يلتزم المكتب بضمان أعمال التنفيذ وفقاً للمدد الموضحة في نموذج الاستلام والتسليم النهائي المرفق. يحق لأي من الطرفين فسخ هذا العقد في حال إخلال الطرف الآخر بأي من بنوده الجوهرية بعد إنذار كتابي ومهلة 15 يوماً لتصحيح الوضع."));

  children.push(new Paragraph({ spacing: { before: 400 }, children: [] }));
  const half = Math.round(CONTENT_W / 2);
  children.push(new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [half, CONTENT_W - half],
    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: half, type: WidthType.DXA }, children: [
        rtlP({ children: [rtlR("الطرف الأول (المكتب)", { bold: true, size: 21 })] }),
        rtlP({ spacing: { before: 400 }, children: [rtlR("الاسم: __________", { size: 21 })] }),
        rtlP({ spacing: { before: 200 }, children: [rtlR("التوقيع: __________", { size: 21 })] }),
      ]}),
      new TableCell({ width: { size: CONTENT_W - half, type: WidthType.DXA }, children: [
        rtlP({ children: [rtlR("الطرف الثاني (العميل)", { bold: true, size: 21 })] }),
        rtlP({ spacing: { before: 400 }, children: [rtlR(`الاسم: ${client.name || "__________"}`, { size: 21 })] }),
        rtlP({ spacing: { before: 200 }, children: [rtlR("التوقيع: __________", { size: 21 })] }),
      ]}),
    ]})],
  }));

  return new Document({
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [rtlR("عقد تنفيذ أعمال تشطيب وديكور", { size: 16, color: "6B7280" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["صفحة ", PageNumber.CURRENT, " من ", PageNumber.TOTAL_PAGES], size: 16, color: "6B7280", font: "Arial" })] })] }) },
      children,
    }],
  });
}

async function downloadDocx(filename, doc) {
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

/* ============================= Live PPTX generation =============================
   Generates a presentation directly from the current client + catalogue data, every
   time it's requested — so it can never drift out of sync with the system's numbers. */
const MOOD = {
  "اقتصادي": { floor: "E5E0D8", floorVein: "CFC8BC", wall: "D9D9D9", wood: "C9A876", woodGrain: "B08F5C", metal: "B0B0B0", metalAccent: "8C8C8C", texture: "tile" },
  "متوسط": { floor: "D8C9B0", floorVein: "C0AD8A", wall: "6E97A8", wood: "A97C50", woodGrain: "8A6038", metal: "C9A227", metalAccent: "A9861B", texture: "tile" },
  "لوكس": { floor: "EDEAE3", floorVein: "C9A227", wall: "2E4A66", wood: "6B4226", woodGrain: "4A2C18", metal: "D4AF37", metalAccent: "A9861B", texture: "marble" },
  "سوبر لوكس": { floor: "2B2B2B", floorVein: "BF9000", wall: "17181A", wood: "3E2723", woodGrain: "241512", metal: "E8C86E", metalAccent: "BF9000", texture: "marble" },
};

function pptxMoodPanel(s, x, y, w, h, levelKey, accentColor) {
  const m = MOOD[levelKey];
  s.addShape("roundRect", { x, y, w, h, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: accentColor, width: 2 } });
  const rows = [
    { label: "الأرضيات", color: m.floor, vein: m.floorVein, kind: m.texture },
    { label: "الحوائط", color: m.wall, vein: null, kind: "solid" },
    { label: "الأبواب والأخشاب", color: m.wood, vein: m.woodGrain, kind: "wood" },
    { label: "التجهيزات والإضاءة", color: m.metal, vein: m.metalAccent, kind: "metal" },
  ];
  const padTop = 0.15, gap = 0.1;
  const rowH = (h - padTop - 0.1 - gap * 3) / 4;
  let ry = y + padTop;
  rows.forEach((row) => {
    const rx = x + 0.12, rw = w - 0.24;
    s.addShape("roundRect", { x: rx, y: ry, w: rw, h: rowH, rectRadius: 0.04, fill: { color: row.color }, line: { color: "E3E7EE", width: 0.5 } });
    if (row.kind === "tile") {
      for (let i = 1; i < 4; i++) s.addShape("line", { x: rx + (rw / 4) * i, y: ry, w: 0, h: rowH, line: { color: row.vein, width: 0.75, transparency: 30 } });
      s.addShape("line", { x: rx, y: ry + rowH / 2, w: rw, h: 0, line: { color: row.vein, width: 0.75, transparency: 30 } });
    } else if (row.kind === "marble") {
      s.addShape("line", { x: rx + rw * 0.1, y: ry + rowH * 0.15, w: rw * 0.6, h: rowH * 0.55, line: { color: row.vein, width: 1.25, transparency: 15 } });
      s.addShape("line", { x: rx + rw * 0.35, y: ry + rowH * 0.75, w: rw * 0.45, h: -rowH * 0.5, line: { color: row.vein, width: 1, transparency: 30 } });
    } else if (row.kind === "wood") {
      for (let i = 1; i < 4; i++) s.addShape("line", { x: rx, y: ry + (rowH / 4) * i, w: rw, h: 0, line: { color: row.vein, width: 0.75, transparency: 35 } });
    } else if (row.kind === "metal") {
      for (let i = 0; i < 3; i++) s.addShape("ellipse", { x: rx + 0.08 + i * (rw / 3), y: ry + rowH * 0.2, w: rowH * 0.6, h: rowH * 0.6, fill: { color: row.vein, transparency: 55 }, line: { type: "none" } });
    }
    s.addText(row.label, { x: rx, y: ry + rowH - 0.24, w: rw, h: 0.22, fontFace: "Arial", fontSize: 8, bold: true, color: row.kind === "metal" || levelKey === "سوبر لوكس" ? "FFFFFF" : "1F1F1F", align: "center", valign: "bottom", rtlMode: true });
    ry += rowH + gap;
  });
}

async function buildAndDownloadClientPptx(client, calc, settings) {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE";
  p.rtlMode = true;
  const NAVY_ = "1F4E78", NAVY_DARK_ = "132E45", GOLD_ = "BF9000", LIGHT_ = "F5F7FA", MUTED_ = "6B7280";
  const LEVEL_COLOR = { "اقتصادي": "6B7280", "متوسط": "2E5395", "لوكس": "BF9000", "سوبر لوكس": "1F1F1F" };

  // Slide 1 — Cover
  {
    const s = p.addSlide();
    s.background = { color: NAVY_ };
    s.addShape("ellipse", { x: 9.8, y: -2.2, w: 7, h: 7, fill: { color: NAVY_DARK_ }, line: { type: "none" } });
    s.addText(`عرض تشطيب مخصص`, { x: 1, y: 2.5, w: 11.33, h: 1, fontFace: "Arial", fontSize: 34, bold: true, color: "FFFFFF", align: "center", rtlMode: true });
    s.addText(client.name || "عميل", { x: 1, y: 3.4, w: 11.33, h: 0.7, fontFace: "Arial", fontSize: 22, color: GOLD_, align: "center", rtlMode: true });
    s.addText(`${client.address || ""}   |   ${client.area} م²   |   ${new Date().toLocaleDateString("ar-EG")}`, { x: 1, y: 4.2, w: 11.33, h: 0.5, fontFace: "Arial", fontSize: 13, italic: true, color: "D9E1F2", align: "center", rtlMode: true });
    s.addText("مكتب __________ للاستشارات المعمارية", { x: 1, y: 6.6, w: 11.33, h: 0.4, fontFace: "Arial", fontSize: 11, color: "AEB9C6", align: "center", rtlMode: true });
  }

  // Slide 2 — Chosen level per scope
  {
    const s = p.addSlide();
    s.background = { color: LIGHT_ };
    s.addText("المستوى المختار لكل نطاق عمل", { x: 0.6, y: 0.4, w: 12, h: 0.55, fontFace: "Arial", fontSize: 24, bold: true, color: NAVY_, align: "right", rtlMode: true });
    let y = 1.4;
    SCOPES.forEach((scope) => {
      const included = client.scopeIncluded[scope];
      const level = client.scopeLevel[scope] || "متوسط";
      const color = included ? LEVEL_COLOR[level] : "9CA3AF";
      s.addShape("roundRect", { x: 0.6, y, w: 12.1, h: 0.68, rectRadius: 0.05, fill: { color: "FFFFFF" }, line: { color: "E3E7EE", width: 1 } });
      s.addShape("roundRect", { x: 0.6, y, w: 0.09, h: 0.68, fill: { color }, line: { type: "none" } });
      s.addText(scope, { x: 6.6, y: y + 0.05, w: 5.9, h: 0.58, fontFace: "Arial", fontSize: 13, bold: true, color: "1F2937", align: "right", rtlMode: true, valign: "middle" });
      s.addShape("roundRect", { x: 4.9, y: y + 0.12, w: 1.5, h: 0.44, rectRadius: 0.06, fill: { color }, line: { type: "none" } });
      s.addText(included ? level : "غير مُضمَّن", { x: 4.9, y: y + 0.12, w: 1.5, h: 0.44, fontFace: "Arial", fontSize: 11, bold: true, color: "FFFFFF", align: "center", valign: "middle", rtlMode: true });
      s.addText(included ? `${fmt(calc.byScope[scope])} ج.م` : "—", { x: 0.75, y: y + 0.05, w: 3.9, h: 0.58, fontFace: "Arial", fontSize: 13, bold: true, color: NAVY_, align: "left", valign: "middle" });
      y += 0.85;
    });
  }

  // Slide 3 — Mood board reference for the levels actually chosen (unique set)
  {
    const s = p.addSlide();
    s.background = { color: LIGHT_ };
    s.addText("لوحة الخامات الاستدلالية للمستويات المختارة", { x: 0.6, y: 0.4, w: 12, h: 0.55, fontFace: "Arial", fontSize: 22, bold: true, color: NAVY_, align: "right", rtlMode: true });
    const chosenLevels = [...new Set(SCOPES.filter(s2 => client.scopeIncluded[s2]).map(s2 => client.scopeLevel[s2] || "متوسط"))];
    const list = chosenLevels.length ? chosenLevels : ["متوسط"];
    const panelW = 2.9, gap = 0.25, startX = (13.33 - (list.length * panelW + (list.length - 1) * gap)) / 2, panelY = 1.5, panelH = 5.0;
    list.forEach((lv, i) => {
      const x = startX + i * (panelW + gap);
      s.addText(lv, { x, y: panelY - 0.4, w: panelW, h: 0.35, fontFace: "Arial", fontSize: 14, bold: true, color: LEVEL_COLOR[lv], align: "center", rtlMode: true });
      pptxMoodPanel(s, x, panelY, panelW, panelH, lv, LEVEL_COLOR[lv]);
    });
  }

  // Slide 4 — Price summary
  {
    const s = p.addSlide();
    s.background = { color: NAVY_ };
    s.addText("ملخص السعر النهائي", { x: 0.6, y: 0.5, w: 12, h: 0.6, fontFace: "Arial", fontSize: 26, bold: true, color: "FFFFFF", align: "right", rtlMode: true });
    const lines = [
      ["إجمالي بنود التنفيذ", calc.execTotal],
      ["أتعاب الإشراف الهندسي", calc.supervision],
      ["احتياطي أعمال غير منظورة", calc.contingency],
      ["التصميم", calc.byScope["تصميم"]],
      ["الفرش والأثاث", calc.byScope["الفرش والأثاث"]],
      ["ضريبة القيمة المضافة", calc.vat],
    ];
    let y = 1.5;
    lines.forEach(([label, val]) => {
      s.addText(label, { x: 0.8, y, w: 7, h: 0.45, fontFace: "Arial", fontSize: 14, color: "D9E1F2", align: "right", rtlMode: true });
      s.addText(fmt(val) + " ج.م", { x: 8, y, w: 4.5, h: 0.45, fontFace: "Arial", fontSize: 14, bold: true, color: "FFFFFF", align: "left" });
      y += 0.55;
    });
    s.addShape("roundRect", { x: 0.8, y: y + 0.2, w: 11.7, h: 0.9, rectRadius: 0.08, fill: { color: GOLD_ }, line: { type: "none" } });
    s.addText("الإجمالي النهائي المستحق", { x: 1, y: y + 0.2, w: 7, h: 0.9, fontFace: "Arial", fontSize: 17, bold: true, color: "1F1F1F", align: "right", valign: "middle", rtlMode: true });
    s.addText(fmt(calc.grandTotal) + " ج.م", { x: 8, y: y + 0.2, w: 4.3, h: 0.9, fontFace: "Arial", fontSize: 20, bold: true, color: "1F1F1F", align: "left", valign: "middle" });
  }

  await p.writeFile({ fileName: `عرض_${client.name || "عميل"}.pptx` });
}

/* ============================= Calculation ============================= */
function calcClient(client, settings) {
  const area = Number(client.area) || 0;
  const byScope = {};
  SCOPES.forEach(s => (byScope[s] = 0));
  ITEMS.forEach((item) => {
    const r = resolveItem(client, item, area);
    byScope[r.scope] += r.total;
  });
  const execScopes = ["تعديلات معمارية (هدم وبناء)", "التشطيبات المعمارية والتنفيذ", "الكهرباء", "السباكة والتكييف"];
  const execTotal = execScopes.reduce((sum, s) => sum + byScope[s], 0);
  const supervision = execTotal * settings.supervisionPct;
  const contingency = (execTotal + supervision) * settings.contingencyPct;
  const execWithExtras = execTotal + supervision + contingency;
  const subtotal = execWithExtras + byScope["تصميم"] + byScope["الفرش والأثاث"];
  const vat = subtotal * settings.vatPct;
  const grandTotal = subtotal + vat;
  return { byScope, execTotal, supervision, contingency, execWithExtras, subtotal, vat, grandTotal };
}

/* ============================= Excel styling constants (ExcelJS) ============================= */
const XL_NAVY = "FF1F4E78";
const XL_GOLD = "FFBF9000";
const XL_LIGHT = "FFF5F7FA";
const XL_WHITE = "FFFFFFFF";
const XL_BORDER_COLOR = "FFD8DEE7";
const xlThinBorder = { style: "thin", color: { argb: XL_BORDER_COLOR } };
const xlAllBorders = { top: xlThinBorder, bottom: xlThinBorder, left: xlThinBorder, right: xlThinBorder };

function xlHeaderCell(cell, text) {
  cell.value = text;
  cell.font = { name: "Arial", bold: true, color: { argb: XL_WHITE }, size: 11 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = xlAllBorders;
}
function xlDataCell(cell, value, opts = {}) {
  cell.value = value;
  cell.font = { name: "Arial", bold: !!opts.bold, color: { argb: opts.color || "FF1F2937" }, size: 10.5 };
  if (opts.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
  cell.alignment = { horizontal: opts.align || "right", vertical: "middle", wrapText: true };
  cell.border = xlAllBorders;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}
async function saveWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: "application/octet-stream" }), filename);
}

async function exportFullBOQ(client, settings) {
  const calc = calcClient(client, settings);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("المقايسة التفصيلية", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 4 }, { width: 40 }, { width: 9 }, { width: 9 },
    { width: 12 }, { width: 12 }, { width: 9 }, { width: 13 }, { width: 34 },
  ];

  ws.mergeCells("A1:I1");
  const title = ws.getCell("A1");
  title.value = `المقايسة التفصيلية — ${client.name || "عميل"}`;
  title.font = { name: "Arial", bold: true, size: 15, color: { argb: XL_WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:I2");
  const sub = ws.getCell("A2");
  sub.value = `العنوان: ${client.address || "—"}    |    المساحة: ${client.area} م²    |    التاريخ: ${new Date().toLocaleDateString("ar-EG")}    |    * = بند بمستوى/كمية/سعر مخصص يدويًا`;
  sub.font = { name: "Arial", italic: true, size: 10, color: { argb: "FF6B7280" } };
  sub.alignment = { horizontal: "center" };

  const headerRow = 4;
  const headers = ["م", "البند", "الوحدة", "الكمية", "المستوى المطبق", "سعر الوحدة", "مُضمَّن؟", "الإجمالي (ج.م)", "المواصفة / النوع المقترح"];
  headers.forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 22;

  const SCOPE_FILL = {
    "تصميم": "FF7030A0",
    "تعديلات معمارية (هدم وبناء)": "FF833C00",
    "التشطيبات المعمارية والتنفيذ": "FF1F4E78",
    "الكهرباء": "FFBF9000",
    "السباكة والتكييف": "FF0B5394",
    "الفرش والأثاث": "FF38761D",
  };

  let r = headerRow + 1;
  let idx = 1;
  let currentScope = null;
  const firstDataRow = r;
  const scopeSubtotalRows = [];
  let scopeRunningTotal = 0;
  let scopeStartRow = r;

  const closeScopeIfOpen = () => {
    if (currentScope === null) return;
    ws.mergeCells(`A${r}:G${r}`);
    const lc = ws.getCell(`A${r}`);
    lc.value = `إجمالي — ${currentScope}`;
    lc.font = { name: "Arial", bold: true, size: 10.5, color: { argb: "FF1F2937" } };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F7" } };
    lc.alignment = { horizontal: "right", vertical: "middle" };
    ws.mergeCells(`H${r}:I${r}`);
    const vc = ws.getCell(`H${r}`);
    vc.value = Math.round(scopeRunningTotal);
    vc.numFmt = '#,##0 "ج.م"';
    vc.font = { name: "Arial", bold: true, size: 10.5 };
    vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F7" } };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    r++;
  };

  ITEMS.forEach((item) => {
    const [scope, name, unit] = item;
    if (scope !== currentScope) {
      closeScopeIfOpen();
      scopeRunningTotal = 0;
      currentScope = scope;
      ws.mergeCells(`A${r}:I${r}`);
      const hc = ws.getCell(`A${r}`);
      hc.value = `◆ ${scope}`;
      hc.font = { name: "Arial", bold: true, size: 11, color: { argb: XL_WHITE } };
      hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SCOPE_FILL[scope] || XL_NAVY } };
      hc.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      ws.getRow(r).height = 20;
      r++;
    }

    const resolved = resolveItem(client, item, Number(client.area) || 0);
    const { included, level, levelIdx, qty, price } = resolved;
    const total = Math.round(resolved.total);
    if (included) scopeRunningTotal += total;
    const fill = idx % 2 ? XL_WHITE : XL_LIGHT;
    const spec = SPECS[name] ? SPECS[name][levelIdx] : "—";
    const row = ws.getRow(r);
    xlDataCell(row.getCell(1), idx, { fill, align: "center" });
    xlDataCell(row.getCell(2), name + (resolved.isCustomLevel || resolved.hasQtyOverride || resolved.hasPriceOverride ? " *" : ""), { fill });
    xlDataCell(row.getCell(3), unit, { fill, align: "center" });
    xlDataCell(row.getCell(4), Math.round(qty * 100) / 100, { fill, align: "center" });
    xlDataCell(row.getCell(5), level, { fill, align: "center" });
    xlDataCell(row.getCell(6), price, { fill, align: "center", numFmt: "#,##0" });
    xlDataCell(row.getCell(7), included ? "نعم" : "لا", { fill, align: "center", bold: true, color: included ? "FF1E7B45" : "FFC00000" });
    xlDataCell(row.getCell(8), total, { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
    xlDataCell(row.getCell(9), spec, { fill: "FFFFF7E6", color: "FF1F4E78" });
    idx++; r++;
  });
  closeScopeIfOpen();
  const lastDataRow = r - 1;

  const summaryLines = [
    ["إجمالي بنود التنفيذ", calc.execTotal],
    ["أتعاب الإشراف الهندسي", calc.supervision],
    ["احتياطي أعمال غير منظورة", calc.contingency],
    ["الإجمالي قبل الضريبة", calc.subtotal],
    ["ضريبة القيمة المضافة", calc.vat],
  ];
  r += 1;
  summaryLines.forEach(([label, val]) => {
    ws.mergeCells(`A${r}:G${r}`);
    const lc = ws.getCell(`A${r}`);
    lc.value = label;
    lc.font = { name: "Arial", bold: true, size: 11, color: { argb: "FF1F4E78" } };
    lc.alignment = { horizontal: "right", vertical: "middle" };
    ws.mergeCells(`H${r}:I${r}`);
    const vc = ws.getCell(`H${r}`);
    vc.value = Math.round(val);
    vc.numFmt = '#,##0 "ج.م"';
    vc.font = { name: "Arial", bold: true, size: 11 };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    r++;
  });

  ws.mergeCells(`A${r}:G${r}`);
  const fl = ws.getCell(`A${r}`);
  fl.value = "الإجمالي النهائي المستحق";
  fl.font = { name: "Arial", bold: true, size: 13, color: { argb: XL_WHITE } };
  fl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_GOLD } };
  fl.alignment = { horizontal: "right", vertical: "middle" };
  ws.mergeCells(`H${r}:I${r}`);
  const fv = ws.getCell(`H${r}`);
  fv.value = Math.round(calc.grandTotal);
  fv.numFmt = '#,##0 "ج.م"';
  fv.font = { name: "Arial", bold: true, size: 13, color: { argb: XL_WHITE } };
  fv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_GOLD } };
  fv.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 24;

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastDataRow, column: 9 } };

  await saveWorkbook(wb, `مقايسة_كاملة_${client.name || "عميل"}.xlsx`);
}

async function exportPipelineSummary(clients, settings) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ملخص كل العملاء", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { width: 22 }, { width: 15 }, { width: 28 }, { width: 10 },
    { width: 14 }, { width: 17 }, { width: 12 },
  ];
  ws.mergeCells("A1:G1");
  const title = ws.getCell("A1");
  title.value = "ملخص خط عملاء المكتب";
  title.font = { name: "Arial", bold: true, size: 15, color: { argb: XL_WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  const headerRow = 3;
  const headers = ["اسم العميل", "الهاتف", "العنوان", "المساحة (م²)", "المرحلة", "الإجمالي النهائي (ج.م)", "تاريخ الإضافة"];
  headers.forEach((h, i) => xlHeaderCell(ws.getRow(headerRow).getCell(i + 1), h));
  ws.getRow(headerRow).height = 22;

  const stageFill = {
    "عميل محتمل": "FF9CA3AF", "قيد التصميم": "FF2E5395", "تم التعاقد": "FFBF9000",
    "قيد التنفيذ": "FFC2410C", "تم التسليم": "FF1E7B45",
  };

  let r = headerRow + 1;
  let totalAll = 0;
  clients.forEach((c, i) => {
    const calc = calcClient(c, settings);
    totalAll += calc.grandTotal;
    const fill = i % 2 ? XL_WHITE : XL_LIGHT;
    const row = ws.getRow(r);
    xlDataCell(row.getCell(1), c.name || "بدون اسم", { fill, bold: true });
    xlDataCell(row.getCell(2), c.phone || "", { fill, align: "center" });
    xlDataCell(row.getCell(3), c.address || "", { fill });
    xlDataCell(row.getCell(4), Number(c.area) || 0, { fill, align: "center" });
    xlDataCell(row.getCell(5), c.stage, { fill, align: "center", bold: true, color: stageFill[c.stage] || "FF1F2937" });
    xlDataCell(row.getCell(6), Math.round(calc.grandTotal), { fill, align: "center", bold: true, numFmt: '#,##0 "ج.م"' });
    xlDataCell(row.getCell(7), c.createdAt || "", { fill, align: "center" });
    r++;
  });

  ws.mergeCells(`A${r}:E${r}`);
  const fl = ws.getCell(`A${r}`);
  fl.value = "إجمالي قيمة خط الأعمال بالكامل";
  fl.font = { name: "Arial", bold: true, size: 12, color: { argb: XL_WHITE } };
  fl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_GOLD } };
  fl.alignment = { horizontal: "right", vertical: "middle" };
  ws.mergeCells(`F${r}:G${r}`);
  const fv = ws.getCell(`F${r}`);
  fv.value = Math.round(totalAll);
  fv.numFmt = '#,##0 "ج.م"';
  fv.font = { name: "Arial", bold: true, size: 12, color: { argb: XL_WHITE } };
  fv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_GOLD } };
  fv.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 22;

  ws.views = [{ state: "frozen", ySplit: headerRow, rightToLeft: true }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: r - 1, column: 7 } };

  await saveWorkbook(wb, "ملخص_خط_العملاء.xlsx");
}

/* ============================= Excel control hub ============================= */
function ExcelHub({ clients, settings, onUpdate }) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");

  const visible = useMemo(() => {
    let list = clients.filter(c => !query.trim() ||
      (c.name || "").toLowerCase().includes(query.trim().toLowerCase()) ||
      (c.engineer || "").toLowerCase().includes(query.trim().toLowerCase()));
    const calcOf = (c) => calcClient(c, settings).grandTotal;
    switch (sortBy) {
      case "value_desc": list = [...list].sort((a, b) => calcOf(b) - calcOf(a)); break;
      case "value_asc": list = [...list].sort((a, b) => calcOf(a) - calcOf(b)); break;
      case "progress_desc": list = [...list].sort((a, b) => (b.progressPercent || 0) - (a.progressPercent || 0)); break;
      case "name_asc": list = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar")); break;
      default: list = [...list].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    }
    return list;
  }, [clients, query, sortBy, settings]);

  const SortHeader = ({ label, sortKey }) => (
    <th className="p-3 text-center font-bold">
      <button onClick={() => setSortBy(sortKey)} className="inline-flex items-center gap-1 hover:opacity-80">
        {label}
        <ChevronDown size={12} style={{ opacity: sortBy === sortKey ? 1 : 0.4 }} />
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold" style={{ color: NAVY }}>لوحة تحكم إكسل — كل ملفات كل عميل في مكان واحد</h2>
          <p className="mt-1 text-xs" style={{ color: MUTED }}>مقايسة Excel كاملة، رابط مجلد الملفات (العقد والعرض التقديمي ونموذج التسليم)، وتصدير ملخص شامل.</p>
        </div>
        <button onClick={() => exportPipelineSummary(clients, settings)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white shadow-sm" style={{ backgroundColor: NAVY }}>
          <Download size={16} /> تصدير ملخص كل العملاء
        </button>
      </div>

      {clients.length > 0 && (
        <div className="mb-3">
          <input
            placeholder="بحث بالاسم أو المهندس المسؤول..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full max-w-sm rounded-lg py-2 px-3 text-sm"
            style={{ border: `1px solid ${BORDER}` }}
          />
        </div>
      )}

      {clients.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ backgroundColor: "#FFFFFF", border: `1px dashed ${BORDER}`, color: MUTED }}>
          لا يوجد عملاء بعد.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: NAVY, color: "#FFFFFF" }}>
                <SortHeader label="العميل" sortKey="name_asc" />
                <th className="p-3 text-center font-bold">المهندس المسؤول</th>
                <SortHeader label="التقدم بالموقع" sortKey="progress_desc" />
                <th className="p-3 text-center font-bold">المرحلة</th>
                <SortHeader label="الإجمالي" sortKey="value_desc" />
                <th className="p-3 text-center font-bold">المقايسة</th>
                <th className="p-3 text-center font-bold">العرض التقديمي</th>
                <th className="p-3 text-center font-bold">العقد</th>
                <th className="p-3 text-right font-bold">رابط مجلد الملفات</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => {
                const calc = calcClient(c, settings);
                const contractReady = c.stage === "تم التعاقد" || c.stage === "قيد التنفيذ" || c.stage === "تم التسليم";
                return (
                  <tr key={c.id} style={{ backgroundColor: i % 2 ? "#FFFFFF" : LIGHT, borderTop: `1px solid ${BORDER}` }}>
                    <td className="p-3 font-semibold">{c.name || "بدون اسم"}</td>
                    <td className="p-3 text-center text-xs" style={{ color: MUTED }}>{c.engineer || "—"}</td>
                    <td className="p-3 text-center">
                      {c.progressPercent > 0 ? (
                        <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: "#E2EFDA", color: "#1E7B45" }}>{c.progressPercent}%</span>
                      ) : (
                        <span className="text-xs" style={{ color: MUTED }}>—</span>
                      )}
                    </td>
                    <td className="p-3 text-center"><Badge text={c.stage} color={STAGE_COLORS[c.stage] || MUTED} /></td>
                    <td className="p-3 text-center font-bold" style={{ color: NAVY }}>{fmt(calc.grandTotal)} ج.م</td>
                    <td className="p-3 text-center">
                      <button onClick={() => exportFullBOQ(c, settings)} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "#E2EFDA", color: "#1E7B45" }}>
                        <FileSpreadsheet size={13} /> تحميل
                      </button>
                    </td>
                    <td className="p-3 text-center">
                      <button onClick={() => buildAndDownloadClientPptx(c, calc, settings)} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "#DCE6F5", color: "#2E5395" }}>
                        <FileText size={13} /> تحميل
                      </button>
                    </td>
                    <td className="p-3 text-center">
                      {contractReady ? (
                        <button onClick={() => downloadDocx(`عقد_${c.name || "عميل"}.docx`, generateContractDocx(c, calc))} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ backgroundColor: "#FCE9B5", color: "#8A6D00" }}>
                          <FileText size={13} /> تحميل العقد
                        </button>
                      ) : (
                        <span className="text-xs" style={{ color: MUTED }}>بعد التعاقد</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={c.folderLink || ""}
                          onChange={e => onUpdate(c.id, { folderLink: e.target.value })}
                          placeholder="الصق رابط مجلد Google Drive هنا"
                          className="flex-1 rounded-md px-2 py-1.5 text-xs"
                          style={{ border: `1px solid ${BORDER}` }}
                        />
                        {c.folderLink && (
                          <a href={c.folderLink} target="_blank" rel="noreferrer" style={{ color: NAVY }}>
                            <ExternalLink size={15} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-xl p-4 text-xs leading-6" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}`, color: MUTED }}>
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>
          "المقايسة الكاملة" تُصدَّر بنفس الـ 44 بندًا المستخدمة في ملف المكتب الأساسي، بأسعار ومستويات هذا العميل تحديدًا.
          "العقد" يظهر تلقائيًا للتحميل بمجرد وصول العميل لمرحلة "تم التعاقد" من تبويب العملاء، ويكون مملوءًا بجدول الدفعات الفعلي المحسوب من إجمالي سعره.
          رابط مجلد الملفات مكان تخزّن فيه نسخ العرض التقديمي واستمارة التفضيلات ونموذج التسليم الخاصة بهذا العميل (Google Drive أو أي مساحة تخزين تستخدمها).
        </span>
      </div>
    </div>
  );
}

function Badge({ text, color }) {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ backgroundColor: color + "1A", color }}>
      {text}
    </span>
  );
}

function StatCard({ label, value, sub, accent, icon: Icon }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold" style={{ color: MUTED }}>{label}</div>
          <div className="mt-1 text-2xl font-bold" style={{ color: accent || NAVY }}>{value}</div>
          {sub && <div className="mt-0.5 text-xs" style={{ color: MUTED }}>{sub}</div>}
        </div>
        {Icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: (accent || NAVY) + "1A" }}>
            <Icon size={18} style={{ color: accent || NAVY }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================= Lightweight SVG charts (no extra dependency) ============================= */
function StageValueChart({ stats }) {
  const maxVal = Math.max(1, ...STAGES.map(s => stats.byStage[s].value));
  const barH = 26, gap = 14, leftW = 130, chartW = 420, topPad = 6;
  const height = STAGES.length * (barH + gap) - gap + topPad * 2;
  return (
    <svg viewBox={`0 0 ${leftW + chartW + 70} ${height}`} className="w-full" style={{ maxHeight: 230 }}>
      {STAGES.map((s, i) => {
        const val = stats.byStage[s].value;
        const w = (val / maxVal) * chartW;
        const y = topPad + i * (barH + gap);
        return (
          <g key={s}>
            <text x={leftW - 10} y={y + barH / 2 + 4} textAnchor="end" fontSize="12" fontWeight="700" fill={TEXT} fontFamily="'Cairo', Arial, sans-serif">{s}</text>
            <rect x={leftW} y={y} width={chartW} height={barH} rx={6} fill={LIGHT} />
            <rect x={leftW} y={y} width={Math.max(w, val > 0 ? 6 : 0)} height={barH} rx={6} fill={STAGE_COLORS[s] || NAVY} />
            <text x={leftW + chartW + 12} y={y + barH / 2 + 4} textAnchor="start" fontSize="12" fontWeight="700" fill={NAVY} fontFamily="'Cairo', Arial, sans-serif">
              {val > 0 ? fmt(val) : "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MonthlyTrendChart({ clients, settings }) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("ar-EG", { month: "short" }) });
  }
  const byMonth = Object.fromEntries(months.map(m => [m.key, { count: 0, value: 0 }]));
  clients.forEach(c => {
    const key = (c.createdAt || "").slice(0, 7);
    if (byMonth[key]) {
      byMonth[key].count += 1;
      byMonth[key].value += calcClient(c, settings).grandTotal;
    }
  });
  const maxVal = Math.max(1, ...months.map(m => byMonth[m.key].value));
  const barW = 46, gap = 22, chartH = 150, topPad = 10;
  const width = months.length * (barW + gap) - gap;
  return (
    <svg viewBox={`0 0 ${width} ${chartH + 40}`} className="w-full" style={{ maxHeight: 210 }}>
      {months.map((m, i) => {
        const val = byMonth[m.key].value;
        const h = (val / maxVal) * chartH;
        const x = i * (barW + gap);
        return (
          <g key={m.key}>
            <rect x={x} y={topPad + chartH - h} width={barW} height={Math.max(h, val > 0 ? 4 : 0)} rx={6} fill={GOLD} />
            <text x={x + barW / 2} y={topPad + chartH - h - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill={NAVY} fontFamily="'Cairo', Arial, sans-serif">
              {val > 0 ? (val >= 1000 ? Math.round(val / 1000) + "K" : val) : ""}
            </text>
            <text x={x + barW / 2} y={topPad + chartH + 20} textAnchor="middle" fontSize="11" fontWeight="600" fill={MUTED} fontFamily="'Cairo', Arial, sans-serif">{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ============================= App ============================= */
function AppInner() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [tab, setTab] = useState("dashboard"); // dashboard | clients | settings
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [team, setTeam] = useState([]);
  const [pendingMembers, setPendingMembers] = useState([]);
  const [currentMember, setCurrentMember] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const cloud = isCloudMode();
  const simpleMode = cloud && isSimpleMode();

  const reloadAll = useCallback(async () => {
    const settingsVal = await storageGet("settings:global", DEFAULT_SETTINGS);
    setSettings(settingsVal);
    const keys = await storageListKeys("client:");
    const loaded = [];
    for (const k of keys) {
      const c = await storageGet(k, null);
      if (c) loaded.push(c);
    }
    loaded.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    setClients(loaded);
    if (!isCloudMode()) {
      const teamVal = await storageGet("settings:team", []);
      setTeam(teamVal);
      return teamVal;
    }
    return [];
  }, []);

  // Simple mode: zero-friction shared access for early testing. Any device that opens
  // this URL gets an anonymous Supabase session automatically — no signup, no approval,
  // full read/write for everyone. This intentionally has NO real access control; it exists
  // so the whole office can pile in and test the sheets/mood board/data together while the
  // real per-person login (see checkCloudStatus below) is switched off temporarily.
  const ensureSimpleSession = useCallback(async () => {
    const sb = getSupabase();
    const { data } = await withTimeout(sb.auth.getSession(), 8000);
    let user = data?.session?.user;
    if (!user) {
      const { data: signData, error } = await withTimeout(sb.auth.signInAnonymously(), 10000);
      if (error) throw error;
      user = signData.user;
    }
    let displayName = "";
    try { displayName = window.localStorage.getItem("boq_display_name") || ""; } catch {}
    setCurrentMember({ id: user.id, name: displayName || "زائر (وضع تجريبي)", role: "owner", email: "" });
    setPendingApproval(false);
  }, []);

  // Cloud mode: check this browser's actual signed-in Supabase user against the
  // server-side profiles table. Role comes only from the database, never from
  // anything the client claims — that's what closes the self-appointment hole.
  const checkCloudStatus = useCallback(async () => {
    const sb = getSupabase();
    const { data } = await withTimeout(sb.auth.getSession(), 8000);
    const user = data?.session?.user;
    if (!user) { setCurrentMember(null); setPendingApproval(false); return; }
    const profile = await fetchMyProfile(user.id);
    if (!profile || profile.role === "pending") {
      setCurrentMember(null);
      setPendingApproval(true);
      return;
    }
    setPendingApproval(false);
    setCurrentMember({ id: profile.id, name: profile.name, role: profile.role, email: profile.email });
    const all = await fetchAllProfiles();
    setTeam(all.filter(p => p.role !== "pending").map(p => ({ id: p.id, name: p.name, role: p.role, email: p.email })));
    setPendingMembers(all.filter(p => p.role === "pending"));
  }, []);

  const [connectionError, setConnectionError] = useState(false);
  const [connectionErrorDetail, setConnectionErrorDetail] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setConnectionError(false);
      setConnectionErrorDetail("");
      try {
        if (simpleMode) {
          await withTimeout(ensureSimpleSession(), 10000);
          await withTimeout(reloadAll(), 10000);
        } else if (cloud) {
          await withTimeout(checkCloudStatus(), 10000);
          await withTimeout(reloadAll(), 10000);
        } else {
          const teamVal = await withTimeout(reloadAll(), 10000);
          const session = await storageGet("session:current", null);
          if (session && teamVal.some(m => m.id === session.memberId)) {
            setCurrentMember(teamVal.find(m => m.id === session.memberId));
          }
        }
      } catch (e) {
        console.error("startup failed", e);
        if (cloud) {
          setConnectionError(true);
          setConnectionErrorDetail(e?.message || String(e));
        }
      }
      setLoading(false);
    })();
  }, [cloud, simpleMode, reloadAll, checkCloudStatus, ensureSimpleSession]);

  // Realtime sync: when cloud mode is active, refresh data automatically when any
  // teammate on another device changes clients, settings, or the team roster — and
  // instantly unlock a pending user's screen the moment an owner approves them.
  useEffect(() => {
    if (!cloud || (!currentMember && !pendingApproval)) return;
    const sb = getSupabase();
    let channel = sb.channel("kv-and-profile-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "kv" }, () => {
        reloadAll();
      });
    if (!simpleMode) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        checkCloudStatus();
      });
    }
    channel.subscribe();
    return () => { sb.removeChannel(channel); };
  }, [cloud, simpleMode, currentMember, pendingApproval, reloadAll, checkCloudStatus]);

  const saveTeam = async (next) => {
    setTeam(next);
    await storageSet("settings:team", next);
  };
  const addTeamMember = async (name, role, email) => {
    const member = { id: "m" + Date.now() + Math.floor(Math.random() * 1000), name, role, email: email || "" };
    await saveTeam([...team, member]);
    return member;
  };
  const removeTeamMember = async (id) => {
    await saveTeam(team.filter(m => m.id !== id));
  };
  const signIn = async (member) => {
    setCurrentMember(member);
    if (!cloud) await storageSet("session:current", { memberId: member.id });
  };
  const signOut = async () => {
    setCurrentMember(null);
    setPendingApproval(false);
    if (cloud) {
      const sb = getSupabase();
      await sb.auth.signOut();
    } else {
      await storageDelete("session:current");
    }
  };
  const approveMember = async (id, role) => {
    const ok = await approveProfile(id, role);
    if (ok) {
      showToast("تم قبول العضو");
      await checkCloudStatus();
    } else {
      showToast("تعذرت الموافقة — تأكد إنك مسجّل دخول كمالك مكتب");
    }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const saveClient = useCallback(async (client) => {
    setSaving(true);
    await storageSet("client:" + client.id, client);
    setSaving(false);
  }, []);

  const updateClient = (id, patch) => {
    setClients(prev => {
      const before = prev.find(c => c.id === id);
      const next = prev.map(c => (c.id === id ? { ...c, ...patch } : c));
      const updated = next.find(c => c.id === id);
      saveClient(updated);
      if (patch.stage === "تم التعاقد" && before && before.stage !== "تم التعاقد") {
        showToast("🎉 العقد جاهز للتحميل — من تفاصيل العميل أو لوحة تحكم إكسل");
      }
      return next;
    });
  };

  const addClient = async () => {
    const c = newClient();
    if (currentMember && currentMember.role === "engineer") c.engineer = currentMember.name;
    setClients(prev => [c, ...prev]);
    await saveClient(c);
    setSelectedId(c.id);
    setTab("clients");
    showToast("تمت إضافة عميل جديد");
  };

  const deleteClient = async (id) => {
    await storageDelete("client:" + id);
    setClients(prev => prev.filter(c => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    showToast("تم حذف العميل");
  };

  const saveSettings = async (next) => {
    setSettings(next);
    await storageSet("settings:global", next);
    showToast("تم حفظ الإعدادات");
  };

  const exportBackup = async () => {
    const entries = await storageGetAllEntries();
    const payload = { app: "boq_office_db", version: 1, exportedAt: new Date().toISOString(), entries };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `نسخة_احتياطية_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("تم تصدير النسخة الاحتياطية");
  };

  const importBackup = async (file) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || !Array.isArray(payload.entries)) throw new Error("bad file");
      for (const [key, value] of payload.entries) {
        await storageSet(key, value);
      }
      // reload from storage
      const settingsVal = await storageGet("settings:global", DEFAULT_SETTINGS);
      setSettings(settingsVal);
      const keys = await storageListKeys("client:");
      const loaded = [];
      for (const k of keys) {
        const c = await storageGet(k, null);
        if (c) loaded.push(c);
      }
      loaded.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      setClients(loaded);
      showToast("تم استيراد النسخة الاحتياطية بنجاح");
    } catch (e) {
      console.error(e);
      showToast("تعذّر قراءة ملف النسخة الاحتياطية");
    }
  };

  const selected = clients.find(c => c.id === selectedId) || null;

  const visibleClients = useMemo(() => {
    if (!currentMember || can(currentMember, "viewAllClients")) return clients;
    return clients.filter(c => c.engineer === currentMember.name);
  }, [clients, currentMember]);

  const pipelineStats = useMemo(() => {
    const byStage = Object.fromEntries(STAGES.map(s => [s, { count: 0, value: 0 }]));
    let totalValue = 0;
    visibleClients.forEach(c => {
      const calc = calcClient(c, settings);
      const stage = STAGES.includes(c.stage) ? c.stage : STAGES[0];
      byStage[stage].count += 1;
      byStage[stage].value += calc.grandTotal;
      totalValue += calc.grandTotal;
    });
    return { byStage, totalValue, count: visibleClients.length };
  }, [visibleClients, settings]);

  if (loading) {
    return (
      <div dir="rtl" className="flex h-[600px] items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif" }}>
        <div className="flex flex-col items-center gap-3" style={{ color: MUTED }}>
          <Loader2 className="animate-spin" size={28} />
          <div className="text-sm">جاري تحميل بيانات العملاء…</div>
        </div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div dir="rtl" className="flex min-h-[700px] items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT }}>
        <div className="w-full max-w-md rounded-2xl p-8 text-center shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <div className="mb-2 text-lg font-bold" style={{ color: "#C00000" }}>تعذر الاتصال بالخادم السحابي</div>
          <p className="mb-3 text-sm leading-6" style={{ color: MUTED }}>
            تأكد من صحة رابط ومفتاح Supabase في الإعدادات، ومن اتصالك بالإنترنت. بياناتك المحلية السابقة لم تتأثر.
          </p>
          {connectionErrorDetail && (
            <div className="mb-5 rounded-lg p-3 text-left text-xs" style={{ backgroundColor: "#FCE9E9", color: "#8A1414", direction: "ltr", wordBreak: "break-word" }}>
              {connectionErrorDetail}
            </div>
          )}
          <button
            onClick={() => window.location.reload()}
            className="mb-2 w-full rounded-lg py-2.5 text-sm font-bold text-white"
            style={{ backgroundColor: "#1E7B45" }}
          >
            إعادة المحاولة
          </button>
          <button
            onClick={() => { setCloudConfig(null); window.location.reload(); }}
            className="w-full rounded-lg py-2.5 text-sm font-bold text-white"
            style={{ backgroundColor: NAVY }}
          >
            تعطيل المزامنة السحابية والعودة للتخزين المحلي
          </button>
        </div>
      </div>
    );
  }

  if (pendingApproval) {
    return <PendingApprovalScreen onSignOut={signOut} onRefresh={checkCloudStatus} />;
  }

  if (!currentMember) {
    return cloud
      ? <CloudAuthGate onAuthSuccess={checkCloudStatus} />
      : <IdentityGate team={team} onAddMember={addTeamMember} onSignIn={signIn} />;
  }

  return (
    <div dir="rtl" className="min-h-[700px] w-full" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT, color: TEXT }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ backgroundColor: NAVY }}>
        <div>
          <div className="text-lg font-bold text-white">نظام متابعة العملاء والتسعير</div>
          <div className="text-xs" style={{ color: "#AEB9C6" }}>مكتب __________ للاستشارات المعمارية</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: simpleMode ? "#B45309" : cloud ? "#1E7B45" : "#4B5563", color: "#FFFFFF" }}>
            <Wifi size={12} /> {simpleMode ? "وضع تجريبي مبسط (بدون صلاحيات)" : cloud ? "مزامنة سحابية مفعّلة" : "محلي (بدون مزامنة)"}
          </span>
          {simpleMode ? (
            <span className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: NAVY_DARK, color: "#D9E1F2" }}>
              {currentMember.name}
            </span>
          ) : (
            <button onClick={signOut} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: NAVY_DARK, color: "#D9E1F2" }}>
              <span className="rounded-full px-2 py-0.5 font-bold" style={{ backgroundColor: (ROLES[currentMember.role] || ROLES.engineer).color, color: (ROLES[currentMember.role] || ROLES.engineer).textOn }}>
                {roleLabel(currentMember.role)}
              </span>
              {currentMember.name} — تبديل
            </button>
          )}
        </div>
        <nav className="flex gap-1 rounded-lg p-1" style={{ backgroundColor: NAVY_DARK }}>
          {[
            ["dashboard", "لوحة المتابعة", LayoutDashboard],
            ["clients", "العملاء", Users],
            ["excelHub", "لوحة تحكم إكسل", FileSpreadsheet],
            ["settings", "الإعدادات", Settings],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors"
              style={{
                backgroundColor: tab === key ? GOLD : "transparent",
                color: tab === key ? "#1F1F1F" : "#D9E1F2",
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-lg" style={{ backgroundColor: "#1E7B45" }}>
          {toast}
        </div>
      )}

      <div className="p-6">
        {tab === "dashboard" && (
          <Dashboard stats={pipelineStats} onAdd={addClient} clients={visibleClients} settings={settings} onOpenClient={(id) => { setSelectedId(id); setTab("clients"); }} />
        )}

        {tab === "clients" && !selected && (
          <ClientList clients={visibleClients} onAdd={addClient} onSelect={setSelectedId} onDelete={deleteClient} settings={settings} />
        )}

        {tab === "clients" && selected && (
          <ClientDetail
            client={selected}
            settings={settings}
            saving={saving}
            team={team}
            currentMember={currentMember}
            onBack={() => setSelectedId(null)}
            onChange={(patch) => updateClient(selected.id, patch)}
            onDelete={() => deleteClient(selected.id)}
          />
        )}

        {tab === "excelHub" && (
          <ExcelHub clients={visibleClients} settings={settings} onUpdate={updateClient} />
        )}

        {tab === "settings" && (
          <SettingsPanel
            settings={settings} onSave={saveSettings}
            onExportBackup={exportBackup} onImportBackup={importBackup}
            clientCount={clients.length}
            team={team} currentMember={currentMember}
            onAddMember={addTeamMember} onRemoveMember={removeTeamMember}
            cloud={cloud}
            pendingMembers={pendingMembers} onApproveMember={approveMember}
          />
        )}
      </div>
    </div>
  );
}

/* ============================= Dashboard ============================= */
function Dashboard({ stats, onAdd, clients, settings, onOpenClient }) {
  const recent = clients.slice(0, 5);
  return (
    <div>
      <div className="mb-6 flex items-center justify-between rounded-2xl p-5" style={{ backgroundColor: NAVY }}>
        <div>
          <h2 className="text-xl font-bold text-white">نظرة عامة على خط العملاء</h2>
          <p className="mt-0.5 text-xs" style={{ color: "#AEB9C6" }}>لوحة متابعة شاملة لأداء المكتب</p>
        </div>
        <button onClick={onAdd} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-bold shadow-sm" style={{ backgroundColor: GOLD, color: "#1F1F1F" }}>
          <Plus size={16} /> عميل جديد
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="إجمالي العملاء" value={stats.count} icon={Users} />
        <StatCard label="إجمالي قيمة خط الأعمال" value={fmt(stats.totalValue) + " ج.م"} accent={GOLD} icon={FileSpreadsheet} />
        {STAGES.map(s => (
          <StatCard key={s} label={s} value={stats.byStage[s].count} sub={fmt(stats.byStage[s].value) + " ج.م"} accent={STAGE_COLORS[s]} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <div className="mb-3 text-sm font-bold" style={{ color: NAVY }}>قيمة خط الأعمال حسب المرحلة</div>
          {stats.count > 0 ? <StageValueChart stats={stats} /> : (
            <div className="flex h-40 items-center justify-center text-sm" style={{ color: MUTED }}>لا يوجد بيانات بعد</div>
          )}
        </div>
        <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
          <div className="mb-3 text-sm font-bold" style={{ color: NAVY }}>نمو خط الأعمال آخر 6 أشهر</div>
          {clients.length > 0 ? <MonthlyTrendChart clients={clients} settings={settings} /> : (
            <div className="flex h-40 items-center justify-center text-sm" style={{ color: MUTED }}>لا يوجد بيانات بعد</div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 text-sm font-bold" style={{ color: NAVY }}>توزيع خط الأعمال حسب المرحلة (بعدد العملاء)</div>
        <div className="flex h-6 w-full overflow-hidden rounded-full" style={{ backgroundColor: LIGHT }}>
          {STAGES.map(s => {
            const pct = stats.count ? (stats.byStage[s].count / stats.count) * 100 : 0;
            return pct > 0 ? <div key={s} style={{ width: pct + "%", backgroundColor: STAGE_COLORS[s] }} title={s} /> : null;
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {STAGES.map(s => <Badge key={s} text={`${s} (${stats.byStage[s].count})`} color={STAGE_COLORS[s]} />)}
        </div>
      </div>

      <div className="mt-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 text-sm font-bold" style={{ color: NAVY }}>أحدث العملاء</div>
        {recent.length === 0 && <div className="text-sm" style={{ color: MUTED }}>لا يوجد عملاء بعد — ابدأ بإضافة أول عميل.</div>}
        <div className="flex flex-col gap-2">
          {recent.map(c => {
            const calc = calcClient(c, settings);
            return (
              <button key={c.id} onClick={() => onOpenClient(c.id)} className="flex items-center justify-between rounded-lg px-3 py-2 text-right transition-colors hover:bg-gray-50" style={{ border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-3">
                  <Badge text={c.stage} color={STAGE_COLORS[c.stage] || MUTED} />
                  <span className="text-sm font-semibold">{c.name || "بدون اسم"}</span>
                </div>
                <span className="text-sm font-bold" style={{ color: NAVY }}>{fmt(calc.grandTotal)} ج.م</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================= Client list ============================= */
function ClientList({ clients, onAdd, onSelect, onDelete, settings }) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");

  const visible = useMemo(() => {
    let list = clients.filter(c => {
      const matchesQuery = !query.trim() || (c.name || "").toLowerCase().includes(query.trim().toLowerCase()) ||
        (c.engineer || "").toLowerCase().includes(query.trim().toLowerCase());
      const matchesStage = !stageFilter || c.stage === stageFilter;
      return matchesQuery && matchesStage;
    });
    const calcOf = (c) => calcClient(c, settings).grandTotal;
    switch (sortBy) {
      case "value_desc": list = [...list].sort((a, b) => calcOf(b) - calcOf(a)); break;
      case "value_asc": list = [...list].sort((a, b) => calcOf(a) - calcOf(b)); break;
      case "name_asc": list = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar")); break;
      case "date_asc": list = [...list].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")); break;
      default: list = [...list].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    }
    return list;
  }, [clients, query, stageFilter, sortBy, settings]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold" style={{ color: NAVY }}>العملاء ({visible.length}{visible.length !== clients.length ? ` من ${clients.length}` : ""})</h2>
        <button onClick={onAdd} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white shadow-sm" style={{ backgroundColor: NAVY }}>
          <Plus size={16} /> عميل جديد
        </button>
      </div>

      {clients.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1" style={{ minWidth: 180 }}>
            <input
              placeholder="بحث بالاسم أو المهندس المسؤول..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full rounded-lg py-2 pr-3 pl-3 text-sm"
              style={{ border: `1px solid ${BORDER}` }}
            />
          </div>
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={{ border: `1px solid ${BORDER}` }}>
            <option value="">كل المراحل</option>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={{ border: `1px solid ${BORDER}` }}>
            <option value="date_desc">الأحدث أولاً</option>
            <option value="date_asc">الأقدم أولاً</option>
            <option value="value_desc">الأعلى قيمة</option>
            <option value="value_asc">الأقل قيمة</option>
            <option value="name_asc">الاسم (أ-ي)</option>
          </select>
        </div>
      )}

      {clients.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ backgroundColor: "#FFFFFF", border: `1px dashed ${BORDER}`, color: MUTED }}>
          لا يوجد عملاء بعد. اضغط "عميل جديد" للبدء.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ backgroundColor: "#FFFFFF", border: `1px dashed ${BORDER}`, color: MUTED }}>
          لا يوجد عملاء مطابقين لهذا البحث/الفلتر.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(c => {
            const calc = calcClient(c, settings);
            return (
              <div key={c.id} className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
                <div className="mb-2 flex items-center justify-between">
                  <Badge text={c.stage} color={STAGE_COLORS[c.stage] || MUTED} />
                  <button onClick={() => onDelete(c.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
                </div>
                <div className="mb-1 text-base font-bold">{c.name || "بدون اسم"}</div>
                <div className="mb-1 flex items-center gap-1.5 text-xs" style={{ color: MUTED }}><MapPin size={12} />{c.address || "بدون عنوان"}</div>
                <div className="mb-1 flex items-center gap-1.5 text-xs" style={{ color: MUTED }}><Ruler size={12} />{c.area} م²</div>
                {c.phone && <div className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: MUTED }}><Phone size={12} />{c.phone}</div>}
                {(c.stage === "قيد التنفيذ" || c.progressPercent > 0) && (
                  <div className="mb-2">
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold" style={{ color: MUTED }}>
                      <span>نسبة الإنجاز بالموقع</span>
                      <span>{c.progressPercent || 0}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: LIGHT }}>
                      <div className="h-full rounded-full" style={{ width: `${c.progressPercent || 0}%`, backgroundColor: "#1E7B45" }} />
                    </div>
                  </div>
                )}
                <div className="mb-3 rounded-lg px-3 py-2 text-center text-sm font-bold text-white" style={{ backgroundColor: NAVY }}>
                  {fmt(calc.grandTotal)} ج.م
                </div>
                <button onClick={() => onSelect(c.id)} className="w-full rounded-lg py-1.5 text-sm font-semibold" style={{ border: `1px solid ${NAVY}`, color: NAVY }}>
                  فتح التفاصيل
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================= Client detail ============================= */
function ClientDetail({ client, settings, saving, team, currentMember, onBack, onChange, onDelete }) {
  const calc = useMemo(() => calcClient(client, settings), [client, settings]);
  const [innerTab, setInnerTab] = useState("pricing"); // pricing | site

  const exportExcel = () => exportFullBOQ(client, settings);

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm font-semibold" style={{ color: NAVY }}>
        <ChevronLeft size={16} /> العودة لقائمة العملاء
      </button>

      {(client.stage === "تم التعاقد" || client.stage === "قيد التنفيذ" || client.stage === "تم التسليم") && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={{ backgroundColor: "#FCE9B5", border: "1px solid " + GOLD }}>
          <div className="flex items-center gap-2">
            <PartyPopper size={20} style={{ color: "#8A6D00" }} />
            <div>
              <div className="text-sm font-bold" style={{ color: "#5C4700" }}>هذا العميل وصل لمرحلة التعاقد — العقد جاهز للتحميل بجدول دفعات محسوب فعليًا</div>
              <div className="text-xs" style={{ color: "#8A6D00" }}>القيمة الإجمالية: {fmt(calc.grandTotal)} ج.م — يمكن فتح الملف وتعديله في Word مباشرة</div>
            </div>
          </div>
          <button
            onClick={() => downloadDocx(`عقد_${client.name || "عميل"}.docx`, generateContractDocx(client, calc))}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold shadow-sm"
            style={{ backgroundColor: "#1F1F1F", color: "#FFFFFF" }}
          >
            <FileText size={16} /> تحميل العقد الآن
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* left: basic info */}
        <div className="lg:col-span-1">
          <div className="rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold" style={{ color: NAVY }}>بيانات العميل</div>
              <div className="flex items-center gap-2">
                {saving && <Loader2 className="animate-spin" size={14} style={{ color: MUTED }} />}
                <button onClick={onDelete} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
            </div>
            <Field label="اسم العميل"><input className="inp" value={client.name} onChange={e => onChange({ name: e.target.value })} /></Field>
            <Field label="رقم الهاتف"><input className="inp" value={client.phone} onChange={e => onChange({ phone: e.target.value })} /></Field>
            <Field label="عنوان المشروع"><input className="inp" value={client.address} onChange={e => onChange({ address: e.target.value })} /></Field>
            <Field label="المساحة (م²)"><input type="number" className="inp" value={client.area} onChange={e => onChange({ area: e.target.value })} /></Field>
            <Field label="مرحلة العميل">
              <select className="inp" value={client.stage} onChange={e => onChange({ stage: e.target.value })}>
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="المهندس المسؤول">
              <select className="inp" value={client.engineer || ""} onChange={e => onChange({ engineer: e.target.value })}>
                <option value="">— غير محدد —</option>
                {team.map(m => <option key={m.id} value={m.name}>{m.name}{m.role === "owner" ? " (المالك)" : ""}</option>)}
              </select>
            </Field>
            <Field label="الأسلوب المفضل"><input className="inp" value={client.style} onChange={e => onChange({ style: e.target.value })} /></Field>
            <Field label="ملاحظات">
              <textarea className="inp" rows={3} value={client.notes} onChange={e => onChange({ notes: e.target.value })} />
            </Field>
          </div>

          <button onClick={exportExcel} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold text-white shadow-sm" style={{ backgroundColor: GOLD }}>
            <Download size={16} /> تصدير المقايسة Excel
          </button>
          <button onClick={() => buildAndDownloadClientPptx(client, calc, settings)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold text-white shadow-sm" style={{ backgroundColor: "#2E5395" }}>
            <FileText size={16} /> تصدير عرض تقديمي PowerPoint
          </button>
          <div className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: MUTED }}>
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            كل الملفات هنا تُبنى لحظيًا من بيانات هذا العميل — أي تعديل بالمستويات أو الأسعار يظهر فورًا في أي ملف جديد تصدّره، بلا حاجة لتحديث يدوي.
          </div>
        </div>

        {/* right: scope selection + calc */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex gap-1 rounded-lg p-1" style={{ backgroundColor: LIGHT }}>
            <button
              onClick={() => setInnerTab("pricing")}
              className="flex-1 rounded-md py-2 text-sm font-bold transition-colors"
              style={{ backgroundColor: innerTab === "pricing" ? NAVY : "transparent", color: innerTab === "pricing" ? "#FFFFFF" : TEXT }}
            >
              التسعير والمقايسة
            </button>
            <button
              onClick={() => setInnerTab("site")}
              className="flex-1 rounded-md py-2 text-sm font-bold transition-colors"
              style={{ backgroundColor: innerTab === "site" ? NAVY : "transparent", color: innerTab === "site" ? "#FFFFFF" : TEXT }}
            >
              سجل متابعة الموقع{client.progressPercent > 0 ? ` (${client.progressPercent}%)` : ""}
            </button>
          </div>

          {innerTab === "pricing" && (
            <>
          <div className="rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
            <div className="mb-3 text-sm font-bold" style={{ color: NAVY }}>مستوى التشطيب لكل نطاق عمل</div>
            <div className="flex flex-col gap-3">
              {SCOPES.map(scope => (
                <div key={scope} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3" style={{ backgroundColor: LIGHT }}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={client.scopeIncluded[scope]}
                      onChange={e => onChange({ scopeIncluded: { ...client.scopeIncluded, [scope]: e.target.checked } })}
                    />
                    <span className="text-sm font-semibold">{scope}</span>
                  </div>
                  <div className="flex gap-1">
                    {LEVELS.map(lv => (
                      <button
                        key={lv}
                        disabled={!client.scopeIncluded[scope]}
                        onClick={() => onChange({ scopeLevel: { ...client.scopeLevel, [scope]: lv } })}
                        className="rounded-md px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-30"
                        style={{
                          backgroundColor: client.scopeLevel[scope] === lv ? LEVEL_COLORS[lv] : "#FFFFFF",
                          color: client.scopeLevel[scope] === lv ? "#FFFFFF" : TEXT,
                          border: `1px solid ${client.scopeLevel[scope] === lv ? LEVEL_COLORS[lv] : BORDER}`,
                        }}
                      >
                        {lv}
                      </button>
                    ))}
                  </div>
                  <div className="w-full text-left text-sm font-bold sm:w-auto" style={{ color: NAVY }}>
                    {client.scopeIncluded[scope] ? fmt(calc.byScope[scope]) + " ج.م" : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <FullItemBOQ client={client} onChange={onChange} currentMember={currentMember} />

          <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: NAVY }}>
            <div className="mb-3 text-sm font-bold text-white">ملخص السعر</div>
            <SummaryRow label="إجمالي بنود التنفيذ" value={calc.execTotal} />
            <SummaryRow label="أتعاب الإشراف الهندسي" value={calc.supervision} />
            <SummaryRow label="احتياطي أعمال غير منظورة" value={calc.contingency} />
            <SummaryRow label="التصميم" value={calc.byScope["تصميم"]} />
            <SummaryRow label="الفرش والأثاث" value={calc.byScope["الفرش والأثاث"]} />
            <div className="my-2 h-px" style={{ backgroundColor: "#2E5395" }} />
            <SummaryRow label="الإجمالي قبل الضريبة" value={calc.subtotal} bold />
            <SummaryRow label="ضريبة القيمة المضافة" value={calc.vat} />
            <div className="mt-3 flex items-center justify-between rounded-lg px-3 py-2.5" style={{ backgroundColor: GOLD }}>
              <span className="text-sm font-bold" style={{ color: "#1F1F1F" }}>الإجمالي النهائي المستحق</span>
              <span className="text-lg font-bold" style={{ color: "#1F1F1F" }}>{fmt(calc.grandTotal)} ج.م</span>
            </div>
          </div>
            </>
          )}

          {innerTab === "site" && <SiteVisitLog client={client} onChange={onChange} />}
        </div>
      </div>

      <style>{`
        .inp { width: 100%; margin-top: 4px; margin-bottom: 12px; padding: 8px 10px; border-radius: 8px; border: 1px solid ${BORDER}; font-size: 13px; font-family: 'Cairo', Arial, sans-serif; }
        .inp:focus { outline: 2px solid ${NAVY}; outline-offset: 0; }
      `}</style>
    </div>
  );
}

/* ============================= Site visit log ============================= */
/* ============================= Full itemized BOQ editor (per-item overrides) ============================= */
function FullItemBOQ({ client, onChange, currentMember }) {
  const [expanded, setExpanded] = useState(false);
  const mayEditPrice = can(currentMember, "editUnitPrice");
  const area = Number(client.area) || 0;
  const itemIncluded = client.itemIncluded || {};
  const itemLevel = client.itemLevel || {};
  const itemQty = client.itemQty || {};
  const itemPrice = client.itemPrice || {};
  const itemPriceDate = client.itemPriceDate || {};
  const customCount = Object.keys(itemLevel).length + Object.keys(itemQty).length +
    Object.keys(itemIncluded).length + Object.keys(itemPrice).length;

  const setItemPatch = (mapKey, name, value) => {
    const current = { ...(client[mapKey] || {}) };
    if (value === undefined) delete current[name];
    else current[name] = value;
    onChange({ [mapKey]: current });
  };

  const setPriceOverride = (name, value) => {
    const priceMap = { ...(client.itemPrice || {}) };
    const dateMap = { ...(client.itemPriceDate || {}) };
    if (value === "" || value === undefined) {
      delete priceMap[name];
      delete dateMap[name];
    } else {
      priceMap[name] = value;
      dateMap[name] = new Date().toISOString().slice(0, 10);
    }
    onChange({ itemPrice: priceMap, itemPriceDate: dateMap });
  };

  const resetItem = (name) => {
    const li = { ...(client.itemLevel || {}) }; delete li[name];
    const ii = { ...(client.itemIncluded || {}) }; delete ii[name];
    const iq = { ...(client.itemQty || {}) }; delete iq[name];
    const ip = { ...(client.itemPrice || {}) }; delete ip[name];
    const ipd = { ...(client.itemPriceDate || {}) }; delete ipd[name];
    onChange({ itemLevel: li, itemIncluded: ii, itemQty: iq, itemPrice: ip, itemPriceDate: ipd });
  };

  const resetAll = () => onChange({ itemLevel: {}, itemIncluded: {}, itemQty: {}, itemPrice: {}, itemPriceDate: {} });

  let currentScope = null;

  return (
    <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold" style={{ color: NAVY }}>المقايسة الكاملة القابلة للتعديل ({ITEMS.length} بند)</div>
          {customCount > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
              {customCount} تخصيص يدوي
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {customCount > 0 && (
            <button onClick={resetAll} className="text-xs font-semibold underline" style={{ color: "#C00000" }}>
              إعادة الكل للوضع الافتراضي
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: NAVY }}>
            {expanded ? "إخفاء" : "عرض وتعديل كل البنود"}
          </button>
        </div>
      </div>

      {!expanded && (
        <p className="mt-2 text-xs leading-6" style={{ color: MUTED }}>
          الجدول أعلاه بيتحكم في المستوى على مستوى الفئة كاملة. افتح هنا لو محتاج تغيّر مستوى أو كمية أو سعر
          وحدة أو تضمين بند واحد بعينه بشكل مستقل — مفيد لتغيّرات سعر السوق أثناء التنفيذ أو اختلاف سعر
          التوريد بين عميل وآخر. أي تعديل بيتزامن فورًا زي باقي البيانات.
        </p>
      )}

      {expanded && (
        <div className="mt-3 flex flex-col gap-0.5">
          <div className="hidden grid-cols-12 gap-2 px-2 pb-1 text-[10px] font-bold sm:grid" style={{ color: MUTED }}>
            <div className="col-span-3">البند</div>
            <div className="col-span-2">الكمية</div>
            <div className="col-span-2">المستوى</div>
            <div className="col-span-2">سعر الوحدة</div>
            <div className="col-span-2">الإجمالي</div>
            <div className="col-span-1"></div>
          </div>
          {ITEMS.map((item, i) => {
            const [scope, name, unit] = item;
            const r = resolveItem(client, item, area);
            const showScopeHeader = scope !== currentScope;
            currentScope = scope;
            const isCustom = Object.prototype.hasOwnProperty.call(itemLevel, name) ||
              Object.prototype.hasOwnProperty.call(itemIncluded, name) ||
              Object.prototype.hasOwnProperty.call(itemQty, name) ||
              Object.prototype.hasOwnProperty.call(itemPrice, name);
            return (
              <React.Fragment key={name}>
                {showScopeHeader && (
                  <div className="mt-3 mb-1 text-xs font-bold" style={{ color: MUTED }}>{scope}</div>
                )}
                <div
                  className="grid grid-cols-12 items-center gap-2 rounded-lg px-2 py-2"
                  style={{ backgroundColor: isCustom ? "#FFFBEB" : (i % 2 ? "#FFFFFF" : LIGHT) }}
                >
                  <div className="col-span-12 flex items-center gap-2 sm:col-span-3">
                    <input
                      type="checkbox"
                      checked={r.included}
                      onChange={e => setItemPatch("itemIncluded", name, e.target.checked)}
                    />
                    <span className="text-xs font-semibold leading-4">{name}</span>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <input
                      type="number"
                      disabled={!r.included}
                      className="w-full rounded-md px-2 py-1 text-xs disabled:opacity-40"
                      style={{ border: `1px solid ${BORDER}` }}
                      value={Object.prototype.hasOwnProperty.call(itemQty, name) ? itemQty[name] : Math.round(r.qty * 100) / 100}
                      onChange={e => setItemPatch("itemQty", name, e.target.value)}
                    />
                    <span className="text-[10px]" style={{ color: MUTED }}>{unit}</span>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <select
                      disabled={!r.included}
                      className="w-full rounded-md px-1.5 py-1 text-xs disabled:opacity-40"
                      style={{ border: `1px solid ${BORDER}` }}
                      value={itemLevel[name] || ""}
                      onChange={e => setItemPatch("itemLevel", name, e.target.value || undefined)}
                    >
                      <option value="">افتراضي الفئة</option>
                      {LEVELS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <input
                      type="number"
                      disabled={!r.included || !mayEditPrice}
                      readOnly={!mayEditPrice}
                      title={mayEditPrice ? "" : "تعديل سعر الوحدة متاح لمدير المشاريع أو مالك المكتب فقط"}
                      className="w-full rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-40"
                      style={{ border: `1px solid ${r.hasPriceOverride ? "#BF9000" : BORDER}`, color: r.hasPriceOverride ? "#8A6D00" : TEXT, backgroundColor: mayEditPrice ? "transparent" : "#F5F7FA", cursor: mayEditPrice ? "auto" : "not-allowed" }}
                      value={Object.prototype.hasOwnProperty.call(itemPrice, name) ? itemPrice[name] : Math.round(r.price)}
                      onChange={e => { if (mayEditPrice) setPriceOverride(name, e.target.value); }}
                    />
                    {r.hasPriceOverride && (
                      <span className="text-[9px]" style={{ color: MUTED }}>
                        كان {fmt(r.basePrice)} — عُدّل {r.priceDate}
                      </span>
                    )}
                  </div>
                  <div className="col-span-6 text-left text-xs font-bold sm:col-span-2" style={{ color: NAVY }}>
                    {r.included ? fmt(r.total) + " ج.م" : "—"}
                  </div>
                  <div className="col-span-4 text-left sm:col-span-1">
                    {isCustom && (
                      <button onClick={() => resetItem(name)} title="إعادة الافتراضي" className="text-xs" style={{ color: "#C00000" }}>↺</button>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SiteVisitLog({ client, onChange }) {
  const [visits, setVisits] = useState([]);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(() => newVisit(client.id));

  const reload = useCallback(async () => {
    setLoadingVisits(true);
    const v = await loadVisits(client.id);
    setVisits(v);
    setLoadingVisits(false);
  }, [client.id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setDraft(newVisit(client.id)); setShowForm(false); }, [client.id]);

  const submitVisit = async () => {
    const visit = { ...draft, percent: Number(draft.percent) || 0 };
    await saveVisit(visit);
    if (visit.percent >= (client.progressPercent || 0)) {
      onChange({ progressPercent: visit.percent, lastVisitAt: visit.date });
    }
    setDraft(newVisit(client.id));
    setShowForm(false);
    reload();
  };

  const removeVisit = async (id) => {
    await deleteVisitEntry(client.id, id);
    reload();
  };

  return (
    <div className="mt-5 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-bold" style={{ color: NAVY }}>سجل متابعة الموقع</div>
          {client.progressPercent > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ backgroundColor: "#E2EFDA", color: "#1E7B45" }}>
              نسبة الإنجاز الحالية: {client.progressPercent}%
            </span>
          )}
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: NAVY }}>
          <Plus size={14} /> تسجيل زيارة جديدة
        </button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-lg p-3" style={{ backgroundColor: LIGHT }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="تاريخ الزيارة">
              <input type="date" className="inp" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
            </Field>
            <Field label="اسم المهندس القائم بالزيارة">
              <input className="inp" value={draft.engineer} onChange={e => setDraft({ ...draft, engineer: e.target.value })} />
            </Field>
            <Field label={`نسبة الإنجاز الإجمالية: ${draft.percent}%`}>
              <input type="range" min="0" max="100" step="5" className="w-full" value={draft.percent} onChange={e => setDraft({ ...draft, percent: Number(e.target.value) })} />
            </Field>
            <Field label="رابط صور الموقع (اختياري)">
              <input className="inp" placeholder="رابط Google Drive أو مشابه" value={draft.photoLink} onChange={e => setDraft({ ...draft, photoLink: e.target.value })} />
            </Field>
          </div>
          <Field label="ملاحظات الزيارة">
            <textarea className="inp" rows={3} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <button onClick={submitVisit} disabled={!draft.date} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: "#1E7B45" }}>
            حفظ الزيارة
          </button>
        </div>
      )}

      {loadingVisits ? (
        <div className="flex items-center gap-2 py-6 text-sm" style={{ color: MUTED }}>
          <Loader2 className="animate-spin" size={16} /> جاري تحميل السجل…
        </div>
      ) : visits.length === 0 ? (
        <div className="rounded-lg p-6 text-center text-sm" style={{ backgroundColor: LIGHT, color: MUTED }}>
          لا يوجد زيارات مسجّلة بعد لهذا العميل.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visits.map(v => (
            <div key={v.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg p-3" style={{ backgroundColor: LIGHT }}>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <span>{v.date}</span>
                  <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: NAVY }}>{v.percent}%</span>
                  {v.engineer && <span className="text-xs font-normal" style={{ color: MUTED }}>بواسطة {v.engineer}</span>}
                </div>
                {v.notes && <div className="mt-1 text-xs leading-5" style={{ color: TEXT }}>{v.notes}</div>}
                {v.photoLink && (
                  <a href={v.photoLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: NAVY }}>
                    <ExternalLink size={12} /> عرض الصور
                  </a>
                )}
              </div>
              <button onClick={() => removeVisit(v.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-xs font-semibold" style={{ color: MUTED }}>
      {label}
      {children}
    </label>
  );
}

function SummaryRow({ label, value, bold }) {
  return (
    <div className="mb-1.5 flex items-center justify-between text-sm" style={{ color: "#D9E1F2" }}>
      <span style={{ fontWeight: bold ? 700 : 400, color: bold ? "#FFFFFF" : "#D9E1F2" }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: "#FFFFFF" }}>{fmt(value)} ج.م</span>
    </div>
  );
}

/* ============================= Identity gate (local role simulation) ============================= */
function IdentityGate({ team, onAddMember, onSignIn }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const createOwner = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const member = await onAddMember(name.trim(), "owner");
    await onSignIn(member);
    setBusy(false);
  };

  return (
    <div dir="rtl" className="flex min-h-[700px] w-full items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT }}>
      <div className="w-full max-w-md rounded-2xl p-8 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-1 text-center text-lg font-bold" style={{ color: NAVY }}>نظام متابعة العملاء والتسعير</div>
        <div className="mb-6 text-center text-xs" style={{ color: MUTED }}>مكتب __________ للاستشارات المعمارية</div>

        {team.length === 0 ? (
          <>
            <div className="mb-4 text-sm font-semibold" style={{ color: TEXT }}>أول مرة تفتح الأداة — أدخل اسمك لإنشاء حساب مالك المكتب</div>
            <input className="inp" placeholder="اسمك الكامل" value={name} onChange={e => setName(e.target.value)} />
            <button disabled={busy || !name.trim()} onClick={createOwner} className="mt-3 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: NAVY }}>
              بدء استخدام النظام كمالك للمكتب
            </button>
          </>
        ) : (
          <>
            <div className="mb-3 text-sm font-semibold" style={{ color: TEXT }}>من أنت؟</div>
            <div className="flex flex-col gap-2">
              {team.map(m => (
                <button key={m.id} onClick={() => onSignIn(m)} className="flex items-center justify-between rounded-lg px-4 py-2.5 text-sm font-semibold" style={{ border: `1px solid ${BORDER}` }}>
                  <span>{m.name}</span>
                  <Badge text={roleLabel(m.role)} color={(ROLES[m.role] || ROLES.engineer).color} />
                </button>
              ))}
            </div>
            <div className="mt-4 text-center text-xs" style={{ color: MUTED }}>
              مش لاقي اسمك؟ اطلب من مالك المكتب يضيفك من تبويب "الإعدادات".
            </div>
          </>
        )}
        <style>{`
          .inp { width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid ${BORDER}; font-size: 13px; font-family: 'Cairo', Arial, sans-serif; }
          .inp:focus { outline: 2px solid ${NAVY}; outline-offset: 0; }
        `}</style>
      </div>
    </div>
  );
}

/* ============================= Cloud auth gate (real login, shared across devices) ============================= */
function CloudAuthGate({ onAuthSuccess }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const handleSignIn = async () => {
    setError(""); setBusy(true);
    try {
      const sb = getSupabase();
      const { error: err } = await withTimeout(sb.auth.signInWithPassword({ email: email.trim(), password }), 10000);
      if (err) { setError(`تعذر تسجيل الدخول — رسالة الخادم: ${err.message}`); setBusy(false); return; }
      await onAuthSuccess();
    } catch (e) {
      setError("تعذر الاتصال بالخادم — تأكد من صحة رابط ومفتاح Supabase في الإعدادات ومن اتصالك بالإنترنت. (" + (e?.message || "") + ")");
    }
    setBusy(false);
  };

  const handleSignUp = async () => {
    setError(""); setBusy(true);
    try {
      const sb = getSupabase();
      const { data, error: err } = await withTimeout(
        sb.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } }),
        10000
      );
      if (err) { setError(`تعذر إنشاء الحساب — رسالة الخادم: ${err.message}`); setBusy(false); return; }
      if (!data.session) {
        setPendingConfirm(true);
        setBusy(false);
        return;
      }
      await onAuthSuccess();
    } catch (e) {
      setError("تعذر الاتصال بالخادم — تأكد من صحة رابط ومفتاح Supabase في الإعدادات ومن اتصالك بالإنترنت. (" + (e?.message || "") + ")");
    }
    setBusy(false);
  };

  return (
    <div dir="rtl" className="flex min-h-[700px] w-full items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT }}>
      <div className="w-full max-w-md rounded-2xl p-8 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-1 text-center text-lg font-bold" style={{ color: NAVY }}>نظام متابعة العملاء والتسعير</div>
        <div className="mb-1 flex items-center justify-center gap-1.5 text-xs" style={{ color: "#1E7B45" }}>
          <Wifi size={13} /> وضع المزامنة السحابية مفعّل
        </div>
        <div className="mb-6 text-center text-xs" style={{ color: MUTED }}>مكتب __________ للاستشارات المعمارية</div>

        {pendingConfirm ? (
          <div className="rounded-lg p-4 text-center text-sm" style={{ backgroundColor: "#FFF7E6", color: "#8A6D00" }}>
            تم إنشاء الحساب. تفقّد بريدك الإلكتروني واضغط رابط التأكيد، ثم ارجع هنا وسجّل الدخول.
            <div className="mt-2 text-xs" style={{ color: MUTED }}>
              (لو المكتب مش محتاج تأكيد بريد، ألغِ خاصية "Confirm email" من إعدادات Supabase Auth لتسريع الدخول لاحقًا.)
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex rounded-lg p-1" style={{ backgroundColor: LIGHT }}>
              <button onClick={() => setMode("signin")} className="flex-1 rounded-md py-1.5 text-sm font-bold" style={{ backgroundColor: mode === "signin" ? NAVY : "transparent", color: mode === "signin" ? "#FFFFFF" : TEXT }}>تسجيل الدخول</button>
              <button onClick={() => setMode("signup")} className="flex-1 rounded-md py-1.5 text-sm font-bold" style={{ backgroundColor: mode === "signup" ? NAVY : "transparent", color: mode === "signup" ? "#FFFFFF" : TEXT }}>حساب جديد</button>
            </div>

            {mode === "signup" && (
              <>
                <input className="inp" placeholder="اسمك الكامل" value={name} onChange={e => setName(e.target.value)} />
                <div className="mb-3 flex items-start gap-1.5 text-xs leading-5" style={{ color: MUTED }}>
                  <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                  أول شخص يسجّل في المشروع يبقى مالك المكتب تلقائيًا. أي حد بعده هيفضل "بانتظار الموافقة"
                  لحد ما مالك فعلي يوافق عليه من تبويب الإعدادات.
                </div>
              </>
            )}
            <input className="inp" type="email" placeholder="البريد الإلكتروني" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="inp" type="password" placeholder="كلمة المرور" value={password} onChange={e => setPassword(e.target.value)} />
            {error && <div className="mb-3 text-xs font-semibold" style={{ color: "#C00000" }}>{error}</div>}
            <button
              disabled={busy || !email.trim() || !password}
              onClick={mode === "signin" ? handleSignIn : handleSignUp}
              className="mt-1 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: NAVY }}
            >
              {busy ? "جاري التنفيذ…" : mode === "signin" ? "دخول" : "إنشاء الحساب والدخول"}
            </button>
          </>
        )}
        <button
          onClick={() => { setCloudConfig(null); window.location.reload(); }}
          className="mt-4 w-full text-center text-xs font-semibold underline"
          style={{ color: MUTED }}
        >
          تعذّر الدخول؟ ارجع مؤقتًا للوضع المحلي
        </button>
        <style>{`
          .inp { width: 100%; margin-bottom: 12px; padding: 9px 12px; border-radius: 8px; border: 1px solid ${BORDER}; font-size: 13px; font-family: 'Cairo', Arial, sans-serif; }
          .inp:focus { outline: 2px solid ${NAVY}; outline-offset: 0; }
        `}</style>
      </div>
    </div>
  );
}

/* ============================= Pending approval screen ============================= */
function PendingApprovalScreen({ onSignOut, onRefresh }) {
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => { onRefresh(); }, 15000);
    return () => clearInterval(interval);
  }, [onRefresh]);

  return (
    <div dir="rtl" className="flex min-h-[700px] w-full items-center justify-center" style={{ fontFamily: "'Cairo', Arial, sans-serif", backgroundColor: LIGHT }}>
      <div className="w-full max-w-md rounded-2xl p-8 text-center shadow-sm" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: "#FFF7E6" }}>
            <Loader2 size={26} className="animate-spin" style={{ color: "#8A6D00" }} />
          </div>
        </div>
        <div className="mb-2 text-lg font-bold" style={{ color: NAVY }}>حسابك بانتظار الموافقة</div>
        <p className="mb-5 text-sm leading-6" style={{ color: MUTED }}>
          تم إنشاء حسابك بنجاح، لكن لازم مالك المكتب يوافق عليك أولاً قبل ما تقدر تدخل على بيانات العملاء.
          الصفحة هتفتح تلقائيًا فور الموافقة — تقدر تسيبها مفتوحة أو ترجع بعد شوية.
        </p>
        <button
          onClick={async () => { setChecking(true); await onRefresh(); setChecking(false); }}
          className="mb-2 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50"
          disabled={checking}
          style={{ backgroundColor: NAVY }}
        >
          {checking ? "جاري التحقق…" : "تحقق الآن"}
        </button>
        <button onClick={onSignOut} className="w-full text-center text-xs font-semibold underline" style={{ color: MUTED }}>
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}

/* ============================= Settings ============================= */
function SettingsPanel({ settings, onSave, onExportBackup, onImportBackup, clientCount, team, currentMember, onAddMember, onRemoveMember, cloud, pendingMembers, onApproveMember }) {
  const [local, setLocal] = useState(settings);
  const fileInputRef = React.useRef(null);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("engineer");
  const [sbUrl, setSbUrl] = useState(getCloudConfig()?.url || "");
  const [sbKey, setSbKey] = useState(getCloudConfig()?.anonKey || "");
  const [wantSimpleMode, setWantSimpleMode] = useState(getCloudConfig()?.simpleMode || false);
  const [showSql, setShowSql] = useState(false);
  const currentSimpleMode = !!getCloudConfig()?.simpleMode;
  useEffect(() => setLocal(settings), [settings]);

  const SIMPLE_SQL_SCRIPT = `-- ⚠️ تحذير: لا تستخدم هذا الوضع مع رابط عام على الإنترنت.
-- أي شخص يفتح الرابط يحصل على صلاحية كاملة لقراءة وتعديل ومسح كل بيانات العملاء.
-- استخدمه فقط للتجربة المحلية، ثم أوقف Anonymous Sign-ins من Supabase فورًا.
-- SIMPLE / TESTING MODE — no per-person accounts, no approval step.
-- Anyone who opens the app with this project's URL + key gets full read/write
-- access instantly (via an anonymous session). Fine for early testing with your
-- own team; do NOT keep this on once real client data / real office use begins.
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table kv enable row level security;

drop policy if exists "approved members read kv" on kv;
drop policy if exists "approved members insert kv" on kv;
drop policy if exists "approved members update kv" on kv;
drop policy if exists "approved members delete kv" on kv;
drop policy if exists "authenticated read" on kv;
drop policy if exists "authenticated insert" on kv;
drop policy if exists "authenticated update" on kv;
drop policy if exists "authenticated delete" on kv;

create policy "anyone authenticated read kv" on kv for select using (auth.role() = 'authenticated');
create policy "anyone authenticated insert kv" on kv for insert with check (auth.role() = 'authenticated');
create policy "anyone authenticated update kv" on kv for update using (auth.role() = 'authenticated');
create policy "anyone authenticated delete kv" on kv for delete using (auth.role() = 'authenticated');

alter publication supabase_realtime add table kv;

-- IMPORTANT: also go to Authentication → Providers in Supabase and enable
-- "Anonymous Sign-ins" — it's off by default and this mode needs it.`;

  const SQL_SCRIPT = `-- shared data store (clients, settings) — access gated by approved role below
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- one row per real person, role assigned server-side only (never trusts the app)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'pending' check (role in ('pending','engineer','owner')),
  created_at timestamptz not null default now()
);

-- first person ever to sign up becomes owner automatically; everyone after
-- starts 'pending' until an existing owner approves them from the app
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select not exists(select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    case when is_first then 'owner' else 'pending' end
  );
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table kv enable row level security;
alter table profiles enable row level security;

-- remove any older, less-strict policies from a previous version of this setup
drop policy if exists "authenticated read" on kv;
drop policy if exists "authenticated insert" on kv;
drop policy if exists "authenticated update" on kv;
drop policy if exists "authenticated delete" on kv;
drop policy if exists "approved members read kv" on kv;
drop policy if exists "approved members insert kv" on kv;
drop policy if exists "approved members update kv" on kv;
drop policy if exists "approved members delete kv" on kv;
drop policy if exists "authenticated read profiles" on profiles;
drop policy if exists "owners update profiles" on profiles;

-- kv: only people an owner has actually approved (role owner/engineer) may read or write
create policy "approved members read kv" on kv for select
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members insert kv" on kv for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members update kv" on kv for update
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));
create policy "approved members delete kv" on kv for delete
  using (exists (select 1 from profiles where id = auth.uid() and role in ('owner','manager','engineer')));

-- profiles: anyone signed in can see the roster (needed to show pending/team lists);
-- only an existing owner can ever change someone's role — enforced twice (policy + trigger)
create policy "authenticated read profiles" on profiles for select
  using (auth.role() = 'authenticated');
create policy "owners update profiles" on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));

create or replace function public.prevent_self_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requester_role text;
begin
  select role into requester_role from profiles where id = auth.uid();
  if new.role is distinct from old.role and coalesce(requester_role,'') <> 'owner' then
    new.role := old.role;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_role_change on profiles;
create trigger enforce_role_change before update on profiles
  for each row execute procedure public.prevent_self_role_escalation();

alter publication supabase_realtime add table kv;
alter publication supabase_realtime add table profiles;`;

  const enableCloud = () => {
    if (!sbUrl.trim() || !sbKey.trim()) return;
    setCloudConfig({ url: sbUrl.trim(), anonKey: sbKey.trim(), simpleMode: wantSimpleMode });
    window.location.reload();
  };
  const disableCloud = () => {
    setCloudConfig(null);
    window.location.reload();
  };
  const switchMode = () => {
    const cfg = getCloudConfig();
    if (!cfg) return;
    setCloudConfig({ ...cfg, simpleMode: !cfg.simpleMode });
    window.location.reload();
  };

  return (
    <div className="max-w-lg">
      <h2 className="mb-4 text-xl font-bold" style={{ color: NAVY }}>الإعدادات العامة</h2>

      <div className="rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-1 flex items-center gap-2 text-sm font-bold" style={{ color: NAVY }}>
          <Wifi size={16} /> المزامنة السحابية بين الأجهزة (اختياري)
        </div>
        <p className="mb-3 text-xs leading-6" style={{ color: MUTED }}>
          بدون إعداد هذا القسم، الأداة تعمل محليًا على هذا الجهاز فقط. لو عايز كل مهندس يدخل من جهازه
          الشخصي ويشوف نفس البيانات لحظيًا، أنشئ مشروع مجاني على{" "}
          <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{ color: NAVY, fontWeight: "bold" }}>Supabase</a>
          {" "}(٥ دقائق)، وألصق بياناته هنا.
        </p>

        {cloud ? (
          <div className="rounded-lg p-3" style={{ backgroundColor: currentSimpleMode ? "#FEF3E2" : "#E2EFDA" }}>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold" style={{ color: currentSimpleMode ? "#B45309" : "#1E7B45" }}>
              <Wifi size={14} /> {currentSimpleMode ? "المزامنة مفعّلة — وضع تجريبي مبسط (بدون صلاحيات)" : "المزامنة مفعّلة — وضع الصلاحيات الكامل"}
            </div>
            {currentSimpleMode && (
              <p className="mb-2 text-xs leading-6" style={{ color: "#8A6D00" }}>
                أي جهاز يفتح نفس الرابط والمفتاح بيدخل فورًا بدون تسجيل أو موافقة. مناسب للتجربة الآن فقط —
                لما تكون جاهز لبيانات عملاء حقيقية، ارجع هنا واضغط "التحويل لوضع الصلاحيات الكامل".
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={switchMode} className="rounded-md px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: currentSimpleMode ? "#1E7B45" : "#B45309" }}>
                {currentSimpleMode ? "التحويل لوضع الصلاحيات الكامل" : "التحويل للوضع التجريبي المبسط"}
              </button>
              <button onClick={disableCloud} className="rounded-md px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: "#FFFFFF", color: "#C00000", border: "1px solid #C00000" }}>
                تعطيل المزامنة والعودة للتخزين المحلي
              </button>
            </div>
            <p className="mt-2 text-xs" style={{ color: MUTED }}>
              عند التحويل بين الوضعين لأول مرة، شغّل كود الـ SQL المناسب في Supabase (زرار "إظهار كود الإعداد" تحت).
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-start gap-2 rounded-lg p-3 text-xs leading-6" style={{ backgroundColor: "#FCE9E9", color: "#8A1414" }}>
              <ShieldCheck size={16} className="mt-0.5 shrink-0" />
              <span>
                <b>تحديث أمان مهم:</b> النسخة الأولى من كود الإعداد كانت بتسمح لأي شخص يعمل حساب جديد يختار
                لنفسه صلاحية "مالك المكتب"، وكانت قاعدة البيانات مش بتفرّق فعليًا بين الأدوار. لو سبق وفعّلت
                المزامنة بكود قديم، لازم تشغّل الكود المناسب تحت مرة كمان (آمن تمامًا يتكرر) عشان يقفل الثغرة.
              </span>
            </div>
            <Field label="Supabase Project URL">
              <input className="inp" placeholder="https://xxxxx.supabase.co" value={sbUrl} onChange={e => setSbUrl(e.target.value)} />
            </Field>
            <Field label="Supabase anon public key">
              <input className="inp" placeholder="eyJhbGciOi..." value={sbKey} onChange={e => setSbKey(e.target.value)} />
            </Field>
            <label className="mb-3 flex items-start gap-2 rounded-lg p-3 text-xs leading-6" style={{ backgroundColor: "#FEF3E2", color: "#8A6D00", cursor: "pointer" }}>
              <input type="checkbox" className="mt-0.5" checked={wantSimpleMode} onChange={e => setWantSimpleMode(e.target.checked)} />
              <span>
                <b>وضع تجريبي مبسط:</b> بدون تسجيل حسابات فردية ولا موافقة مالك — أي جهاز يفتح الرابط يدخل
                فورًا بكل الصلاحيات. مناسب لتجربة الفريق للنظام دلوقتي، لكن غير آمن لبيانات عملاء حقيقية.
                تقدر ترجع تفعّل الصلاحيات الكاملة لاحقًا من نفس الشاشة دي بدون ما تفقد بياناتك.
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={!sbUrl.trim() || !sbKey.trim()} onClick={enableCloud} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: "#1E7B45" }}>
                تفعيل المزامنة السحابية
              </button>
              <button onClick={() => setShowSql(!showSql)} className="rounded-lg px-4 py-2 text-sm font-bold" style={{ border: `1px solid ${NAVY}`, color: NAVY }}>
                {showSql ? "إخفاء" : "إظهار"} كود إعداد قاعدة البيانات (SQL)
              </button>
            </div>
            {showSql && (
              <div className="mt-3">
                <p className="mb-2 text-xs" style={{ color: MUTED }}>
                  شغّل كود واحد بس حسب الوضع اللي هتفعّله (آمن تمامًا تكرر التشغيل لاحقًا لو غيّرت رأيك):
                </p>
                <p className="mb-1 text-xs font-bold" style={{ color: "#B45309" }}>الوضع التجريبي المبسط:</p>
                <pre className="mb-3 overflow-x-auto rounded-lg p-3 text-xs" style={{ backgroundColor: "#1F1F1F", color: "#E5E7EB", direction: "ltr", textAlign: "left" }}>
                  {SIMPLE_SQL_SCRIPT}
                </pre>
                <p className="mb-1 text-xs font-bold" style={{ color: "#1E7B45" }}>وضع الصلاحيات الكامل:</p>
                <pre className="overflow-x-auto rounded-lg p-3 text-xs" style={{ backgroundColor: "#1F1F1F", color: "#E5E7EB", direction: "ltr", textAlign: "left" }}>
                  {SQL_SCRIPT}
                </pre>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-3 text-sm font-bold" style={{ color: NAVY }}>فريق المكتب والصلاحيات</div>

        {currentSimpleMode ? (
          <div className="flex items-start gap-2 rounded-lg p-3 text-xs leading-6" style={{ backgroundColor: "#FEF3E2", color: "#8A6D00" }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            الصلاحيات متوقفة مؤقتًا في الوضع التجريبي المبسط — كل من يفتح الرابط له كل الصلاحيات تلقائيًا.
            فعّل "وضع الصلاحيات الكامل" من قسم المزامنة السحابية فوق لاستخدام حسابات فردية وموافقة الأعضاء.
          </div>
        ) : (
        <>
        {cloud && can(currentMember, "manageTeam") && pendingMembers && pendingMembers.length > 0 && (
          <div className="mb-4 rounded-lg p-3" style={{ backgroundColor: "#FFF7E6" }}>
            <div className="mb-2 text-xs font-bold" style={{ color: "#8A6D00" }}>طلبات انضمام بانتظار الموافقة ({pendingMembers.length})</div>
            <div className="flex flex-col gap-2">
              {pendingMembers.map(p => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                  <div className="text-xs">
                    <div className="font-semibold">{p.name}</div>
                    <div style={{ color: MUTED }}>{p.email}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ASSIGNABLE_ROLES.map(r => (
                      <button
                        key={r}
                        onClick={() => onApproveMember(p.id, r)}
                        className="rounded-md px-2.5 py-1.5 text-xs font-bold"
                        style={{ backgroundColor: ROLES[r].color, color: ROLES[r].textOn }}
                      >
                        قبول كـ{ROLES[r].label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3 flex flex-col gap-2">
          {team.map(m => (
            <div key={m.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: LIGHT }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{m.name}</span>
                <Badge text={roleLabel(m.role)} color={(ROLES[m.role] || ROLES.engineer).color} />
                {currentMember?.id === m.id && <span className="text-xs" style={{ color: MUTED }}>(أنت الآن)</span>}
              </div>
              {!cloud && team.length > 1 && (
                <button onClick={() => onRemoveMember(m.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>

        {!cloud && (
          <div className="flex flex-wrap items-center gap-2">
            <input className="flex-1 rounded-md px-2.5 py-1.5 text-xs" style={{ border: `1px solid ${BORDER}`, minWidth: 140 }} placeholder="اسم العضو الجديد" value={newName} onChange={e => setNewName(e.target.value)} />
            <select className="rounded-md px-2 py-1.5 text-xs" style={{ border: `1px solid ${BORDER}` }} value={newRole} onChange={e => setNewRole(e.target.value)}>
              <option value="engineer">مهندس</option>
              <option value="owner">مالك المكتب</option>
            </select>
            <button
              onClick={() => { if (newName.trim()) { onAddMember(newName.trim(), newRole); setNewName(""); } }}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold text-white"
              style={{ backgroundColor: NAVY }}
            >
              <Plus size={13} /> إضافة
            </button>
          </div>
        )}

        <div className="mt-3 flex items-start gap-1.5 text-xs leading-5" style={{ color: MUTED }}>
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {cloud
            ? "كل مهندس بيسجّل حسابه بنفسه (بريد وكلمة سر حقيقيين)، ولازم مالك مكتب فعلي يوافق عليه من هنا قبل ما يشوف أي بيانات. الموافقة على الأدوار متحقّقة من قاعدة البيانات نفسها، مش من الواجهة فقط."
            : "كل مهندس بيشوف بس العملاء المعيّن عليهم كـ\"مهندس مسؤول\" (من صفحة تفاصيل العميل)، أما مالك المكتب فيشوف الكل. هذا تنظيم للعرض فقط داخل هذا الجهاز، وليس حماية أمنية حقيقية — أي شخص يفتح نفس الجهاز يقدر يوصل لكل البيانات المخزّنة فعليًا."}
        </div>
        </>
        )}
      </div>

      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <Field label="نسبة أتعاب الإشراف الهندسي %">
          <input type="number" step="0.1" className="inp" value={(local.supervisionPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, supervisionPct: Number(e.target.value) / 100 })} />
        </Field>
        <Field label="نسبة احتياطي الأعمال غير المنظورة %">
          <input type="number" step="0.1" className="inp" value={(local.contingencyPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, contingencyPct: Number(e.target.value) / 100 })} />
        </Field>
        <Field label="نسبة ضريبة القيمة المضافة %">
          <input type="number" step="0.1" className="inp" value={(local.vatPct * 100).toFixed(1)}
            onChange={e => setLocal({ ...local, vatPct: Number(e.target.value) / 100 })} />
        </Field>
        <button onClick={() => onSave(local)} className="mt-2 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: NAVY }}>
          <Save size={15} /> حفظ الإعدادات
        </button>
      </div>

      <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}` }}>
        <div className="mb-1 flex items-center gap-2 text-sm font-bold" style={{ color: NAVY }}>
          <ShieldCheck size={16} /> النسخ الاحتياطي والحفظ الدائم
        </div>
        <p className="mb-3 text-xs leading-6" style={{ color: MUTED }}>
          بيانات {clientCount} عميل محفوظة داخل هذا المتصفح على هذا الجهاز فقط (IndexedDB)، وتفضل موجودة حتى بعد إغلاق الجهاز أو قطع الإنترنت.
          لكنها لا تنتقل تلقائيًا لجهاز أو متصفح آخر — نزّل نسخة احتياطية بشكل دوري واحتفظ بها في مكان آمن (Google Drive مثلاً)،
          واستخدم "استيراد" على أي جهاز آخر لنقل نفس البيانات إليه.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={onExportBackup} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: GOLD }}>
            <Download size={15} /> تصدير نسخة احتياطية
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold" style={{ border: `1px solid ${NAVY}`, color: NAVY }}>
            <UploadCloud size={15} /> استيراد نسخة احتياطية
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) onImportBackup(e.target.files[0]); e.target.value = ""; }}
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl p-4 text-xs leading-6" style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}`, color: MUTED }}>
        هذه النسب تنعكس تلقائيًا على حساب كل عميل بمجرد الحفظ. البيانات محفوظة بشكل خاص، ولا يراها إلا من يستخدم هذا الجهاز والمتصفح.
      </div>
      <style>{`
        .inp { width: 100%; margin-top: 4px; margin-bottom: 12px; padding: 8px 10px; border-radius: 8px; border: 1px solid ${BORDER}; font-size: 13px; font-family: 'Cairo', Arial, sans-serif; }
        .inp:focus { outline: 2px solid ${NAVY}; outline-offset: 0; }
      `}</style>
    </div>
  );
}

/* ============================= Stability wrapper ============================= */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div dir="rtl" style={{ fontFamily: "'Cairo', Arial, sans-serif", padding: 40, textAlign: "center", color: "#1F2937" }}>
          <h2 style={{ color: "#C00000", marginBottom: 10 }}>حدث خطأ غير متوقع في التطبيق</h2>
          <p style={{ color: "#6B7280", marginBottom: 16 }}>
            بياناتك محفوظة بأمان في المتصفح ولم تتأثر. حاول تحديث الصفحة، ولو استمرت المشكلة استخدم نسخة احتياطية سابقة من تبويب الإعدادات.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ backgroundColor: "#1F4E78", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: "bold", cursor: "pointer" }}
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function StorageUnsupported() {
  return (
    <div dir="rtl" style={{ fontFamily: "'Cairo', Arial, sans-serif", padding: 40, textAlign: "center", color: "#1F2937" }}>
      <h2 style={{ color: "#C00000", marginBottom: 10 }}>هذا المتصفح لا يدعم التخزين الدائم</h2>
      <p style={{ color: "#6B7280" }}>
        يرجى فتح هذه الأداة من متصفح حديث (Chrome / Edge / Firefox / Safari) خارج وضع التصفح الخفي، لضمان حفظ بياناتك بشكل دائم.
      </p>
    </div>
  );
}

export default function App() {
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    if (!("indexedDB" in window)) setSupported(false);
  }, []);
  if (!supported) return <StorageUnsupported />;
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
