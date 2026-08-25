import { NextResponse } from "next/server";
import {
  createServiceClient,
  verifyStudentActor,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/supabase/server-client";
import {
  addDays,
  istanbulDayKeyFromDate,
  istanbulTodayKey,
  istanbulTodayStart,
} from "@/lib/datetime";

// GET /api/teacher/[id]/effective-availability
//
// Öğrencinin belirli bir öğretmen için görebileceği "efektif" müsaitlik
// penceresini döndürür. Yalnızca Europe/Istanbul bugünü dahil önümüzdeki
// 14 takvim günü (bugün + 13 gün) kapsar:
//   - availability sorgusu: status='open' AND teacher_id=<id>
//     AND available_date >= today AND available_date <= today + 13 gün
//   - availability_overrides: action='cancel' AND teacher_id=<id>
//     AND override_date >= today AND override_date <= today + 13 gün
//
// cancel override'ı ile aynı (series_id, override_date) çiftine sahip
// availability satırları sonuçtan çıkarılır. Öğrenci
// availability_overrides tablosunu doğrudan okuyamaz (RLS poliği yalnızca
// teacher_id = auth.uid() izin verir); bu yüzden server-side service-role
// client ile birleştirme burada yapılır.
//
// Not: replace action (saat değiştirme) bu endpoint'te uygulanmaz; yalnızca
// cancel filtrelemesi ele alınır.
//
// Yanıt gövdesi:
//   { slots: Array<{ id, available_date, start_time, end_time, status }> }

export type EffectiveSlot = {
  id: string;
  available_date: string;
  start_time: string;
  end_time: string;
  status: "open" | "booked" | "blocked";
};

type AvailabilityServiceRow = {
  id: string;
  available_date: string;
  start_time: string;
  end_time: string;
  status: string;
  series_id: string | null;
};

type OverrideServiceRow = {
  series_id: string;
  override_date: string;
  action: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: teacherId } = await context.params;

  if (!teacherId) {
    return NextResponse.json(
      { error: "Öğretmen kimliği eksik." },
      { status: 400 },
    );
  }

  // Yalnızca oturum açmış, aktif student rolündeki kullanıcılar erişebilir.
  const actor = await verifyStudentActor(request);
  if (!actor) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return unauthorizedResponse();
    }
    return forbiddenResponse();
  }

  const admin = createServiceClient();

  // 14 günlük pencere: Europe/Istanbul bugünü (00:00) dahil, bugünden 13 gün
  // sonrasının gün sonuna kadar. Her iki kenar da "YYYY-MM-DD" (date kolonlarla
  // uyumlu). Bugün 2026-08-04 ise [2026-08-04, 2026-08-17].
  const todayKey = istanbulTodayKey();
  const endKey = istanbulDayKeyFromDate(
    addDays(istanbulTodayStart(new Date()), 13),
  );

  try {
    // 1) Öğretmenin 14 gün içindeki açık availability satırlarını çek.
    //    service-role kullandığımız için öğrencinin RLS kısıtlamalarından
    //    etkilenmeyiz; öğretmen_id'ye ve tarih aralığına göre doğrudan süzeriz.
    const {
      data: availabilityRows,
      error: availabilityError,
    } = await admin
      .from("availability")
      .select(
        "id, available_date, start_time, end_time, status, series_id",
      )
      .eq("teacher_id", teacherId)
      .eq("status", "open")
      .is("deleted_at", null)
      .gte("available_date", todayKey)
      .lte("available_date", endKey);

    if (availabilityError) {
      const errAny = availabilityError as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      console.error(
        "[GET /api/teacher/[id]/effective-availability] availability sorgu hatası",
      );
      console.error("code:", errAny.code ?? "YOK");
      console.error("message:", errAny.message ?? "YOK");
      console.error("details:", errAny.details ?? "YOK");
      console.error("hint:", errAny.hint ?? "YOK");
      return NextResponse.json(
        { error: "Müsaitlikler getirilemedi." },
        { status: 500 },
      );
    }

    // 2) Aynı penceredeki cancel override'larını çek. replace action'ı
    //    işlenmiyor (yalnızca cancel filtrelenir). override_date yalnızca
    //    14 günlük aralıkta sorgulanır.
    const {
      data: overrideRows,
      error: overrideError,
    } = await admin
      .from("availability_overrides")
      .select("series_id, override_date, action")
      .eq("teacher_id", teacherId)
      .eq("action", "cancel")
      .gte("override_date", todayKey)
      .lte("override_date", endKey);

    if (overrideError) {
      const errAny = overrideError as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      console.error(
        "[GET /api/teacher/[id]/effective-availability] availability_overrides sorgu hatası",
      );
      console.error("code:", errAny.code ?? "YOK");
      console.error("message:", errAny.message ?? "YOK");
      console.error("details:", errAny.details ?? "YOK");
      console.error("hint:", errAny.hint ?? "YOK");
      return NextResponse.json(
        { error: "Müsaitlik geçersiz kılmaları getirilemedi." },
        { status: 500 },
      );
    }

    const availabilityData = (availabilityRows ?? []) as AvailabilityServiceRow[];
    const overrideData = (overrideRows ?? []) as OverrideServiceRow[];

    console.info(
      `[effective-availability] teacherId=${teacherId} pencere=${todayKey}..${endKey} ` +
        `availability=${availabilityData.length} overrides(cancel)=${overrideData.length}`,
    );

    // Tablo henüz yoksa (0019 uygulanmamış) PostgREST boş dizi yerine 42P01
    // koduyla hata döndürür; bu durum yukarıda yakalandı. Boş veri güvenlidir.
    const cancels = new Set<string>();
    for (const row of overrideData) {
      if (row.series_id && row.override_date) {
        cancels.add(`${row.series_id}|${row.override_date}`);
      }
    }

    // 3) Birleştir: (series_id, available_date) cancel set'te yoksa açık.
    //    Ek güvenlik: 14 gün dışı kayıt gelirse (örn. gün sınırı taşması)
    //    yine de sonuç dizisine eklemeyiz.
    const slots: EffectiveSlot[] = [];
    for (const row of availabilityData) {
      if (row.available_date < todayKey || row.available_date > endKey) {
        continue;
      }
      const key = `${row.series_id ?? ""}|${row.available_date}`;
      if (cancels.has(key)) continue;
      slots.push({
        id: row.id,
        available_date: row.available_date,
        start_time: row.start_time,
        end_time: row.end_time,
        status: row.status as EffectiveSlot["status"],
      });
    }

    console.info(
      `[effective-availability] dönen slot sayısı=${slots.length}`,
    );

    return NextResponse.json({ slots });
  } catch (e) {
    console.error(
      "[GET /api/teacher/[id]/effective-availability] beklenmeyen hata",
      e,
    );
    return NextResponse.json(
      { error: "Müsaitlikler getirilemedi." },
      { status: 500 },
    );
  }
}
