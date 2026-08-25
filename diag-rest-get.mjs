// Salt-okunur: doğrudan undici ile tabloları GET.
import { fetch as f } from "undici";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const t of ["notifications","appointments","availability","availability_overrides","teacher_students","profiles"]) {
  const r = await f(`${url}/rest/v1/${t}?select=id&limit=2`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const txt = await r.text();
  console.error(t, "->", r.status, txt.slice(0, 200));
}

// Notification tablosunda restrict RLS var mi? Rest openapi'tan tablo tanımı
const oapi = await (await f(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
})).json();
const npath = oapi.paths?.["/notifications"];
console.error("\nnotifications path meta:", JSON.stringify(npath, null, 2).slice(0, 600));
