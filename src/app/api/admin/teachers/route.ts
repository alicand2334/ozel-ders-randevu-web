import { NextResponse } from "next/server";
import {
  createServiceClient,
  verifyAdminActor,
} from "@/lib/supabase/server-client";
import { isValidEmail } from "@/lib/supabase/auth-helpers";

type CreateTeacherPayload = {
  full_name?: unknown;
  email?: unknown;
  temporary_password?: unknown;
  phone?: unknown;
  specialization?: unknown;
  bio?: unknown;
};

type SafeTeacherResponse = {
  id: string;
  full_name: string;
  email: string;
  specialization: string;
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

export async function POST(request: Request): Promise<Response> {
  let body: CreateTeacherPayload;
  try {
    body = (await request.json()) as CreateTeacherPayload;
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

  const fullName = isNonEmptyString(body.full_name)
    ? body.full_name.trim()
    : "";
  const email =
    typeof body.email === "string" ? body.email.trim() : "";
  const temporaryPassword =
    typeof body.temporary_password === "string"
      ? body.temporary_password
      : "";
  const specialization = isNonEmptyString(body.specialization)
    ? body.specialization.trim()
    : "";
  const phone = optionalString(body.phone);
  const bio = optionalString(body.bio);

  if (!fullName) {
    return NextResponse.json(
      { error: "Ad soyad boş olamaz." },
      { status: 400 },
    );
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Geçerli bir e-posta adresi girin." },
      { status: 400 },
    );
  }
  if (temporaryPassword.length < 8) {
    return NextResponse.json(
      { error: "Geçici şifre en az 8 karakter olmalı." },
      { status: 400 },
    );
  }
  if (!specialization) {
    return NextResponse.json(
      { error: "Branş alanı boş olamaz." },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        phone: phone ?? null,
      },
    });

  if (createError || !created?.user) {
    const message = createError?.message ?? "";
    if (/already.*registered|already.*exists|user.*exists/i.test(message)) {
      return NextResponse.json(
        { error: "Bu e-posta adresine sahip bir kullanıcı zaten kayıtlı." },
        { status: 409 },
      );
    }
    if (/password|weak/i.test(message)) {
      return NextResponse.json(
        { error: "Şifre politika gereksinimlerini karşılamıyor." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Kullanıcı oluşturulurken bir hata oluştu." },
      { status: 500 },
    );
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: userId,
      role: "teacher",
      full_name: fullName,
      phone,
      specialization,
      bio,
      is_active: true,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json(
      { error: "Profil kaydı oluşturulamadı. İşlem geri alındı." },
      { status: 500 },
    );
  }

  const safe: SafeTeacherResponse = {
    id: userId,
    full_name: fullName,
    email,
    specialization,
    is_active: true,
  };

  return NextResponse.json(safe, { status: 201 });
}
