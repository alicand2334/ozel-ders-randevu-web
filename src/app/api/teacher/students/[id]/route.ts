import { NextResponse } from "next/server";
import {
  createServiceClient,
  verifyTeacherActor,
} from "@/lib/supabase/server-client";

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
  slot: AppointmentSlotRow[] | null;
};

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
        "id, status, lesson, subject, notes, student_id, slot_id, created_at, slot:availability(available_date, start_time, end_time)",
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
