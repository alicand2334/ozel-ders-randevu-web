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

// CRON_SECRET doğrulaması. Vercel Cron bu endpoint'e Authorization:
// Bearer <CRON_SECRET> header'ı yollar. Sabit zamanlı karşılaştırma
// (timing-attack'e dayanıklı); eşit olmayan uzunluklar için dahi döngü
// çalışır, böylece süre sızıntısı olmaz.
function isAuthorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!authHeader) {
    console.log("AUTH_FAIL reason=1 header_yok");
    return false;
  }
  if (!expected) {
    console.log("AUTH_FAIL reason=2 cron_secret_env_yok");
    return false;
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    console.log("AUTH_FAIL reason=3 token_bos");
    return false;
  }
  // Eşit uzunluk garantile: kısa token'ı padding yerine diff bayrağını
  // kullanarak uzunluk farkını da sessizce işaretle.
  const maxLen = Math.max(token.length, expected.length);
  let diff = token.length ^ expected.length;
  for (let i = 0; i < maxLen; i++) {
    const tc = i < token.length ? token.charCodeAt(i) : 0;
    const ec = i < expected.length ? expected.charCodeAt(i) : 0;
    diff |= tc ^ ec;
  }
  if (diff !== 0) {
    console.log("AUTH_FAIL reason=4 token_mismatch");
    return false;
  }
  console.log("AUTH_OK");
  return true;
}

// GET /api/cron/availability-cleanup
//   Her gün bir kez Vercel Cron tarafından çalıştırılır. Yalnızca:
//     - status = 'open' (müsait) ve
//     - available_date < (Europe/Istanbul bugünü) ve
//     - appointments tablosunda hiçbir randevuya (pending/confirmed/cancelled/
//       completed dahil) bağlı olmayan
//   availability satırlarını siler.
//
//   appointments ilişkisi: appointments.slot_id kolonu üzerinden kontrol
//   edilir. appointments satırının durumu (pending/confirmed/cancelled/
//   completed) fark etmez — herhangi bir randevu kaydı slot'a bağlıysa o
//   availability satırı korunur (FK on delete restrict zaten silinemez,
//   biz sorgu seviyesinde de eliyoruz).
//
//   Dokunulmaz (Protected):
//     - appointments satırları HİÇ silinmez/güncellenmez (0002: slot_id FK
//       `on delete restrict`; appointments'a bağlı availability satırı
//       silinemez).
//     - Gelecekteki haftalık seriler korunsun diye: yalnızca
//       available_date < today olan somut satırlar silinir. Seri tanımı
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
  console.log(`TODAY_ISTANBUL=${today}`);

  // Özet sayaçlar (teşhis amaçlı güvenli loglar — hassas veri içermez).
  let pastCount = 0;
  let openPastCount = 0;
  let unbookedPastCount = 0;

  try {
    // 1) Mevcut randevuların slot_id listesini topla (cancel dahil, FK
    //    restrict nedeniyle bunlara sahip availability satırları hiçbir
    //    koşulda silinemez). PostgREST alt-sorgu desteklemediği için bunu
    //    iki adımda yapıyoruz: önce appointments.slot_id kümesi, sonra
    //    availability filtrelemesi.
    const { data: usedSlots, error: usedError } = await admin
      .from("appointments")
      .select("slot_id");

    if (usedError) {
      console.log(
        `USED_SLOTS_ERROR code=${usedError.code ?? "YOK"} message=${usedError.message ?? "YOK"}`,
      );
      return NextResponse.json(
        {
          error: "Mevcut randevular sorgulanamadı.",
          today,
        },
        { status: 500 },
      );
    }

    const usedIds = new Set(
      ((usedSlots ?? []) as { slot_id: string }[]).map((r) => r.slot_id),
    );

    // 2) Silinecek aday satırların id'lerini topla. Koşullar:
    //      a) status = 'open'
    //      b) available_date < today  (bugünden strict küçük)
    //      c) id, kullanılan slot_id'ler arasında değil
    //    (c) koşulu JS tarafında Set.has ile uygulanır.
    const { data: pastRows, error: pastError } = await admin
      .from("availability")
      .select("id, status")
      .lt("available_date", today);

    if (pastError) {
      console.log(
        `PAST_QUERY_ERROR code=${pastError.code ?? "YOK"} message=${pastError.message ?? "YOK"}`,
      );
      return NextResponse.json(
        {
          error: "Geçmiş availability sorgulanamadı.",
          today,
        },
        { status: 500 },
      );
    }

    const pastAll = (pastRows ?? []) as { id: string; status: string }[];
    pastCount = pastAll.length;
    const openPast = pastAll.filter((r) => r.status === "open");
    openPastCount = openPast.length;
    const unbookedPast = openPast.filter((r) => !usedIds.has(r.id));
    unbookedPastCount = unbookedPast.length;
    const ids = unbookedPast.map((r) => r.id);

    console.log(
      `SUMMARY past=${pastCount} open_past=${openPastCount} used_slots=${usedIds.size} unbooked_past=${unbookedPastCount} to_delete=${ids.length}`,
    );

    if (ids.length === 0) {
      // Geçmiş müsaitlik ya yok, ya booked/blocked, ya appointments'a bağlı.
      return NextResponse.json(
        {
          today,
          pastCount,
          openPastCount,
          unbookedPastCount,
          deleted: 0,
        },
        { status: 200 },
      );
    }

    // 3) Toplu silme. Eğer arada appointments satırı oluşursa (race) FK
    //    restrict kendini korur; delete hata döner (güvenli). count: exact
    //    ile gerçek silinen satır sayısı döner.
    const { error: deleteError, count: deletedCount } = await admin
      .from("availability")
      .delete({ count: "exact" })
      .in("id", ids);

    if (deleteError) {
      console.log(
        `DELETE_ERROR code=${deleteError.code ?? "YOK"} message=${deleteError.message ?? "YOK"} attempted=${ids.length}`,
      );
      return NextResponse.json(
        {
          error: "Silme işlemi sırasında hata oluştu.",
          today,
          pastCount,
          openPastCount,
          unbookedPastCount,
          candidate_count: ids.length,
        },
        { status: 500 },
      );
    }

    console.log(
      `DELETE_OK deleted=${deletedCount ?? 0} attempted=${ids.length}`,
    );

    return NextResponse.json(
      {
        today,
        pastCount,
        openPastCount,
        unbookedPastCount,
        deleted: deletedCount ?? 0,
      },
      { status: 200 },
    );
  } catch (e) {
    const err = e as { message?: string } | null;
    console.log(`EXCEPTION message=${err?.message ?? "YOK"}`);
    return NextResponse.json(
      {
        error: "Beklenmeyen hata.",
        today,
        pastCount,
        openPastCount,
        unbookedPastCount,
      },
      { status: 500 },
    );
  }
}
