// TEK SEFERLIK — SDK delete() cagrisinin gonderdigi request'i
// gondermeden logla (abort). Hicbir tabloda silme olmaz.
import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch } from "undici";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  console.error("Eksik env.");
  process.exit(2);
}

// DELETE /rest/v1/... gelirse logla ve ABORT et (gerçek silme olmaz).
function abortDeleteFetch(input, init) {
  try {
    const u = typeof input === "string" ? input : input?.url ?? String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (u.includes("/rest/v1/") && method === "DELETE") {
      const h = init?.headers;
      const masked = {};
      function mask(obj) {
        if (!obj) return;
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string" && (k.toLowerCase() === "authorization" || k.toLowerCase() === "apikey")) {
            masked[k] = `${v.substring(0, 12)}...(len=${v.length})`;
          } else {
            masked[k] = v;
          }
        }
      }
      mask(h);
      if (h && typeof h.forEach === "function") {
        h.forEach((v, k) => {
          if (k.toLowerCase() === "authorization" || k.toLowerCase() === "apikey") {
            masked[k] = `${String(v).substring(0, 12)}...(len=${String(v).length})`;
          } else {
            masked[k] = v;
          }
        });
      }
      console.error("[SDK DELETE INSPECT]", JSON.stringify({
        url: u, method, headers: masked, hasBody: init?.body !== undefined,
      }, null, 2));
      // Abort: request'i hic gondermeden hata firlat.
      throw new Error("ABORTED_BEFORE_SEND — silme yapilmadi");
    }
  } catch (e) {
    if (e?.message?.startsWith("ABORTED")) throw e;
    // diğer hatalar: yine de devam etme, güveli tarafta kal
    throw e;
  }
  return undiciFetch(input, init);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: abortDeleteFetch },
});

const tid = "e0564f1f-77d8-44b4-926d-89f05e9225ad"; // Şehri Soymaz
console.error("=== SDK delete appointments (abort edilecek) ===");
const r = await admin.from("appointments").delete().eq("teacher_id", tid);
console.error("sonuç:", JSON.stringify({
  err: r.error ? `${r.error.code} ${r.error.message}` : (r.statusText ?? "OK"),
  rawErr: r.error ? String(r.error) : null,
}, null, 2));
