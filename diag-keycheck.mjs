// TEK SEFERLIK — SUPABASE_SERVICE_ROLE_KEY teşhisi.
// Anahtarın kendisini, Jwt secret'ını veya Authorization header değerini
// loglamadan yalnızca format/rol bilgisini raporlar.
import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch } from "undici";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error("Eksik env.");
  process.exit(2);
}

// --- 1) Anahtar formatı: JWT mi sb_secret_ mu? ---
// Anahtarı loglamadan yalnızca yapısal özelliklerini raporla.
const isJwt = serviceKey.split(".").length === 3 && serviceKey.startsWith("ey");
const prefix = serviceKey.substring(0, 10);  // yalnizca prefix
const length = serviceKey.length;
console.error("=== 1) Anahtar formatı ===");
console.error(JSON.stringify({
  isJwt,
  prefix,          // "sb_secret_" ya da "eyJhbGciO" gibi
  length,
  startsWithSbSecret: serviceKey.startsWith("sb_secret_"),
  startsWithSbPublishable: serviceKey.startsWith("sb_publishable_"),
  startsWithEy: serviceKey.startsWith("ey"),
  hasThreeDotParts: serviceKey.split(".").length === 3,
}, null, 2));

// --- 2) Eğer JWT ise payload'ı decode et (secret değil, yalnızca rol) ---
function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
    const json = Buffer.from(payloadB64 + pad, "base64").toString("utf8");
    return JSON.parse(json);
  } catch { return null; }
}
console.error("\n=== 2) JWT payload (sadece rol/iss/ref) ===");
const payload = isJwt ? decodeJwtPayload(serviceKey) : null;
if (payload) {
  console.error(JSON.stringify({
    role: payload.role,
    iss: payload.iss,
    ref: payload.ref,
    token_since: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
    expires: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    // "aud", "sub" gibi alanları bilerek yazmıyoruz
  }, null, 2));
} else {
  console.error("Anahtar JWT değil (sb_secret_ formatı) — payload decode edilemez.");
}

// --- 3) PostgREST test: apikey=serviceKey ile /rest/v1/profiles?select=id&limit=0 ---
// Service-role bypass yetkisi varsa 200, yoksa 401/403 beklenir.
console.error("\n=== 3) PostgREST direct test (apikey=serviceKey) ===");
const restUrl = `${url}/rest/v1/profiles?select=id&limit=0`;
const res1 = await undiciFetch(restUrl, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
  },
});
const txt1 = await res1.text();
console.error(JSON.stringify({
  status: res1.status,
  ok: res1.ok,
  bodySample: txt1.slice(0, 200),
}, null, 2));

// --- 4) Aynı PostgREST çağrısı anon-key ile (rol kıyası) ---
console.error("\n=== 4) PostgREST direct test (apikey=anonKey) ===");
const res2 = await undiciFetch(restUrl, {
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: "application/json",
  },
});
const txt2 = await res2.text();
console.error(JSON.stringify({
  status: res2.status,
  ok: res2.ok,
  bodySample: txt2.slice(0, 200),
}, null, 2));

// --- 5) GoTrue admin endpoint test (serviceKey) ---
// /auth/v1/admin/users/{id} GET - getUserById
console.error("\n=== 5) GoTrue admin GET (serviceKey) ===");
const anyId = "00000000-0000-0000-0000-000000000000";
const res3 = await undiciFetch(`${url}/auth/v1/admin/users/${anyId}`, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  },
});
const txt3 = await res3.text();
console.error(JSON.stringify({
  status: res3.status,
  ok: res3.ok,
  bodySample: txt3.slice(0, 200),
}, null, 2));

// --- 6) PostgREST appointments tablosu izin testi ---
console.error("\n=== 6) PostgREST appointments select (serviceKey) ===");
const res4 = await undiciFetch(`${url}/rest/v1/appointments?select=id&limit=0`, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
  },
});
const txt4 = await res4.text();
console.error(JSON.stringify({
  status: res4.status,
  ok: res4.ok,
  bodySample: txt4.slice(0, 200),
}, null, 2));
