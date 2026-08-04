import { NextResponse } from "next/server";
import {
  createServiceClient,
  verifyAdminActor,
} from "@/lib/supabase/server-client";

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
    .eq("id", studentId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: "Öğrenci bilgileri alınamadı." },
      { status: 500 },
    );
  }

  if (!profile) {
    return NextResponse.json(
      { error: "Öğrenci bulunamadı." },
      { status: 404 },
    );
  }

  if (profile.role !== "student") {
    return NextResponse.json(
      { error: "Yalnızca öğrenci hesapları düzenlenebilir." },
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
  actorEmail?: string | null;
};

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
    .eq("id", studentId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: "Öğrenci bilgileri alınamadı." },
      { status: 500 },
    );
  }

  if (!profile) {
    return NextResponse.json(
      { error: "Öğrenci bulunamadı." },
      { status: 404 },
    );
  }

  if (profile.role === "admin") {
    return NextResponse.json(
      { error: "Yönetici hesapları bu yolla silinemez." },
      { status: 400 },
    );
  }

  if (profile.role !== "student") {
    return NextResponse.json(
      { error: "Yalnızca öğrenci hesapları silinebilir." },
      { status: 400 },
    );
  }

  if (actor.id === studentId) {
    return NextResponse.json(
      { error: "Kendi hesabınızı bu yolla silemezsiniz." },
      { status: 400 },
    );
  }

  // Aktif randevu kontrolü: yalnızca pending veya confirmed durumundaki
  // randevular silmeyi engeller. cancelled/completed gibi durumlar engellemez.
  // head+count kullanılarak yalnızca sayaç alınır (gereksiz satır transferi yok).
  const { count: activeApptCount, error: apptError } = await admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .in("status", ["pending", "confirmed"]);

  if (apptError) {
    return NextResponse.json(
      { error: "Randevular kontrol edilirken bir hata oluştu." },
      { status: 500 },
    );
  }

  // Geliştirme ortamında teşhis için: öğrencinin tüm randevu sayısını,
  // aktif olanlarını ve bu randevuların gerçekten bu öğrenciye mi yoksa
  // bir öğretmene mi ait olduğunu (teacher_id karışıklığı olasılığı)
  // netleştirmek üzere斡旋 bilgileri logla. Production'da çalışmaz.
  if (process.env.NODE_ENV !== "production") {
    try {
      const { count: totalCount } = await admin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId);

      const { count: asTeacherCount } = await admin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("teacher_id", studentId)
        .in("status", ["pending", "confirmed"]);

      // Eigentümer'name: hem profile_id hem auth.user_id'yi görmek için
      // auth.admin.getUserById kullanılır; profiles.id == auth.users.id olmalı.
      let authEmail: string | null = null;
      try {
        const { data: ua } = await admin.auth.admin.getUserById(studentId);
        authEmail = ua?.user?.email ?? null;
      } catch {
        authEmail = null;
      }

      console.info(
        `[DELETE /api/admin/students/[id]] student_id=${studentId} ` +
          `profile.full_name=${profile.full_name ?? "n/a"} ` +
          `auth.email=${authEmail ?? "n/a"} ` +
          `total_appointments(student_id)=${totalCount ?? "n/a"} ` +
          `active(student_id, pending|confirmed)=${activeApptCount ?? 0} ` +
          `active(teacher_id, pending|confirmed)=${asTeacherCount ?? 0}`,
      );
    } catch {
      console.info(
        `[DELETE /api/admin/students/[id]] student_id=${studentId} ` +
          `teşhis sorgusu başarısız; active=${activeApptCount ?? 0}`,
      );
    }
  }

  if ((activeApptCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Bu öğrencinin aktif randevuları bulunduğu için kalıcı silme yapılamıyor. Önce randevuları iptal edin veya öğrenciyi pasife alın.",
      },
      { status: 409 },
    );
  }

  // Sıra: önce Supabase Auth kullanıcısı silinir (FK'sız, en güvenli
  // ayrım). ardindan profiles silinir; baglı tablolar (appointments->
  // notifications, teacher_students) ON DELETE CASCADE ile otomatik düşer.
  const { error: authDeleteError } =
    await admin.auth.admin.deleteUser(studentId);

  if (authDeleteError) {
    return NextResponse.json(
      { error: "Auth hesabı silinirken bir hata oluştu." },
      { status: 500 },
    );
  }

  const { error: profileDeleteError } = await admin
    .from("profiles")
    .delete()
    .eq("id", studentId);

  if (profileDeleteError) {
    return NextResponse.json(
      {
        error:
          "Auth hesabı silindi ancak profil kaydı temizlenemedi. Lütfen veritabanı yöneticinize başvurun.",
      },
      { status: 500 },
    );
  }

  const safe: DeleteResponse = {
    message: "Öğrenci kalıcı olarak silindi.",
    actorEmail: actor.email ?? null,
  };

  return NextResponse.json(safe, { status: 200 });
}
