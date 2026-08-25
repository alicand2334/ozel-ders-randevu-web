// TEK SEFERLIK — Şehri Soymaz (e0564f1f-77d8-44b4-926d-89f05e9225ad)
// için SDK delete() çağrısı abort'suz, gerçek silme yapar.
import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch } from "undici";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) process.exit(2);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: undiciFetch },
});

const tid = "e0564f1f-77d8-44b4-926d-89f05e9225ad";

// Önce mevcut sayımlar
console.error("=== Önce sayımlar ===");
for (const [t, col] of [
  ["appointments", "teacher_id"],
  ["availability", "teacher_id"],
  ["availability_overrides", "teacher_id"],
  ["teacher_students", "teacher_id"],
  ["notifications", "actor_id"],
  ["notifications", "recipient_id"],
  ["profiles", "id"],
]) {
  const r = await admin.from(t).select("id", { count: "exact", head: true }).eq(col, tid);
  console.error(`count ${t}.${col}:`, r.count, r.error ? `ERR ${r.error.code} ${r.error.message}` : "");
}

// 1) appointments sil — notifications ve slot ilişkileri handle
console.error("\n=== 1) SDK delete appointments ===");
const a = await admin.from("appointments").delete().eq("teacher_id", tid);
console.error(JSON.stringify({
  errCode: a.error?.code,
  errMsg: a.error?.message,
  status: a.status,
  count: a.count,
}, null, 2));

// 2) availability_overrides sil
console.error("\n=== 2) SDK delete availability_overrides ===");
const ao = await admin.from("availability_overrides").delete().eq("teacher_id", tid);
console.error(JSON.stringify({
  errCode: ao.error?.code, errMsg: ao.error?.message, status: ao.status, count: ao.count,
}, null, 2));

// 3) availability sil
console.error("\n=== 3) SDK delete availability ===");
const av = await admin.from("availability").delete().eq("teacher_id", tid);
console.error(JSON.stringify({
  errCode: av.error?.code, errMsg: av.error?.message, status: av.status, count: av.count,
}, null, 2));

// 4) teacher_students sil (teacher_id olarak)
console.error("\n=== 4) SDK delete teacher_students ===");
const ts = await admin.from("teacher_students").delete().eq("teacher_id", tid);
console.error(JSON.stringify({
  errCode: ts.error?.code, errMsg: ts.error?.message, status: ts.status, count: ts.count,
}, null, 2));

// 5) notifications actor_id olarak sil (kalan kalıntı)
console.error("\n=== 5) SDK delete notifications (actor_id) ===");
const n = await admin.from("notifications").delete().eq("actor_id", tid);
console.error(JSON.stringify({
  errCode: n.error?.code, errMsg: n.error?.message, status: n.status, count: n.count,
}, null, 2));

// 6) profiles sil
console.error("\n=== 6) SDK delete profiles ===");
const p = await admin.from("profiles").delete().eq("id", tid);
console.error(JSON.stringify({
  errCode: p.error?.code, errMsg: p.error?.message, status: p.status, count: p.count,
}, null, 2));

// 7) auth.users sil
console.error("\n=== 7) SDK deleteUser ===");
const d = await admin.auth.admin.deleteUser(tid);
console.error(JSON.stringify({
  ok: !d?.error,
  errName: d?.error?.name,
  errMsg: d?.error?.message,
  errStatus: d?.error?.status,
  errCode: d?.error?.code,
}, null, 2));

console.error("\n=== Son durum ===");
const pAfter = await admin.from("profiles").select("id").eq("id", tid).maybeSingle();
console.error("profile after:", JSON.stringify(pAfter.data));
const probe = await admin.auth.admin.getUserById(tid);
console.error("auth user after:", JSON.stringify({ ok: !!probe?.data?.user, errMsg: probe?.error?.message }));
