import { openDB } from "idb";
import { createClient } from "@supabase/supabase-js";


export const DB_NAME = "boq_office_db";
export const STORE = "kv";
export const CLOUD_CONFIG_KEY = "boq_cloud_config"; // raw localStorage key — must exist before we know which mode to use

// Built into this deployment so anyone opening the site is connected automatically —
// no copy/paste setup per device. The publishable key is safe to ship in client code
// by design; real protection comes from the database's row-level security policies,
// not from hiding this value. To point this deployment at a different Supabase
// project, just change these two lines and rebuild.
export const DEFAULT_SUPABASE_URL = "https://oovityllspqojxexkrxg.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_xDKo_zVZU606enHf-RtOIw_e_uabv4Y";
// SECURITY: simple mode grants every anonymous visitor full read/write on all client
// data. It must never be the default for a publicly reachable deployment. The owner can
// still turn it on deliberately from Settings for offline testing.
export const DEFAULT_SIMPLE_MODE = false;

let dbPromise = null;
export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

export function getCloudConfig() {
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
export function setCloudConfig(cfg) {
  try {
    if (cfg) window.localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cfg));
    else window.localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify({ disabled: true }));
  } catch (e) {
    console.error("setCloudConfig failed", e);
  }
}
export function isCloudMode() {
  const cfg = getCloudConfig();
  return !!(cfg && cfg.url && cfg.anonKey);
}
export function isSimpleMode() {
  const cfg = getCloudConfig();
  return !!(cfg && cfg.simpleMode);
}
let _supabaseClient = null;
export function getSupabase() {
  const cfg = getCloudConfig();
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  if (_supabaseClient && _supabaseClient.__url === cfg.url) return _supabaseClient;
  _supabaseClient = createClient(cfg.url, cfg.anonKey);
  _supabaseClient.__url = cfg.url;
  return _supabaseClient;
}

export async function localGet(key, fallback) {
  try {
    const db = await getDB();
    const v = await db.get(STORE, key);
    return v !== undefined ? v : fallback;
  } catch (e) {
    console.error("localGet failed", key, e);
    return fallback;
  }
}
export async function localSet(key, value) {
  try {
    const db = await getDB();
    await db.put(STORE, value, key);
    return true;
  } catch (e) {
    console.error("localSet failed", key, e);
    return false;
  }
}
export async function localDelete(key) {
  try {
    const db = await getDB();
    await db.delete(STORE, key);
  } catch (e) {
    console.error("localDelete failed", key, e);
  }
}
export async function localListKeys(prefix) {
  try {
    const db = await getDB();
    const all = await db.getAllKeys(STORE);
    return all.filter((k) => typeof k === "string" && k.startsWith(prefix));
  } catch (e) {
    console.error("localListKeys failed", prefix, e);
    return [];
  }
}
export async function localGetAllEntries() {
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

export function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function cloudGet(key, fallback) {
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
export async function cloudSet(key, value) {
  const sb = getSupabase();
  try {
    const { error } = await withTimeout(sb.from("kv").upsert({ key, value, updated_at: new Date().toISOString() }));
    return !error;
  } catch (e) {
    console.error("cloudSet failed", key, e);
    return false;
  }
}
export async function cloudDelete(key) {
  const sb = getSupabase();
  try {
    await withTimeout(sb.from("kv").delete().eq("key", key));
  } catch (e) {
    console.error("cloudDelete failed", key, e);
  }
}
export async function cloudListKeys(prefix) {
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
export async function cloudGetAllEntries() {
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

export async function storageGet(key, fallback) {
  return isCloudMode() ? cloudGet(key, fallback) : localGet(key, fallback);
}
export async function storageSet(key, value) {
  return isCloudMode() ? cloudSet(key, value) : localSet(key, value);
}
export async function storageDelete(key) {
  return isCloudMode() ? cloudDelete(key) : localDelete(key);
}
export async function storageListKeys(prefix) {
  return isCloudMode() ? cloudListKeys(prefix) : localListKeys(prefix);
}
export async function storageGetAllEntries() {
  return isCloudMode() ? cloudGetAllEntries() : localGetAllEntries();
}
