import { getSupabase, withTimeout } from "./storage.js";


export async function fetchMyProfile(userId) {
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
export async function fetchAllProfiles() {
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
export async function approveProfile(id, role) {
  const sb = getSupabase();
  try {
    const { error } = await withTimeout(sb.from("profiles").update({ role }).eq("id", id));
    return !error;
  } catch (e) {
    console.error("approveProfile failed", e);
    return false;
  }
}
