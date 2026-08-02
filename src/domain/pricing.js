import { ITEMS, SPECS, DEFAULT_SETTINGS } from "./catalogue.js";
import { LEVELS, SCOPES, STAGES } from "../ui/tokens.js";


export function newClient() {
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
export function resolveItem(client, item, area) {
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


export function calcClient(client, settings) {
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
