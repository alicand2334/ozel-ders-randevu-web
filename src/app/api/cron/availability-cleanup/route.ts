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
// Bearer <CRON_SECRET> header'ı yollar. GECICI TEŞHIS LOGU: her fail
// noktasından once neden fail oldugunu logluyoruz; "No logs found" vermeye
// son vermek için. Silinecek.
function isAuthorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  // Teşhis logu — her durumda header/env bilgisini görelim.
  console.log("AUTH_HEADER =", authHeader);
  console.log("CRON_SECRET_EXISTS =", !!process.env.CRON_SECRET);
  console.log("EXPECTED =", expected ? `Bearer ${expected}` : null);

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
  if (token.length !== expected.length) {
    console.log(
      "AUTH_FAIL reason=4 uzunluk_farkli token_len=" +
        token.length +
        " expected_len=" +
        expected.length,
    );
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    console.log("AUTH_FAIL reason=5 icerik_farkli");
    return false;
  }
  console.log("AUTH_OK");
  return true;
}

// ----------------------------------------------------------------------------
// Teşhis yardımcıları: her aşamada sayı + en fazla 10 örnek kayıt loglar.
// Örneklerde yalnızca id, available_date, status, series_id gösterilir.
// ----------------------------------------------------------------------------
type DiagRow = {
  id: string;
  available_date: string;
  status: string;
  series_id: string;
};

function logStage(label: string, rows: DiagRow[]): void {
  console.log(`${label} count=${rows.length}`);
  const samples = rows.slice(0, 10);
  for (const r of samples) {
    console.log(
      `${label} sample id=${r.id} available_date=${r.available_date} status=${r.status} series_id=${r.series_id}`,
    );
  }
  if (rows.length > 10) {
    console.log(`${label} ... +${rows.length - 10} more`);
  }
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

  try {
    // --- Aşama 1: available_date < today olan TÜM availability kayıtları ---
    //    (status filtresi yok; bu aşamada kaç geçmiş kayıt olduğunu görelim)
    const { data: pastRows, error: pastError } = await admin
      .from("availability")
      .select("id, available_date, status, series_id")
      .lt("available_date", today);

    if (pastError) {
      return NextResponse.json(
        {
          error: "Geçmiş availability sorgulanamadı.",
          detail: pastError.message ?? null,
          today,
        },
        { status: 500 },
      );
    }
    const pastAll = (pastRows ?? []) as DiagRow[];
    logStage("STAGE1_past_all", pastAll);

    // --- Aşama 2: bunlardan status='open' olanlar ---
    const openPast = pastAll.filter((r) => r.status === "open");
    logStage("STAGE2_open_past", openPast);

    // --- Aşama 3: appointments.slot_id ile ilişkisi OLMAYANlar ---
    //    appointments tablosundan kullanılan tüm slot_id'leri topla (cancel
    //    dahil). Hic appointments satırı yoksa usedIds bos kalir ve tüm
    //    adaylar "ilişkisiz" sayilir.
    const { data: usedSlots, error: usedError } = await admin
      .from("appointments")
      .select("slot_id");

    if (usedError) {
      return NextResponse.json(
        {
          error: "Mevcut randevular sorgulanamadı.",
          detail: usedError.message ?? null,
          today,
        },
        { status: 500 },
      );
    }

    const usedIds = new Set(
      ((usedSlots ?? []) as { slot_id: string }[]).map((r) => r.slot_id),
    );
    console.log(
      `STAGE3 used_slot_ids_count=${usedIds.size} (appointments.slot_id kolonu uzerinden)`,
    );

    const unbookedPast = openPast.filter((r) => !usedIds.has(r.id));
    logStage("STAGE3_unbooked_past", unbookedPast);

    // --- Aşama 4: silinecek nihai kayıtlar ---
    //    (unbookedPast ile aynı; ayrı clone idi ama netlik için ayrı logla)
    const toDelete = unbookedPast.slice();
    logStage("STAGE4_to_delete", toDelete);

    const ids = toDelete.map((r) => r.id);

    if (ids.length === 0) {
      // Geçmiş müsaitlik ya yok, ya booked/blocked, ya appointments'a bağlı.
      return NextResponse.json(
        {
          today,
          pastCount: pastAll.length,
          openPastCount: openPast.length,
          unbookedPastCount: unbookedPast.length,
          deleted: 0,
        },
        { status: 200 },
      );
    }

    // --- Aşama 5: Toplu silme. FK on delete restrict kendini korur; race
    //    durumunda delete hata döner (güvenli). ---
    const { error: deleteError, count: deletedCount } = await admin
      .from("availability")
      .delete({ count: "exact" })
      .in("id", ids);

    if (deleteError) {
      console.log(
        `DELETE_ERROR code=${deleteError.code ?? "YOK"} message=${deleteError.message ?? "YOK"}`,
      );
      return NextResponse.json(
        {
          error: "Silme işlemi sırasında hata oluştu.",
          detail: deleteError.message ?? null,
          today,
          pastCount: pastAll.length,
          openPastCount: openPast.length,
          unbookedPastCount: unbookedPast.length,
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
        pastCount: pastAll.length,
        openPastCount: openPast.length,
        unbookedPastCount: unbookedPast.length,
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
        detail: err?.message ?? null,
        today,
      },
      { status: 500 },
    );
  }
}
