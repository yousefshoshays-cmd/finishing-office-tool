/* يولّد بيانات عميل نموذجي جاهزة للحقن في IndexedDB للمعاينة البصرية */
import { newClient, buildContractSnapshot, calcClient } from "../src/domain/pricing.js";
import { DEFAULT_SETTINGS } from "../src/domain/catalogue.js";
import * as pb from "../src/domain/pricebook.js";
import { applySuggestions, newRoom } from "../src/domain/rooms.js";

const settings = { ...DEFAULT_SETTINGS, agreedProfitPct: 0.12, officeName: "النخبة" };
let book = pb.DEFAULT_PRICEBOOK;
book = pb.setItemAnalysis(book, "PLS-001", 1, { materials: 45, labour: 60, equipment: 5 });
book = pb.setItemAnalysis(book, "STR-004", 1, { materials: 20, labour: 18, equipment: 4 });
book = pb.setItemAnalysis(book, "ELE-001", 1, { materials: 95, subcontract: 70 });
book = pb.setItemAnalysis(book, "MEP-001", 1, { materials: 150, subcontract: 90 });
book = pb.setItemAnalysis(book, "FIN-001", 1, { materials: 300, labour: 90, subcontract: 40 });
book = pb.setItemAnalysis(book, "FIN-006", 1, { materials: 22, labour: 26 });

let c = newClient();
c.name = "أحمد محمود"; c.area = 150; c.address = "التجمع الخامس، القاهرة";
c.phone = "01000000000"; c.stage = "قيد التنفيذ"; c.engineer = "المهندس يوسف";
const rooms = [
  { ...newRoom(1), name: "الريسبشن", type: "غرفة معيشة", length: 6, width: 5, height: 3, count: 1 },
  { ...newRoom(2), name: "نوم رئيسية", type: "غرفة نوم", length: 4.5, width: 3.8, height: 3, count: 1 },
  { ...newRoom(3), name: "نوم أطفال", type: "غرفة نوم", length: 3.8, width: 3.2, height: 3, count: 2 },
  { ...newRoom(4), name: "مطبخ", type: "مطبخ", length: 3.5, width: 2.8, height: 3, count: 1 },
  { ...newRoom(5), name: "حمامات", type: "حمام", length: 2.2, width: 1.8, height: 3, count: 2 },
];
c.rooms = rooms;
c = applySuggestions(c, rooms).client;
c.contract = buildContractSnapshot(c, settings, "المهندس يوسف");
c.receipts = [
  { id: "RCV-001", date: "2026-07-20", amount: 34143, phase: "التصميم والتسعير المبدئي", kind: "base", method: "تحويل بنكي", note: "قيمة — التصميم والتسعير المبدئي" },
  { id: "RCV-002", date: "2026-08-06", amount: 4097, phase: "التصميم والتسعير المبدئي", kind: "profit", method: "نقدي", note: "ربح — التصميم والتسعير المبدئي" },
  { id: "RCV-003", date: "2026-08-08", amount: 11958, phase: "التعديلات المعمارية", kind: "base", method: "تحويل بنكي", note: "قيمة — التعديلات المعمارية" },
];
c.phaseDelivered = { "التصميم والتسعير المبدئي": "2026-08-05" };
c.contractors = [
  { id: "SUB-001", clientId: c.id, name: "أسطى محمود", trade: "محارة وبياض", phase: "التأسيس", contractValue: 60000, retentionPct: 0.05, startedAt: "2026-08-01", note: "" },
  { id: "SUB-002", clientId: c.id, name: "م. سامي", trade: "كهرباء", phase: "التأسيس", contractValue: 25000, retentionPct: 0.05, startedAt: "2026-08-03", note: "" },
];
c.expenses = [
  { id: "EXP-001", date: "2026-08-02", kind: "materials",   phase: "التأسيس", itemId: "PLS-001", contractorId: "", vendor: "مورد رمل وأسمنت", amount: 24500, retained: 0, note: "" },
  { id: "EXP-002", date: "2026-08-06", kind: "subcontract", phase: "التأسيس", itemId: "PLS-001", contractorId: "SUB-001", vendor: "", amount: 38000, retained: 2000, note: "مستخلص أول" },
  { id: "EXP-003", date: "2026-08-09", kind: "equipment",   phase: "التأسيس", itemId: "", contractorId: "", vendor: "إيجار ونش رفع", amount: 9000, retained: 0, note: "" },
  { id: "EXP-004", date: "2026-08-11", kind: "subcontract", phase: "التأسيس", itemId: "ELE-001", contractorId: "SUB-002", vendor: "", amount: 14250, retained: 750, note: "مستخلص أول" },
  { id: "EXP-005", date: "2026-08-13", kind: "labour",      phase: "التأسيس", itemId: "", contractorId: "", vendor: "عمالة يومية", amount: 6500, retained: 0, note: "" },
  { id: "EXP-006", date: "2026-08-14", kind: "other",       phase: "التأسيس", itemId: "", contractorId: "", vendor: "نقل ومخلفات", amount: 1800, retained: 0, note: "" },
];

const team = [{ id: "m1", name: "المهندس يوسف", role: "owner", email: "" }];
console.log(JSON.stringify({ settings, book, client: c, team }));
