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
  //randezbulardan herhangi biri varsa silme reddedilir (409).
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

  // Sıra: önce Supabase Auth kullanıcısı silinir (FK'sız, en güvenli
  // ayrım). ardindan profiles silinir; baglı tablolar (availability,
  // availability_overrides, appointments->notifications, teacher_students)
  // ON DELETE CASCADE ile otomatik düşer.
  const { error: authDeleteError } =
    await admin.auth.admin.deleteUser(teacherId);

  if (authDeleteError) {
    return NextResponse.json(
      { error: "Auth hesabı silinirken bir hata oluştu." },
      { status: 500 },
    );
  }

  const { error: profileDeleteError } = await admin
    .from("profiles")
    .delete()
    .eq("id", teacherId);

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
    message: "Öğretmen kalıcı olarak silindi.",
    actorEmail: actor.email ?? null,
  };

  return NextResponse.json(safe, { status: 200 });
}
