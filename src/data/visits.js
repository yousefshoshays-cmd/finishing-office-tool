import { storageGet, storageSet, storageDelete, storageListKeys } from "./storage.js";


export function newVisit(clientId) {
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
export async function loadVisits(clientId) {
  const keys = await storageListKeys(`visit:${clientId}:`);
  const visits = [];
  for (const k of keys) {
    const v = await storageGet(k, null);
    if (v) visits.push(v);
  }
  visits.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  return visits;
}
export async function saveVisit(visit) {
  await storageSet(`visit:${visit.clientId}:${visit.id}`, visit);
}
export async function deleteVisitEntry(clientId, id) {
  await storageDelete(`visit:${clientId}:${id}`);
}
