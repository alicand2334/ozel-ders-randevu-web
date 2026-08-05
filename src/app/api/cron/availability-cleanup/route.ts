import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server-client";

// Supabase service-role client ve Europe/Istanbul timezone hesabı Node.js
// runtime'ına bağlıdır; edge runtime'da Intl/Full-ICU tutarsız olabilir.
export const runtime = "nodejs";

// ----------------------------------------------------------------------------
// Europe/Istanbul için "bugünün başlangıcı" (YYYY-MM-DD). Cron UTC'de çalışsa
// da silme sorgusunda gerçek İstanbul gününü esas alırız. Böylece 00:00-03:00
// UTC aralığında (yani İstanbul 03:00-06:00) çalıştırılan cron, yine İstanbul
// gün sınırına göre temizlik yapar.
// ----------------------------------------------------------------------------
function istanbulToday(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // "en-CA" → YYYY-MM-DD formatı döner
  return formatter.format(new Date());
}

// Yaklaşık CRON_SECRET doğrulaması. Sabit zamanlı karşılaştirma
// (timing-attack yüzünden) yerine kullanici claim ile karşılaştırma yapıyoruz:
// Burada basit eşitlik kontrolü yeterli — sır Vercel env'inde tutuluyor ve
// yalnızca Vercel Cron sender bu endpoint'e erişiyor.
function isAuthorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return false;
  }
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // CRON_SECRET tanımlı değilse endpoint'i tamamen kilitle.
    return false;
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length !== expected.length) {
    return false;
  }
  // Sabit zamanlı karşılaştırma (crypto.timingSafeEqual yerine sade bir
  // constant-time döngü). Crypto çekmeden, eşit uzunluk garantisi ile.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// GET /api/cron/availability-cleanup
//   Her gün bir kez Vercel Cron tarafından çalıştırılır. Yalnızca:
//     - status = 'open' (müsait) ve
//     - available_date < (Europe/Istanbul bugünü) ve
//     - appointments tablosunda hiçbir randevuya (pending/confirmed/cancelled/
//       completed dahil) bağlı olmayan
//   availability satırlarını siler.
//
//   Güvenlik:
//     - Authorization: Bearer <CRON_SECRET> doğrulaması zorunlu.
//     - Silme, service-role Supabase client üzerinden (RLS bypass) yapılır;
//       istemci tarafından doğrudan tetiklenemez.
//
//   Dokunulmaz (Protected):
//     - appointments satırları HİÇ silinir/bozulmaz (0002'de slot_id FK
//       `on delete restrict` ile; bu yüzden appointments'a bağlı availability
//       satırı silinemez — aşağıdaki `not exists` koşulu + restrict çift
//       güvenlik).
//     - Gelecekteki haftalık seriler korunsun diye: yalnızca
//       available_date < today olan somut satırlar silinir. Seri kendiliğinden
//       yok edilmez; gelecekteki occurrence'lar dokunulmaz.
//     - 'booked' / 'blocked' status'lu satırlar silinmez.
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Yetkisiz. CRON_SECRET geçerli değil." },
      { status: 401 },
    );
  }

  const admin = createServiceClient();

  // Europe/Istanbul için bugünün tarihini hesapla.
  const today = istanbulToday();

  try {
    // 1) Mevcut randevuların slot_id listesini topla (cancel dahil, FK
    //    restrict nedeniyle bunlara sahip availability satırları hiçbir
    //    koşulda silinemez). PostgREST alt-sorgu desteklemediği için bunu
    //    iki adımda yapıyoruz: önce appointments.slot_id kümesi, sonra
    //    availability sorgusunda NOT IN.
    const { data: usedSlots, error: usedError } = await admin
      .from("appointments")
      .select("slot_id");

    if (usedError) {
      return NextResponse.json(
        {
          error: "Mevcut randevular sorgulanamadı.",
          detail: usedError.message ?? null,
        },
        { status: 500 },
      );
    }

    const usedIds = ((usedSlots ?? []) as { slot_id: string }[]).map(
      (r) => r.slot_id,
    );

    // 2) Silinecek aday satırların id'lerini topla.
    //    Koşullar:
    //      a) status = 'open'
    //      b) available_date < today  (bugünden严格的 küçük — dünün ve öncesi)
    //      c) id, kullanılan slot_id'ler arasında değil (cancel/confirmed/
    //         completed hepsi FK restrict ile zaten korunur, ama yine de
    //         sorgu seviyesinde eliyoruz).
    let query = admin
      .from("availability")
      .select("id")
      .eq("status", "open")
      .lt("available_date", today);

    if (usedIds.length > 0) {
      query = query.not("id", "in", `(${usedIds.join(",")})`);
    }

    const { data: candidates, error: selectError } = await query;

    if (selectError) {
      return NextResponse.json(
        {
          error: "Silinecek kayıtlar sorgulanamadı.",
          detail: selectError.message ?? null,
        },
        { status: 500 },
      );
    }

    const ids = ((candidates ?? []) as { id: string }[]).map((r) => r.id);

    if (ids.length === 0) {
      return NextResponse.json(
        { deleted: 0, today, message: "Silinecek geçmiş müsaitlik bulunamadı." },
        { status: 200 },
      );
    }

    // 3) Toplu silme. Eğer arada appointments satırı oluşursa (race) FK
    //    restrict kendini korur; delete hata döner — güvenli rollback yapmamak
    //    için tek tek silmek yerine batch delete + hata kontrolü.
    const { error: deleteError, count: deletedCount } = await admin
      .from("availability")
      .delete({ count: "exact" })
      .in("id", ids);

    if (deleteError) {
      return NextResponse.json(
        {
          error: "Silme işlemi sırasında hata oluştu.",
          detail: deleteError.message ?? null,
          today,
          candidate_count: ids.length,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        deleted: deletedCount ?? 0,
        today,
      },
      { status: 200 },
    );
  } catch (e) {
    const err = e as { message?: string } | null;
    return NextResponse.json(
      {
        error: "Beklenmeyen hata.",
        detail: err?.message ?? null,
        today,
      },
      { status: 500 },
    );
  }
}
