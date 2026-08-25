// TEK SEFERLIK — Salt-okunur. Hic silme yapmaz.
// Şehri Soymaz (teacher) icin bagli kayit sayimlari + FK analizi.
import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch } from "undici";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: undiciFetch },
});

// Şehri Soymaz'ın teacherId'sini bul
const { data: profile } = await admin
  .from("profiles")
  .select("id, full_name, role")
  .eq("full_name", "Şehri Soymaz")
  .maybeSingle();
const tid = profile?.id;
console.error("teacherId:", tid);

// 1) Tum tablolarda kolon bazli sayim (ogretmene referans veren)
const refs = [
  ["appointments", "teacher_id"],
  ["appointments", "student_id"],
  ["availability", "teacher_id"],
  ["availability_overrides", "teacher_id"],
  ["teacher_students", "teacher_id"],
  ["teacher_students", "student_id"],
  ["teacher_students", "assigned_by"],
  ["notifications", "recipient_id"],
  ["notifications", "actor_id"],
  ["notifications", "appointment_id"], // FK fark
  ["slots", "teacher_id"],
  ["slots", "student_id"],
];

console.error("\n=== 1) Kolon bazli sayimlar ===");
for (const [t, col] of refs) {
  try {
    const r = await admin.from(t).select("id", { count: "exact", head: true }).eq(col, tid);
    console.error(`${t}.${col}: count=${r.count ?? "?"} err=${r.error ? `${r.error.code} ${r.error.message}` : ""}`);
  } catch (e) {
    console.error(`${t}.${col}: EXCEPTION ${e?.message}`);
  }
}

// 2) appointments durum bazli dagilim
console.error("\n=== 2) appointments status dagilim ===");
const { data: appts } = await admin
  .from("appointments")
  .select("status")
  .eq("teacher_id", tid);
if (appts) {
  const byStatus = {};
  for (const a of appts) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  console.error(JSON.stringify({ total: appts.length, byStatus }, null, 2));
} else {
  console.error("appointments select err");
}

// 3) appointments student_id olarak kaydi var mi
console.error("\n=== 3) appointments student_id olarak ===");
const { data: apptStu } = await admin
  .from("appointments")
  .select("id, status")
  .eq("student_id", tid);
console.error("appointments as student:", JSON.stringify(apptStu?.length ?? 0));

// 4) notifications sayim (kolon bazli bozan varsa)
console.error("\n=== 4) notifications ozet ===");
const { data: notifs } = await admin
  .from("notifications")
  .select("id, recipient_id, actor_id, appointment_id");
console.error(JSON.stringify({
  total: notifs?.length ?? 0,
  recipient_match: notifs?.filter(n => n.recipient_id === tid).length ?? 0,
  actor_match: notifs?.filter(n => n.actor_id === tid).length ?? 0,
}, null, 2));

// 5) teacher_students tam bak (assigned_by vs dahil)
console.error("\n=== 5) teacher_students ozet ===");
const { data: ts } = await admin
  .from("teacher_students")
  .select("teacher_id, student_id, assigned_by");
console.error(JSON.stringify({
  total: ts?.length ?? 0,
  asTeacher: ts?.filter(r => r.teacher_id === tid).length ?? 0,
  asStudent: ts?.filter(r => r.student_id === tid).length ?? 0,
  asAssigner: ts?.filter(r => r.assigned_by === tid).length ?? 0,
}, null, 2));

// 6) DB'den FK yapisi (auth.users'a referans var mi?)
console.error("\n=== 6) auth.users -> FK diyagonu (PG meta) ===");
const { data: fkRows, error: fkErr } = await admin.rpc("dijkstra", {}).catch(() => ({}));
// Supabase'de information_schema'a rpc erisimi yok; onun yerine
// /rest/v1/ uzerinden column list endpoint'leri yok. Bu yuzden
// SDK ile test: profiles'i silmek RLS policy mesaji veriyor —
// "Bu randevuyu silme yetkiniz yok." Bu, RLS policy metni; FK degil.
// Bit usült: bilinen migrationlardan FK'leri elle cikardik.

console.error("\n=== 7) Isim listesi — varsa baska bagli tablo ===");
// Supabase /rest/v1/OpenAPI completions ile tablo listesi alabiliyoruz
const openapi = await undiciFetch(`${url}/rest/v1/`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/openapi+json" },
});
console.error("openapi status:", openapi.status);
const oapi = await openapi.json();
const tables = Object.keys(oapi.paths || {}).filter(p => p.startsWith("/")).map(p => p.slice(1));
// uuid kolonlu referanslari bulan所在
console.error("Toplam PostgREST tablo:", tables.length);

console.error("\n=== 8) Confirm profiles rol ===");
console.error("profile id:", tid, "role:", profile?.role);
