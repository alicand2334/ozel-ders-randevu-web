import { NextResponse } from "next/server";
import {
  createServiceClient,
  verifyAdminActor,
} from "@/lib/supabase/server-client";

type EditTeacherPayload = {
  full_name?: unknown;
  phone?: unknown;
  specialization?: unknown;
  bio?: unknown;
  is_active?: unknown;
};

type SafeEditResponse = {
  id: string;
  full_name: string | null;
  phone: string | null;
  specialization: string | null;
  bio: string | null;
  is_active: boolean;
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

export async function PATCH(
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

  let body: EditTeacherPayload;
  try {
    body = (await request.json()) as EditTeacherPayload;
  } catch {
    return NextResponse.json(
      { error: "Geçersiz istek gövdesi." },
      { status: 400 },
    );
  }

  const actor = await verifyAdminActor(request);
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

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", teacherId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: "Öğretmen bilgileri alınamadı." },
      { status: 500 },
    );
  }

  if (!profile) {
    return NextResponse.json(
      { error: "Öğretmen bulunamadı." },
      { status: 404 },
    );
  }

  if (profile.role !== "teacher") {
    return NextResponse.json(
      { error: "Yalnızca öğretmen hesapları düzenlenebilir." },
      { status: 400 },
    );
  }

  const patch: Record<string, string | boolean | null> = {};

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

  if ("specialization" in body) {
    const specialization = isNonEmptyString(body.specialization)
      ? body.specialization.trim()
      : "";
    if (!specialization) {
      return NextResponse.json(
        { error: "Branş alanı boş olamaz." },
        { status: 400 },
      );
    }
    patch.specialization = specialization;
  }

  if ("bio" in body) {
    patch.bio = optionalString(body.bio);
  }

  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { error: "Durum alanı geçerli bir değer değil." },
        { status: 400 },
      );
    }
    patch.is_active = body.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Güncellenecek alan bulunmuyor." },
      { status: 400 },
    );
  }

  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", teacherId)
    .select("id, full_name, phone, specialization, bio, is_active")
    .maybeSingle();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "Öğretmen güncellenirken bir hata oluştu." },
      { status: 500 },
    );
  }

  const safe: SafeEditResponse = {
    id: String(updated.id),
    full_name: updated.full_name ?? null,
    phone: updated.phone ?? null,
    specialization: updated.specialization ?? null,
    bio: updated.bio ?? null,
    is_active: updated.is_active === true,
  };

  return NextResponse.json(safe, { status: 200 });
}

type DeleteResponse = {
  message?: string;
  actorEmail?: string | null;
};

type ActiveAppointmentRow = { id: string };

export async function DELETE(
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

  const actor = await verifyAdminActor(request);
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

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role, full_name")
    .eq("id", teacherId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: "Öğretmen bilgileri alınamadı." },
      { status: 500 },
    );
  }

  if (!profile) {
    return NextResponse.json(
      { error: "Öğretmen bulunamadı." },
      { status: 404 },
    );
  }

  if (profile.role === "admin") {
    return NextResponse.json(
      { error: "Yönetici hesapları bu yolla silinemez." },
      { status: 400 },
    );
  }

  if (profile.role !== "teacher") {
    return NextResponse.json(
      { error: "Yalnızca öğretmen hesapları silinebilir." },
      { status: 400 },
    );
  }

  if (actor.id === teacherId) {
    return NextResponse.json(
      { error: "Kendi hesabınızı bu yolla silemezsiniz." },
      { status: 400 },
    );
  }

  // Aktif randevu kontrolü: pending veya confirmed statuslu
  //randezbulardan herhangi biri varsa silme reddedilir (409). Bu güvenlik
  // kontrolü korunur; yalnızca completed/cancelled randevular aşağıdaki
  // temizlik adımında silinir.
  const { data: activeAppts, error: apptError } = await admin
    .from("appointments")
    .select("id")
    .eq("teacher_id", teacherId)
    .in("status", ["pending", "confirmed"])
    .limit(1);

  if (apptError) {
    return NextResponse.json(
      { error: "Randevular kontrol edilirken bir hata oluştu." },
      { status: 500 },
    );
  }

  if (activeAppts && (activeAppts as ActiveAppointmentRow[]).length > 0) {
    return NextResponse.json(
      {
        error:
          "Bu öğretmenin aktif randevuları bulunduğu için kalıcı silme yapılamıyor. Önce randevuları iptal edin veya öğretmeni pasife alın.",
      },
      { status: 409 },
    );
  }

  // =========================================================================
  // Kalıcı silme akışı — FK bağımlılıklarına göre güvenli sıra.
  //
  // Şema özet (ilgili FK'ler):
  //   appointments.slot_id        -> availability(id)   ON DELETE RESTRICT  (kök neden)
  //   appointments.student_id     -> profiles(id)      ON DELETE CASCADE
  //   appointments.teacher_id      -> profiles(id)      ON DELETE CASCADE
  //   notifications.appointment_id -> appointments(id)  ON DELETE CASCADE
  //   notifications.recipient_id   -> profiles(id)      ON DELETE CASCADE
  //   notifications.actor_id       -> profiles(id)      ON DELETE SET NULL
  //   availability.teacher_id      -> profiles(id)      ON DELETE CASCADE
  //   availability_overrides.teacher_id -> profiles(id) ON DELETE CASCADE
  //   teacher_students.teacher_id  -> profiles(id)      ON DELETE CASCADE
  //   teacher_students.student_id  -> profiles(id)      ON DELETE CASCADE
  //   teacher_students.assigned_by -> profiles(id)      ON DELETE SET NULL
  //
  // Kritik kısıt: appointments.slot_id -> availability.id FK'si
  // RESTRICT olduğu için, availability satırını silmeden önce o slot'a
  // bağlı tüm appointments satırlarının silinmesi zorunludur. Aksi halde
  // profiles CASCADE zinciri availability'ye ulaşınca RESTRICT tetiklenir
  // ve auth.admin.deleteUser "Database error deleting user" (GoTrue 500)
  // hatası verir.
  //
  // notifications.appointment_id → appointments(id) CASCADE olduğu için
  // randevular silinince bildirimler de otomatik düşer; ancak service_role
  // için notifications üzerinde DELETE yetkisi (0024) verildiği için ve
  // SET NULL ilişkisinin (actor_id) bırakılmasını istemediğimiz için
  // bildirimleri de manuel olarak temizleriz (recipient_id ve actor_id
  // üzerinden).
  //
  // Sıra (çocuk → ebeveyn):
  //   1) notifications      (recipient_id = teacherId OR actor_id = teacherId)
  //   2) appointments        (teacher_id = teacherId OR student_id = teacherId)
  //   3) availability_overrides (teacher_id = teacherId)
  //   4) availability        (teacher_id = teacherId)  — appointments silindikten sonra güvenli
  //   5) teacher_students    (teacher_id = teacherId OR student_id = teacherId OR assigned_by = teacherId)
  //   6) profiles            (id = teacherId)
  //   7) auth.admin.deleteUser(teacherId)
  //
  // Hata sonrası kısmi temizlik riski: her adımın hatası ayrı ayrı loglanır
  // ve işlem 500 ile durur. Tam geri alma (transaction) Supabase JS client
  // ile mümkün değildir; bu yüzden adımlar idempotenttir ve kullanıcı
  // işlemi yeniden deneyebilir (kayıt zaten silinmişse adım no-op olur).
  // =========================================================================

  // --- 1) notifications: Öğretmene ait alıcı veya fail rollerindeki bildirimler.
  //   Burada doğrudan user_id'yi temizlemek, ON DELETE SET NULL (actor_id)
  //   ile çakışmaz; onun yerine kayıtları tamamen kaldırır.
  const notifRec = await admin
    .from("notifications")
    .delete()
    .eq("recipient_id", teacherId);
  if (notifRec.error) {
    console.error("[DELETE teacher] step1 notifications(recipient) FAILED", {
      teacherId,
      code: notifRec.error.code,
      message: notifRec.error.message,
    });
    return NextResponse.json(
      { error: "Öğretmene ait bildirimler silinirken bir hata oluştu." },
      { status: 500 },
    );
  }
  const notifAct = await admin
    .from("notifications")
    .delete()
    .eq("actor_id", teacherId);
  if (notifAct.error) {
    console.error("[DELETE teacher] step1b notifications(actor) FAILED", {
      teacherId,
      code: notifAct.error.code,
      message: notifAct.error.message,
    });
    return NextResponse.json(
      { error: "Öğretmene ait bildirimler silinirken bir hata oluştu." },
      { status: 500 },
    );
  }

  // --- 2) appointments: Öğretmenin teacher_id olduğu tüm randevular
  //   (completed/cancelled dahil; pending/confirmed yukarıda 409 ile
  //   engellendi). Bu adım olmadan availability silinemez (RESTRICT).
  const apptDel = await admin
    .from("appointments")
    .delete()
    .eq("teacher_id", teacherId);
  if (apptDel.error) {
    const e = apptDel.error as unknown as {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
    };
    console.error("[DELETE teacher] step2 appointments(teacher) FAILED", {
      teacherId,
      code: e.code,
      message: e.message,
      details: e.details,
      hint: e.hint,
      rawKeys: Object.keys(apptDel.error as object),
      fullError: JSON.stringify(apptDel.error, null, 2),
    });
    return NextResponse.json(
      { error: "Öğretmen randevuları silinirken bir hata oluştu." },
      { status: 500 },
    );
  }
  // Bu öğretmen student_id olarak görünüyorsa (teorik değil ama idempotent
  // güvenli tarafta kalalım) o randevular da silinsin.
  const apptStu = await admin
    .from("appointments")
    .delete()
    .eq("student_id", teacherId);
  if (apptStu.error) {
    const e = apptStu.error as unknown as {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
    };
    console.error("[DELETE teacher] step2b appointments(student) FAILED", {
      teacherId,
      code: e.code,
      message: e.message,
      details: e.details,
      hint: e.hint,
      rawKeys: Object.keys(apptStu.error as object),
      fullError: JSON.stringify(apptStu.error, null, 2),
    });
    return NextResponse.json(
      { error: "Öğretmen randevuları silinirken bir hata oluştu." },
      { status: 500 },
    );
  }

  // --- 3) availability_overrides: Öğretmenin hareketli müsaitlik iptaller.
  //   profiles → availability_overrides CASCADE olsa da manuel sıralama
  //   güvenliği korur.
  const aoDel = await admin
    .from("availability_overrides")
    .delete()
    .eq("teacher_id", teacherId);
  if (aoDel.error) {
    console.error("[DELETE teacher] step3 availability_overrides FAILED", {
      teacherId,
      code: aoDel.error.code,
      message: aoDel.error.message,
    });
    return NextResponse.json(
      { error: "Öğretmen müsaitlik istisnaları silinirken bir hata oluştu." },
      { status: 500 },
    );
  }

  // --- 4) availability: Şimdi appointments temizlendi; RESTRICT engeli kalktı.
  const avDel = await admin
    .from("availability")
    .delete()
    .eq("teacher_id", teacherId);
  if (avDel.error) {
    console.error("[DELETE teacher] step4 availability FAILED", {
      teacherId,
      code: avDel.error.code,
      message: avDel.error.message,
    });
    return NextResponse.json(
      { error: "Öğretmen müsaitlikleri silinirken bir hata oluştu." },
      { status: 500 },
    );
  }

  // --- 5) teacher_students: Öğretmenin atama ilişkileri (teacher ve öğrenci
  //   tarafı, assigned_by dahil). 'assigned_by = teacherId' durumu SET NULL
  //   ile geçmiş atamaları korurdu; ancak kalıcı silmede kaybın tolere
  //   edilebilir olması için bu satırları da temizle.
  const tsT = await admin
    .from("teacher_students")
    .delete()
    .eq("teacher_id", teacherId);
  if (tsT.error) {
    console.error("[DELETE teacher] step5 teacher_students(teacher) FAILED", {
      teacherId,
      code: tsT.error.code,
      message: tsT.error.message,
    });
    return NextResponse.json(
      { error: "Öğretmen–öğrenci ilişkileri silinirken bir hata oluştu." },
      { status: 500 },
    );
  }
  const tsS = await admin
    .from("teacher_students")
    .delete()
    .eq("student_id", teacherId);
  if (tsS.error) {
    console.error("[DELETE teacher] step5b teacher_students(student) FAILED", {
      teacherId,
      code: tsS.error.code,
      message: tsS.error.message,
    });
    return NextResponse.json(
      { error: "Öğretmen–öğrenci ilişkileri silinirken bir hata oluştu." },
      { status: 500 },
    );
  }
  const tsA = await admin
    .from("teacher_students")
    .delete()
    .eq("assigned_by", teacherId);
  if (tsA.error) {
    console.error("[DELETE teacher] step5c teacher_students(assigned_by) FAILED", {
      teacherId,
      code: tsA.error.code,
      message: tsA.error.message,
    });
    return NextResponse.json(
      { error: "Öğretmen–öğrenci ilişkileri silinirken bir hata oluştu." },
      { status: 500 },
    );
  }

  // --- 6) profiles: Öğretmenin profil satırı (FK'lerden bağımsız → güvenli).
  const profDel = await admin.from("profiles").delete().eq("id", teacherId);
  if (profDel.error) {
    console.error("[DELETE teacher] step6 profiles FAILED", {
      teacherId,
      code: profDel.error.code,
      message: profDel.error.message,
    });
    return NextResponse.json(
      {
        error:
          "Öğretmen verileri temizlendi ancak profil kaydı silinemedi. Lütfen veritabanı yöneticinize başvurun.",
      },
      { status: 500 },
    );
  }

  // --- 7) auth.admin.deleteUser: En son GoTrue auth kullanıcısını sil.
  const { error: authDeleteError } =
    await admin.auth.admin.deleteUser(teacherId);

  if (authDeleteError) {
    console.error("[DELETE teacher] step7 auth.admin.deleteUser FAILED", {
      teacherId,
      code: authDeleteError.code,
      message: authDeleteError.message,
      name: authDeleteError.name,
      status: (authDeleteError as { status?: unknown }).status,
      allEnumerableKeys: Object.keys(authDeleteError),
    });
    return NextResponse.json(
      {
        error:
          "Öğretmen verileri temizlendi ancak kimlik doğrulama hesabı silinemedi. Lütfen yöneticinize başvurun.",
      },
      { status: 500 },
    );
  }

  const safe: DeleteResponse = {
    message: "Öğretmen kalıcı olarak silindi.",
    actorEmail: actor.email ?? null,
  };

  return NextResponse.json(safe, { status: 200 });
}
