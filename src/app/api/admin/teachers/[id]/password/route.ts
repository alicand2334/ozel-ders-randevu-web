import { NextResponse } from "next/server";
import {
  createServiceClient,
  verifyAdminActor,
} from "@/lib/supabase/server-client";

type PasswordPayload = {
  temporary_password?: unknown;
};

export async function POST(
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

  let body: PasswordPayload;
  try {
    body = (await request.json()) as PasswordPayload;
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

  const temporaryPassword =
    typeof body.temporary_password === "string" ? body.temporary_password : "";

  if (temporaryPassword.length < 8) {
    return NextResponse.json(
      { error: "Yeni geçici şifre en az 8 karakter olmalı." },
      { status: 400 },
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

  if (profile.role !== "teacher") {
    return NextResponse.json(
      { error: "Yalnızca öğretmen hesapları için şifre sıfırlanabilir." },
      { status: 400 },
    );
  }

  const { error: updateError } =
    await admin.auth.admin.updateUserById(teacherId, {
      password: temporaryPassword,
    });

  if (updateError) {
    const message = updateError.message ?? "";
    if (/password|weak/i.test(message)) {
      return NextResponse.json(
        { error: "Şifre politika gereksinimlerini karşılamıyor." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Şifre güncellenirken bir hata oluştu." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { message: "Öğretmen şifresi başarıyla güncellendi." },
    { status: 200 },
  );
}
