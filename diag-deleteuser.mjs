// TEK SEFERLIK — Şehri Soymaz'a bağlı tüm verileri güvenli sırayla temizle
// ve ardından auth kullanıcısını sil. Sadece bu kullanıcı.
import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch } from "undici";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Eksik env.");
  process.exit(2);
}

function inspectingFetch(input, init) {
  try {
    const u = typeof input === "string" ? input : input?.url ?? String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "DELETE" && u.includes("/admin/users/")) {
      const headersIn = init?.headers;
      const bodyRaw = init?.body;
      let bodyStr;
      if (typeof bodyRaw === "string") bodyStr = bodyRaw;
      else if (bodyRaw === undefined || bodyRaw === null) bodyStr = "UNDEFINED";
      else { try { bodyStr = JSON.stringify(bodyRaw); } catch { bodyStr = "INSPECT_FAILED"; } }
      console.error("[DELETE INSPECT]", JSON.stringify({
        url: u, method,
        headers: headersIn ? { ...headersIn } : undefined,
        bodyRawType: typeof bodyRaw, bodyStr,
        bodyLength: typeof bodyRaw === "string" ? bodyRaw.length : (bodyRaw === undefined || bodyRaw === null ? -1 : -2),
      }, null, 2));
    }
  } catch {}
  return undiciFetch(input, init);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: inspectingFetch },
});

console.error("=== 1) Şehri Soymaz UUID'sini bul ===");
const { data: profile } = await admin
  .from("profiles")
  .select("id, full_name, role")
  .eq("full_name", "Şehri Soymaz")
  .maybeSingle();
if (!profile || profile.role !== "teacher") {
  console.error("Kayıt/bulunamadı veya rol teacher değil:", JSON.stringify(profile));
  process.exit(3);
}
const tid = profile.id;
console.error("teacherId:", tid);

// Önce mevcut bağlı kayıt sayılarını raporla
console.error("\n=== 2) Bağlı kayıt sayımları ===");
const tables = [
  { t: "appointments", col: "teacher_id" },
  { t: "appointments", col: "student_id" },
  { t: "availability", col: "teacher_id" },
  { t: "availability_overrides", col: "teacher_id" },
  { t: "teacher_students", col: "teacher_id" },
  { t: "teacher_students", col: "student_id" },
  { t: "notifications", col: "recipient_id" },
  { t: "notifications", col: "actor_id" },
];
for (const { t, col } of tables) {
  const { count, error } = await admin
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq(col, tid);
  console.error(`count ${t}.${col}=${tid}:`, count, error ? `ERR ${error.message}` : "");
}

// appointments→notifications ON DELETE CASCADE, appointments→slots on delete restrict.
// 0023: appointments.slot_id FK ON DELETE RESTRICT. Önce appointments sil, sonra
// notificationlar cascade düşer. Availability/overrides/teacher_studentsprofiles cascade.
console.error("\n=== 3) appointments sil (notifications cascade) ===");
const apptDel = await admin.from("appointments").delete().eq("teacher_id", tid);
console.error("appointments delete:", apptDel.error ? `ERR ${apptDel.error.code} ${apptDel.error.message}` : "OK");

console.error("\n=== 3b) student_id olarakOlduğu appointments (varsa) ===");
const apptStu = await admin.from("appointments").delete().eq("student_id", tid);
console.error("appointments (student):", apptStu.error ? `ERR ${apptStu.error.code} ${apptStu.error.message}` : "OK");

console.error("\n=== 4) teacher_students sil ===");
const tsT = await admin.from("teacher_students").delete().eq("teacher_id", tid);
console.error("teacher_students (teacher):", tsT.error ? `ERR ${tsT.error.code} ${tsT.error.message}` : "OK");
const tsS = await admin.from("teacher_students").delete().eq("student_id", tid);
console.error("teacher_students (student):", tsS.error ? `ERR ${tsS.error.code} ${tsS.error.message}` : "OK");

console.error("\n=== 5) notifications sil ===");
const nR = await admin.from("notifications").delete().eq("recipient_id", tid);
console.error("notifications (recipient):", nR.error ? `ERR ${nR.error.code} ${nR.error.message}` : "OK");
const nA = await admin.from("notifications").delete().eq("actor_id", tid);
console.error("notifications (actor):", nA.error ? `ERR ${nA.error.code} ${nA.error.message}` : "OK");

console.error("\n=== 6) availability_overrides sil ===");
const ao = await admin.from("availability_overrides").delete().eq("teacher_id", tid);
console.error("availability_overrides:", ao.error ? `ERR ${ao.error.code} ${ao.error.message}` : "OK");

console.error("\n=== 7) availability sil ===");
const av = await admin.from("availability").delete().eq("teacher_id", tid);
console.error("availability:", av.error ? `ERR ${av.error.code} ${av.error.message}` : "OK");

console.error("\n=== 8) profiles sil ===");
const pr = await admin.from("profiles").delete().eq("id", tid);
console.error("profiles:", pr.error ? `ERR ${pr.error.code} ${pr.error.message}` : "OK");

console.error("\n=== 9) auth.users sil (deleteUser) ===");
const del = await admin.auth.admin.deleteUser(tid);
console.error("deleteUser result:", JSON.stringify({
  ok: !del?.error,
  errName: del?.error?.name,
  errMsg: del?.error?.message,
  errStatus: del?.error?.status,
}, null, 2));

console.error("\n=== 10) final kontrol ===");
const { data: pAfter } = await admin.from("profiles").select("id").eq("id", tid).maybeSingle();
console.error("profile after:", JSON.stringify(pAfter));
const probe = await admin.auth.admin.getUserById(tid);
console.error("auth user after:", JSON.stringify({ ok: !!probe?.data?.user, errMsg: probe?.error?.message }));
