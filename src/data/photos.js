import { getSupabase, isCloudMode, withTimeout } from "./storage.js";

/* ════════════════════════════════════════════════════════════════
   صور الموقع

   قرار: الصور تُخزَّن في Supabase Storage لا في جدول البيانات.
   تحويلها base64 وحشرها في jsonb يجعل كل قراءة لعميل تسحب
   ميغابايتات، ويصطدم بحد حجم الصف. الرابط وحده هو ما يُحفظ.

   قرار ثانٍ: الضغط يحدث في المتصفح قبل الرفع. صورة هاتف حديثة
   تتجاوز 4 ميغابايت، ولا قيمة لهذه الدقة في توثيق موقع — عرض
   1600 بكسل يكفي لإثبات حالة تنفيذ، ويقلّص الحجم لعُشره تقريبًا.
   ════════════════════════════════════════════════════════════════ */

export const PHOTO_BUCKET = "site-photos";
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;   // قبل الضغط
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/* ---------- الضغط ---------- */

export function compressImage(file, { maxEdge = MAX_EDGE, quality = JPEG_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("الملف ليس صورة"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => blob ? resolve({ blob, width: w, height: h }) : reject(new Error("تعذّر ضغط الصورة")),
        "image/jpeg", quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذّرت قراءة الصورة")); };
    img.src = url;
  });
}

/* ---------- المسارات ---------- */
/* clients/<clientId>/<visitId>/<timestamp>.jpg — الحذف المتتالي للعميل سهل */

export function photoPath(clientId, visitId, name = "") {
  const stamp = Date.now().toString(36);
  const safe = String(name).replace(/[^\w.-]+/g, "_").slice(-40) || "photo";
  return `clients/${clientId}/${visitId}/${stamp}_${safe}.jpg`;
}

/* ---------- العمليات ---------- */

function bucket() {
  const sb = getSupabase();
  if (!sb) throw new Error("المزامنة السحابية غير مفعّلة — رفع الصور يحتاجها");
  return sb.storage.from(PHOTO_BUCKET);
}

export function photosAvailable() {
  return isCloudMode() && !!getSupabase();
}

export async function uploadPhoto(clientId, visitId, file) {
  if (!photosAvailable()) throw new Error("رفع الصور يحتاج تفعيل المزامنة السحابية");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("حجم الصورة أكبر من 8 ميجابايت");

  const { blob, width, height } = await compressImage(file);
  const path = photoPath(clientId, visitId, file.name);

  const { error } = await withTimeout(
    bucket().upload(path, blob, { contentType: "image/jpeg", upsert: false }),
    30000
  );
  if (error) throw new Error(translateStorageError(error));

  return {
    path,
    width, height,
    bytes: blob.size,
    originalBytes: file.size,
    uploadedAt: new Date().toISOString(),
  };
}

export async function listPhotos(clientId, visitId) {
  if (!photosAvailable()) return [];
  const { data, error } = await withTimeout(
    bucket().list(`clients/${clientId}/${visitId}`, { limit: 100, sortBy: { column: "name", order: "desc" } })
  );
  if (error || !data) return [];
  return data.map(f => ({ path: `clients/${clientId}/${visitId}/${f.name}`, name: f.name }));
}

export async function deletePhoto(path) {
  if (!photosAvailable()) return false;
  const { error } = await withTimeout(bucket().remove([path]));
  return !error;
}

/* رابط موقّت للعرض. الـ bucket خاص، فلا روابط دائمة —
   وهذا مقصود: صور مواقع العملاء ليست محتوى عامًا. */
export async function signedUrl(path, seconds = 3600) {
  if (!photosAvailable()) return null;
  const { data, error } = await withTimeout(bucket().createSignedUrl(path, seconds));
  return error || !data ? null : data.signedUrl;
}

export async function signedUrls(paths, seconds = 3600) {
  if (!photosAvailable() || paths.length === 0) return {};
  const { data, error } = await withTimeout(bucket().createSignedUrls(paths, seconds));
  if (error || !data) return {};
  return Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
}

/* رسائل الخادم بالإنجليزية وغير مفهومة للمستخدم — نترجم الشائع منها */
function translateStorageError(error) {
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("bucket not found")) {
    return `مساحة التخزين "${PHOTO_BUCKET}" غير موجودة — أنشئها من Supabase → Storage`;
  }
  if (msg.includes("duplicate") || msg.includes("already exists")) return "الصورة مرفوعة بالفعل";
  if (msg.includes("row-level security") || msg.includes("unauthorized") || msg.includes("403")) {
    return "لا تملك صلاحية رفع الصور — راجع سياسات مساحة التخزين";
  }
  if (msg.includes("payload") || msg.includes("too large")) return "حجم الصورة كبير جدًا";
  return error?.message || "تعذّر رفع الصورة";
}

export function humanSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} كيلوبايت`;
  return `${(bytes / 1048576).toFixed(1)} ميجابايت`;
}
