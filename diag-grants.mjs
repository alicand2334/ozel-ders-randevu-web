// Salt-okunur: service_role DELETE yetkilerini has_table_privilege ile kontrol.
import { fetch as f } from "undici";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };

const tabs = ["profiles","appointments","availability","availability_overrides","teacher_students","notifications"];

console.error("=== A) DELETE yetki testi (nonexistent PK — silme olmaz) ===");
const NON = "00000000-0000-0000-0000-000000000000";
for (const t of tabs) {
  // notifications PK id uuid ama recipient_id ile deneyelim,
  // yoksa id PK'si yok — hepsinde id PK mevcut (notificationsda id PK).
  const r = await f(`${url}/rest/v1/${t}?id=eq.${NON}`, {
    method: "DELETE",
    headers: { ...H, "Range": "0-0", "Prefer": "return=minimal" },
  });
  const txt = await r.text();
  console.error(`${t}: status=${r.status} body=${txt.slice(0, 200)}`);
}

// A2) Ayni tablolarda nonexistent id ile GET — SELECT yetkisini dogrula
console.error("\n=== A2) SELECT yetki testi (nonexistent PK — donüs bos) ===");
for (const t of tabs) {
  const r = await f(`${url}/rest/v1/${t}?id=eq.${NON}&select=id`, { headers: H });
  const txt = await r.text();
  console.error(`${t}: status=${r.status} body=${txt.slice(0, 150)}`);
}

// A3) teacher_students PK (teacher_id, student_id) — teacher_id ile test
console.error("\n=== A3) teacher_students DELETE (teacher_id filter) ===");
{
  const r = await f(`${url}/rest/v1/teacher_students?teacher_id=eq.${NON}`, {
    method: "DELETE",
    headers: { ...H, Range: "0-0", Prefer: "return=minimal" },
  });
  console.error(`teacher_students: status=${r.status} body=${(await r.text()).slice(0, 200)}`);
}

// B) information_schema.role_table_grants uzerinden direct GET
console.error("\n=== B) information_schema.role_table_grants ===");
const r2 = await f(`${url}/rest/v1/role_table_grants?select=grantee,table_name,privilege_type&table_schema=eq.public&grantee=eq.service_role`, { headers: H });
const t2 = await r2.text();
console.error("status:", r2.status, t2.slice(0, 400));

// C) table_privileges
console.error("\n=== C) information_schema.table_privileges ===");
const r3 = await f(`${url}/rest/v1/table_privileges?select=grantee,table_name,privilege_type&table_schema=eq.public&grantee=eq.service_role`, { headers: H });
const t3 = await r3.text();
console.error("status:", r3.status, t3.slice(0, 400));

// D) role_table_grants ile tüm grantee'ler (service_roleの他に authenticated vs)
console.error("\n=== D) role_table_grants (all grantees for our tables) ===");
const r4 = await f(`${url}/rest/v1/role_table_grants?select=grantee,table_name,privilege_type&table_schema=eq.public&table_name=in.(${tabs.join(",")})`, { headers: H });
const t4 = await r4.text();
console.error("status:", r4.status, t4.slice(0, 800));
