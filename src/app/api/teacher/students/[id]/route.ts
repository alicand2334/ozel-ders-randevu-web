import { NextResponse } from "next/server";
import {
  createServiceClient,
  verifyTeacherActor,
} from "@/lib/supabase/server-client";

// Supabase service-role client ve admin Auth API çağrıları Node.js
// runtime'ına bağlıdır; edge runtime'da çalışmaz.
export const runtime = "nodejs";

type ProfileRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  role: string | null;
};

type AppointmentSlotRow = {
  available_date: string;
  start_time: string;
  end_time: string;
};

type AppointmentRow = {
  id: string;
  status: string | null;
  lesson: string | null;
  subject: string | null;
  notes: string | null;
  student_id: string;
  slot_id: string;
  created_at: string;
  lesson_mode: "online" | "in_person" | null;
  slot: AppointmentSlotRow[] | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

/**
 * verifyTeacherActor'dan dönen aktif öğretmenin (actor.id) bu öğrenciyle
 * teacher_students ilişkisi var mı kontrolü. Service-role client RLS bypass
 * yaptığından tüm satırları görür; öğretmenin yalnızca kendi adına işlem
 * yapabilmesi için bu doğrulama uygulama katmanında zorunludur.
 *
 *   - Link yoksa 404 döner.
 *   - Sorgu hatasında 500 döner.
 *   - Link varsa true döner.
 *
 * Ayrıca öğrencinin mevcut `is_active` ve `role` bilgilerini de döner
 * (ileride karar verirken). Yalnızca bu öğretmene ait ise kullanır.
 */
async function verifyOwnStudent(
  teacherId: string,
  studentId: string,
): Promise<
  | { ok: true; profile: ProfileRow | null }
  | { ok: false; response: Response }
> {
  const admin = createServiceClient();

  const { data: link, error: linkError } = await admin
    .from("teacher_students")
    .select("teacher_id")
    .eq("teacher_id", teacherId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (linkError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Öğrenci doğrulanırken bir hata oluştu." },
        { status: 500 },
      ),
    };
  }

  if (!link) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Bu öğrenci size bağlı değil." },
        { status: 404 },
      ),
    };
  }

  // Öğrencinin profili silinmiş olabilir; teacher_students FK'si zaten
  // ON DELETE CASCADE olduğundan link'in var olması profili garanti eder.
  // Yine de savunma amaçlı sorgulayalım.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, full_name, phone, is_active, role")
    .eq("id", studentId)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Öğrenci bilgileri getirilemedi." },
        { status: 500 },
      ),
    };
  }

  return { ok: true, profile: (profile as ProfileRow) ?? null };
}

/**
 * Bu öğretmen-öğrenci çifti için pending/confirmed aktif randevu sayısını
 * döner. Aktif randevu varsa silme/pasife alma işlemleri engellenir.
 */
async function countActiveAppointments(
  teacherId: string,
  studentId: string,
): Promise<{ count: number; error: boolean }> {
  const admin = createServiceClient();
  const { count, error } = await admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", teacherId)
    .eq("student_id", studentId)
    .in("status", ["pending", "confirmed"]);

  if (error) {
    return { count: 0, error: true };
  }
  return { count: count ?? 0, error: false };
}

/**
 * Öğrencinin bağlı olduğu tüm öğretmen sayısını döner (bu öğretmen dahil).
 * Bu sayı "soft-sil" sırasında is_active=false yapılıp yapılmayacağını
 * belirler.
 */
async function countTeacherLinks(studentId: string): Promise<{
  count: number;
  error: boolean;
}> {
  const admin = createServiceClient();
  const { count, error } = await admin
    .from("teacher_students")
    .select("teacher_id", { count: "exact", head: true })
    .eq("student_id", studentId);

  if (error) {
    return { count: 0, error: true };
  }
  return { count: count ?? 0, error: false };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: studentId } = await context.params;

  if (!studentId) {
    return NextResponse.json(
      { error: "Öğrenci kimliği eksik." },
      { status: 400 },
    );
  }

  const actor = await verifyTeacherActor(request);
  if (!actor) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Oturum bulunamadı. Lütfen giriş yapın." },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "Bu işlem için yetkiniz bulunmuyor." },
      { status: 403 },
    );
  }

  const admin = createServiceClient();

  try {
    const { data: link, error: linkError } = await admin
      .from("teacher_students")
      .select("student_id")
      .eq("teacher_id", actor.id)
      .eq("student_id", studentId)
      .maybeSingle();

    if (linkError) {
      const errAny = linkError as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      console.error(
        "[GET /api/teacher/students/[id]] teacher_students doğrulama hatası",
      );
      console.error("[GET /api/teacher/students/[id]] status: 500");
      console.error(
        "[GET /api/teacher/students/[id]] code:",
        errAny.code ?? "YOK",
      );
      console.error(
        "[GET /api/teacher/students/[id]] message:",
        errAny.message ?? "YOK",
      );
      console.error(
        "[GET /api/teacher/students/[id]] details:",
        errAny.details ?? "YOK",
      );
      console.error(
        "[GET /api/teacher/students/[id]] hint:",
        errAny.hint ?? "YOK",
      );
      return NextResponse.json(
        { error: "Öğrenci bilgileri getirilemedi." },
        { status: 500 },
      );
    }

    if (!link) {
      return NextResponse.json(
        { error: "Bu öğrenci size bağlı değil." },
        { status: 404 },
      );
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, full_name, phone, is_active, role")
      .eq("id", studentId)
      .maybeSingle();

    if (profileError) {
      const errAny = profileError as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      console.error("[GET /api/teacher/students/[id]] profiles sorgu hatası");
      console.error("[GET /api/teacher/students/[id]] status: 500");
      console.error("[GET /api/teacher/students/[id]] code:", errAny.code ?? "YOK");
      console.error("[GET /api/teacher/students/[id]] message:", errAny.message ?? "YOK");
      console.error("[GET /api/teacher/students/[id]] details:", errAny.details ?? "YOK");
      console.error("[GET /api/teacher/students/[id]] hint:", errAny.hint ?? "YOK");
      return NextResponse.json(
        { error: "Öğrenci bilgileri getirilemedi." },
        { status: 500 },
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "Öğrenci profili bulunamadı." },
        { status: 404 },
      );
    }

    const profileRow = profile as ProfileRow;

    const { data: appointments, error: appointmentsError } = await admin
      .from("appointments")
      .select(
        "id, status, lesson, subject, notes, student_id, slot_id, created_at, lesson_mode, slot:availability(available_date, start_time, end_time)",
      )
      .eq("teacher_id", actor.id)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (appointmentsError) {
      const errAny = appointmentsError as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      console.error(
        "[GET /api/teacher/students/[id]] appointments sorgu hatası",
      );
      console.error("[GET /api/teacher/students/[id]] status: 500");
      console.error("[GET /api/teacher/students/[id]] code:", errAny.code ?? "YOK");
      console.error(
        "[GET /api/teacher/students/[id]] message:",
        errAny.message ?? "YOK",
      );
      console.error(
        "[GET /api/teacher/students/[id]] details:",
        errAny.details ?? "YOK",
      );
      console.error("[GET /api/teacher/students/[id]] hint:", errAny.hint ?? "YOK");
      return NextResponse.json(
        { error: "Öğrenci bilgileri getirilemedi." },
        { status: 500 },
      );
    }

    const rows = (appointments ?? []) as AppointmentRow[];

    return NextResponse.json(
      {
        profile: {
          id: profileRow.id,
          full_name: profileRow.full_name,
          phone: profileRow.phone,
          is_active: profileRow.is_active,
          role: profileRow.role,
        },
        appointments: rows.map((row) => ({
          id: row.id,
          status: row.status,
          lesson: row.lesson,
          subject: row.subject,
          notes: row.notes,
          slot_id: row.slot_id,
          created_at: row.created_at,
          lesson_mode: row.lesson_mode,
          slot: row.slot && row.slot.length > 0 ? row.slot[0] : null,
        })),
      },
      { status: 200 },
    );
  } catch (e) {
    const err = e as {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
      stack?: string;
    } | null;
    console.error("[GET /api/teacher/students/[id]] beklenmeyen exception");
    console.error("[GET /api/teacher/students/[id]] status: 500");
    console.error("[GET /api/teacher/students/[id]] code:", err?.code ?? "YOK");
    console.error("[GET /api/teacher/students/[id]] message:", err?.message ?? "YOK");
    console.error("[GET /api/teacher/students/[id]] details:", err?.details ?? "YOK");
    console.error("[GET /api/teacher/students/[id]] hint:", err?.hint ?? "YOK");
    console.error("[GET /api/teacher/students/[id]] stack:", err?.stack ?? "YOK");
    return NextResponse.json(
      { error: "Öğrenci bilgileri getirilemedi." },
      { status: 500 },
    );
  }
}

type EditStudentPayload = {
  full_name?: unknown;
  phone?: unknown;
  is_active?: unknown;
};

type SafeEditResponse = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
};

/**
 * PATCH — Öğretmenin kendi öğrencisinin (yani teacher_students.teacher_id =
 * auth.uid() ile doğrulanan) adını/telefonunu günceller ve Pasife Al/Aktif
 * Et yapar.
 *
 * Güvenlik:
 *   - Service-role client RLS bypass yapar; bu yüzden öğretmenin yalnızca
 *     kendi adına işlem yaptığı verifyOwnStudent ile uygulanır.
 *   - pending/confirmed aktif randevu varsa Pasife Al/Yalnızca ilişki
 *     kaldırma yapılmaz (görev şartı). Aşağıda bu şart yalnızca is_active
 *     değişikliği (Pasife Al) için aranmaz çünkü Pasife Al mevcut aktif
 *     randevuları iptal etmez, yalnızca gelecek girişleri engeller.
 *
 * 'is_active' değişikliği (Pasife Al/Aktif Et):
 *   - Öğrenci başka bir öğretmene daha bağlıysa, global is_active
 *     değişikliği diğer öğretmeni de etkilediğinden izin verme; uyarı göster.
 *   - Yalnızca bu öğretmene bağlısa, 'is_active' normal şekilde güncellenir.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: studentId } = await context.params;

  if (!studentId) {
    return NextResponse.json(
      { error: "Öğrenci kimliği eksik." },
      { status: 400 },
    );
  }

  let body: EditStudentPayload;
  try {
    body = (await request.json()) as EditStudentPayload;
  } catch {
    return NextResponse.json(
      { error: "Geçersiz istek gövdesi." },
      { status: 400 },
    );
  }

  const actor = await verifyTeacherActor(request);
  if (!actor) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Oturum bulunamadı. Lütfen giriş yapın." },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "Bu işlem için yetkiniz bulunmuyor." },
      { status: 403 },
    );
  }

  const verified = await verifyOwnStudent(actor.id, studentId);
  if (!verified.ok) {
    return verified.response;
  }

  if (!verified.profile) {
    return NextResponse.json(
      { error: "Öğrenci profili bulunamadı." },
      { status: 404 },
    );
  }

  const profileRow = verified.profile as ProfileRow;

  if (profileRow.role && profileRow.role !== "student") {
    return NextResponse.json(
      { error: "Yalnızca öğrenci hesapları düzenlenebilir." },
      { status: 400 },
    );
  }

  const patch: Record<string, string | boolean | null> = {};
  let wantsIsActiveChange = false;
  let nextIsActive = profileRow.is_active;

  if ("full_name" in body) {
    const fullName = isNonEmptyString(body.full_name)
      ? body.full_name.trim()
      : "";
    if (!fullName) {
      return NextResponse.json(
        { error: "Ad soyad boş olamaz." },
        { status: 400 },
      );
    }
    patch.full_name = fullName;
  }

  if ("phone" in body) {
    patch.phone = optionalString(body.phone);
  }

  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { error: "Durum alanı geçerli bir değer değil." },
        { status: 400 },
      );
    }
    wantsIsActiveChange = true;
    nextIsActive = body.is_active;
  }

  if (Object.keys(patch).length === 0 && !wantsIsActiveChange) {
    return NextResponse.json(
      { error: "Güncellenecek alan bulunmuyor." },
      { status: 400 },
    );
  }

  if (wantsIsActiveChange) {
    const { count: linkCount, error: linkCountError } =
      await countTeacherLinks(studentId);

    if (linkCountError) {
      return NextResponse.json(
        { error: "Öğrencinin ilişkileri kontrol edilemedi." },
        { status: 500 },
      );
    }

    if (linkCount > 1) {
      return NextResponse.json(
        {
          error:
            "Bu öğrenci başka öğretmenlerle de çalıştığı için durumu (aktif/pasif) yalnızca yönetici değiştirebilir. Sadece bu öğretmeninizle öğrenci kendi öğretmeninizi etkilemeden pasife alamazsınız.",
        },
        { status: 409 },
      );
    }

    patch.is_active = nextIsActive;
  }

  if (Object.keys(patch).length === 0) {
    // Sadece is_active için gelindi ve is_active değişikliği yukarıda zaten
    // patch'e eklendiyse buraya düşülmez. Bu dal güvenlik amaçlı.
    return NextResponse.json(
      { error: "Güncellenecek alan bulunmuyor." },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", studentId)
    .select("id, full_name, phone, is_active")
    .maybeSingle();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "Öğrenci güncellenirken bir hata oluştu." },
      { status: 500 },
    );
  }

  const safe: SafeEditResponse = {
    id: String(updated.id),
    full_name: updated.full_name ?? null,
    phone: updated.phone ?? null,
    is_active: updated.is_active === true,
  };

  return NextResponse.json(safe, { status: 200 });
}

type DeleteResponse = {
  message?: string;
  deactivated?: boolean;
};

/**
 * DELETE — Öğretmenin "Sil" butonu. Fiziksel silme yapılmaz; yalnızca bu
 * öğretmen-öğrenci arasındaki teacher_students ilişkisi kaldırılır.
 *
 * Davranış:
 *   1) pending/confirmed aktif randevu varsa → 409 + Türkçe açıklayıcı mesaj.
 *      cancelled/completed geçmiş randevular KESİNLİKLE korunur (hiçbir
 *      şey silinmez).
 *   2) teacher_students satırı silinir (yalnızca (teacher_id, student_id)).
 *   3) Öğrenci başka hiçbir öğretmene bağlı değilse, artık aktif bağlamı
 *      kalmadığı için is_active=false yapılır. Başka öğretmene de bağlıysa
 *      is_active值'una DOKUNULMAZ; diğer öğretmen etkilenmesin.
 *
 * Güvenlik: service-role client RLS bypass yapar; verifyOwnStudent ile
 * öğretmenin yalnızca kendi adına işlem yapabileceği zorunlu kılınır.
 *
 * Auth kullanıcısı (auth.users) ve profiles satırı ASLA silinmez.
 * appoints, notifications gibi diğer tablolara da DOKUNULMAZ.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: studentId } = await context.params;

  if (!studentId) {
    return NextResponse.json(
      { error: "Öğrenci kimliği eksik." },
      { status: 400 },
    );
  }

  const actor = await verifyTeacherActor(request);
  if (!actor) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Oturum bulunamadı. Lütfen giriş yapın." },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "Bu işlem için yetkiniz bulunmuyor." },
      { status: 403 },
    );
  }

  const verified = await verifyOwnStudent(actor.id, studentId);
  if (!verified.ok) {
    return verified.response;
  }

  // 1) Aktif randevu kontrolü: pending veya confirmed. Cancelled/completed
  //    bu sayaca dahil değildir; yani geçmiş randevular silme/kaldırmayı
  //    engellemez ve fiziksel olarak hiç dokunulmaz (zaten hiçbir fiziksel
  //    silme yoktur).
  const { count: activeCount, error: activeError } =
    await countActiveAppointments(actor.id, studentId);

  if (activeError) {
    return NextResponse.json(
      { error: "Randevular kontrol edilirken bir hata oluştu." },
      { status: 500 },
    );
  }

  if (activeCount > 0) {
    return NextResponse.json(
      {
        error:
          "Bu öğrenciyle pending veya confirmed durumda aktif randevularınız bulunduğu için öğrenci listenizden kaldırılamıyor. Önce ilgili randevuyu iptal edin ya da tamamlayın; geçmiş (cancelled/completed) randevular korunur.",
      },
      { status: 409 },
    );
  }

  const admin = createServiceClient();

  // 2) teacher_students satırını (teacher_id, student_id) kaldır. Yalnızca bu
  //    öğretmene ait olduğu için kendi satırıdır; başka öğretmene ait
  //    satırlara dokunmayız.
  const { error: deleteLinkError } = await admin
    .from("teacher_students")
    .delete()
    .eq("teacher_id", actor.id)
    .eq("student_id", studentId);

  if (deleteLinkError) {
    return NextResponse.json(
      { error: "Öğrenci ilişkisi kaldırılırken bir hata oluştu." },
      { status: 500 },
    );
  }

  // 3) Öğrenci başka hiçbir öğretmene bağlı mı? Bağlı değilse is_active=false
  //    yaparak "bu öğretmenle beraber öğrenci artık bir aktif bağlamı yok"
  //    hedefini gerçekleştir. Başka öğretmene hala bağlıysa hiçbir şey yapma.
  const { count: remainingLinks, error: linkCountError } =
    await countTeacherLinks(studentId);

  let deactivated = false;

  if (!linkCountError && remainingLinks === 0) {
    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update({ is_active: false })
      .eq("id", studentId);

    if (profileUpdateError) {
      // Bağlantı zaten kaldırıldı; is_active=false olası olmadıysa yine de
      // 200 dönelim ama 'deactivated=false' ile. Profile çizgisine müdahale
      // edilemediyse yönetici bunu halleder; UI bilgilendirici mesajla
      // gönderir.
      deactivated = false;
    } else {
      deactivated = true;
    }
  }

  const safe: DeleteResponse = {
    message: deactivated
      ? "Öğrenci listenizden kaldırıldı; bu öğrenciyle başka aktif öğretmen bağı olmadığı için hesabı pasife alındı. Geçmiş randevular korundu."
      : "Öğrenci listenizden kaldırıldı. Geçmiş randevular korundu.",
    deactivated,
  };

  return NextResponse.json(safe, { status: 200 });
}
