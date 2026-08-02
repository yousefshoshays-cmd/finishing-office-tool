import { newClient, resolveItem, calcClient } from "../src/domain/pricing.js";
import { ITEMS, DEFAULT_SETTINGS, fmt } from "../src/domain/catalogue.js";
import { can, roleLabel } from "../src/domain/permissions.js";

const c = newClient(); c.area = 150;
const base = calcClient(c, DEFAULT_SETTINGS);
console.log("الإجمالي الافتراضي (150 م²):", fmt(base.grandTotal), "ج.م");

const item = ITEMS[12];            // [scope, name, unit, qtyFn, prices]
const before = resolveItem(c, item, 150);
c.itemPrice = { [item[1]]: before.price * 2 };
c.itemPriceDate = { [item[1]]: "2026-08-02" };
const after = resolveItem(c, item, 150);
console.log(`\nبند: ${item[1]}`);
console.log(`  سعر الوحدة ${before.price} → ${after.price}   تجاوز=${after.hasPriceOverride}`);
console.log(`  إجمالي البند ${fmt(before.total)} → ${fmt(after.total)}`);

const c2 = calcClient(c, DEFAULT_SETTINGS);
const diff = c2.grandTotal - base.grandTotal;
console.log("\nالإجمالي بعد التجاوز:", fmt(c2.grandTotal), diff > 0 ? `✅ ارتفع بـ ${fmt(diff)}` : "❌ لم يتأثر");
console.log("أثر الضريبة والإشراف منتشر:", Math.abs(diff - (after.total - before.total)) > 1 ? "✅ نعم" : "⚠️ لا");

console.log("\n--- الصلاحيات ---");
for (const r of ["engineer","manager","owner"])
  console.log(`${roleLabel(r).padEnd(12)} سعر:${can({role:r},"editUnitPrice")?"✅":"❌"}  كل العملاء:${can({role:r},"viewAllClients")?"✅":"❌"}  مسح:${can({role:r},"deleteClient")?"✅":"❌"}`);
console.log("زائر بلا دور:", can(null,"editUnitPrice") ? "❌ خطر" : "✅ ممنوع");
console.log("دور ملفّق:", can({role:"admin"},"deleteClient") ? "❌ خطر" : "✅ ممنوع");
