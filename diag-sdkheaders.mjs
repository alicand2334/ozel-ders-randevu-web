// TEK SEFERLIK — SDK'nın PostgREST'e gönderdiği header'lari yakala
// ve service-role bypass'in SDK yoluyla çalışıp çalışmadığını test et.
// Hicbir silme yapmaz; yalnızca head-only select.
import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch } from "undici";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Eksik env.");
  process.exit(2);
}

// SDK'nın PostgREST isteğini loglayan wrapper — select'ler dahil.
function loggingFetch(input, init) {
  try {
    const u = typeof input === "string" ? input : input?.url ?? String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (u.includes("/rest/v1/")) {
      // init tamamini inspect et (headers nerede tutuluyor görmek için)
      const initKeys = init ? Object.keys(init) : [];
      const h = init?.headers;
      const masked = {};
      function maskHeaders(obj) {
        if (!obj) return;
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string" && (k.toLowerCase() === "authorization" || k.toLowerCase() === "apikey")) {
            masked[k] = `${v.substring(0, 12)}...(len=${v.length})`;
          } else {
            masked[k] = v;
          }
        }
      }
      maskHeaders(h);
      // Headers bazen Headers (undici Headers nesnesi) olarak geliyor
      if (h && typeof h.forEach === "function") {
        h.forEach((v, k) => {
          if (k.toLowerCase() === "authorization" || k.toLowerCase() === "apikey") {
            masked[k] = `${String(v).substring(0, 12)}...(len=${String(v).length})`;
          } else {
            masked[k] = v;
          }
        });
      }
      console.error("[REST INSPECT]", JSON.stringify({ url: u, method, initKeys, headers: masked }, null, 2));
    }
  } catch (e) { console.error("[REST INSPECT ERROR]", e?.message); }
  return undiciFetch(input, init);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: loggingFetch },
});

console.error("=== 1) SDK select appointments (head) ===");
const r1 = await admin.from("appointments").select("id", { count: "exact", head: true });
console.error(JSON.stringify({ count: r1.count, errCode: r1.error?.code, errMsg: r1.error?.message }, null, 2));

console.error("\n=== 2) SDK select profiles (head) ===");
const r2 = await admin.from("profiles").select("id", { count: "exact", head: true });
console.error(JSON.stringify({ count: r2.count, errCode: r2.error?.code, errMsg: r2.error?.message }, null, 2));

console.error("\n=== 3) SDK select availability (head) ===");
const r3 = await admin.from("availability").select("id", { count: "exact", head: true });
console.error(JSON.stringify({ count: r3.count, errCode: r3.error?.code, errMsg: r3.error?.message }, null, 2));

console.error("\n=== 4) SDK select notifications (head) ===");
const r4 = await admin.from("notifications").select("id", { count: "exact", head: true });
console.error(JSON.stringify({ count: r4.count, errCode: r4.error?.code, errMsg: r4.error?.message }, null, 2));

console.error("\n=== 5) SDK select teacher_students (head) ===");
const r5 = await admin.from("teacher_students").select("id", { count: "exact", head: true });
console.error(JSON.stringify({ count: r5.count, errCode: r5.error?.code, errMsg: r5.error?.message }, null, 2));
