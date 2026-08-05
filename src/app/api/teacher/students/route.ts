import { NextResponse } from "next/server";
import {
  assignTeacherStudent,
  createServiceClient,
  createStudentUser,
  rollbackStudentUser,
  verifyTeacherActor,
} from "@/lib/supabase/server-client";
import { isValidEmail } from "@/lib/supabase/auth-helpers";

// Supabase service-role client ve admin Auth API çağrıları Node.js
// runtime'ına bağlıdır; edge runtime'da çalışmaz.
export const runtime = "nodejs";

type CreateStudentPayload = {
  full_name?: unknown;
  email?: unknown;
  temporary_password?: unknown;
  phone?: unknown;
};

type SafeStudentResponse = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
};

type StudentListRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
};

type TeacherStudentRow = {
  student_id: string;
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

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");

  const actor = await verifyTeacherActor(request);
  if (!actor) {
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
    const { data: links, error: linksError } = await admin
      .from("teacher_students")
      .select("student_id")
      .eq("teacher_id", actor.id);

    if (linksError) {
      return NextResponse.json(
        { error: "Öğrenci listesi getirilemedi." },
        { status: 500 },
      );
    }

    const studentIds = ((links ?? []) as TeacherStudentRow[]).map(
      (r) => r.student_id,
    );

    if (studentIds.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, full_name, phone, is_active")
        .in("id", studentIds);

    if (profilesError) {
      return NextResponse.json(
        { error: "Öğrenci listesi getirilemedi." },
        { status: 500 },
      );
    }

    const rows = (profiles ?? []) as StudentListRow[];
    return NextResponse.json(rows, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Öğrenci listesi getirilemedi." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: CreateStudentPayload;
  try {
    body = (await request.json()) as CreateStudentPayload;
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

  const fullName = isNonEmptyString(body.full_name)
    ? body.full_name.trim()
    : "";
  const email =
    typeof body.email === "string" ? body.email.trim() : "";
  const temporaryPassword =
    typeof body.temporary_password === "string"
      ? body.temporary_password
      : "";
  const phone = optionalString(body.phone);

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

  const result = await createStudentUser({
    full_name: fullName,
    email,
    temporary_password: temporaryPassword,
    phone,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  const assignment = await assignTeacherStudent({
    teacher_id: actor.id,
    student_id: result.userId,
    assigned_by: actor.id,
  });

  if (!assignment.ok) {
    await rollbackStudentUser(result.userId);
    return NextResponse.json(
      { error: assignment.error },
      { status: assignment.status },
    );
  }

  const safe: SafeStudentResponse = {
    id: result.userId,
    full_name: fullName,
    email,
    is_active: true,
  };

  return NextResponse.json(safe, { status: 201 });
}
