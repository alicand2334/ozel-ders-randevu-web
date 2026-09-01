import { NextResponse } from "next/server";
import { createServiceClient, verifyStudentActor, verifyTeacherActor } from "@/lib/supabase/server-client";
import { sendPushToUser } from "@/lib/push/webpush";

export const runtime = "nodejs";

type AppointmentPushPayload = {
  appointmentId: string;
  type: "booking_created" | "booking_confirmed" | "booking_rejected" | "booking_cancelled_by_teacher" | "booking_cancelled_by_student" | "booking_completed";
  teacherId?: string;
  studentId?: string;
};

export async function POST(request: Request): Promise<Response> {
  const student = await verifyStudentActor(request);
  const teacher = await verifyTeacherActor(request);
  const actor = student ?? teacher;

  if (!actor) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Oturum bulunamadı. Lütfen giriş yapın." },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: "Bu işlem için yetkiniz bulunmuyor." },
      { status: 403 }
    );
  }

  let body: AppointmentPushPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz istek gövdesi." },
      { status: 400 }
    );
  }

  if (!body.appointmentId || !body.type) {
    return NextResponse.json(
      { error: "Eksik parametreler." },
      { status: 400 }
    );
  }

  const admin = createServiceClient();

  try {
    const { data: appointment, error: apptError } = await admin
      .from("appointments")
      .select(`
        id,
        status,
        lesson,
        subject,
        notes,
        student_id,
        teacher_id,
        slot:availability(available_date, start_time, end_time)
      `)
      .eq("id", body.appointmentId)
      .single();

    if (apptError || !appointment) {
      return NextResponse.json(
        { error: "Randevu bulunamadı." },
        { status: 404 }
      );
    }

    const slot = appointment.slot && appointment.slot.length > 0 ? appointment.slot[0] : null;
    const dateStr = slot?.available_date ? new Date(slot.available_date).toLocaleDateString("tr-TR", { 
      day: "2-digit", 
      month: "2-digit", 
      year: "numeric",
      timeZone: "Europe/Istanbul"
    }) : "Tarih belirtilmemiş";
    const timeStr = slot ? `${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)}` : "";

    let title = "";
    let bodyText = "";
    let recipientId = "";
    let actorName = "";

    if (student && body.type === "booking_created") {
      // Student created appointment -> notify teacher
      const { data: teacherProfile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", appointment.teacher_id)
        .single();

      const { data: studentProfile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", actor.id)
        .single();

      actorName = studentProfile?.full_name || "Bir öğrenci";
      recipientId = appointment.teacher_id;
      title = "Yeni Randevu Talebi";
      bodyText = `${actorName} ${dateStr} ${timeStr} için bir randevu talebi oluşturdu.`;
    } else if (teacher) {
      // Teacher actions -> notify student
      const { data: teacherProfile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", actor.id)
        .single();

      actorName = teacherProfile?.full_name || "Öğretmeniniz";
      recipientId = appointment.student_id;

      switch (body.type) {
        case "booking_confirmed":
          title = "Randevunuz Onaylandı";
          bodyText = `${actorName} ${dateStr} ${timeStr} randevunuzu onayladı.`;
          break;
        case "booking_rejected":
          title = "Randevu Talebi Reddedildi";
          bodyText = `${actorName} ${dateStr} ${timeStr} randevu talebinizi reddetti.`;
          break;
        case "booking_cancelled_by_teacher":
          title = "Randevu İptal Edildi";
          bodyText = `${actorName} ${dateStr} ${timeStr} randevunuzu iptal etti.`;
          break;
        case "booking_completed":
          title = "Ders Tamamlandı";
          bodyText = `${actorName} ${dateStr} ${timeStr} dersini tamamlandı olarak işaretledi.`;
          break;
        default:
          return NextResponse.json(
            { error: "Geçersiz bildirim tipi." },
            { status: 400 }
          );
      }
    } else if (student && body.type === "booking_cancelled_by_student") {
      // Student cancelled -> notify teacher
      const { data: studentProfile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", actor.id)
        .single();

      actorName = studentProfile?.full_name || "Öğrenci";
      recipientId = appointment.teacher_id;
      title = "Randevu İptal Edildi";
      bodyText = `${actorName} ${dateStr} ${timeStr} randevusunu iptal etti.`;
    } else {
      return NextResponse.json(
        { error: "Bu işlem için yetkiniz yok." },
        { status: 403 }
      );
    }

    if (!recipientId) {
      return NextResponse.json(
        { error: "Alıcı belirlenemedi." },
        { status: 400 }
      );
    }

    const result = await sendPushToUser(recipientId, {
      title,
      body: bodyText,
      type: body.type,
      tag: `appointment-${body.type}-${body.appointmentId}`,
      url: student ? `/ogrenci/homework?appt=${body.appointmentId}` : `/panel/ogretmen/randevular?appt=${body.appointmentId}`,
      appointment_id: body.appointmentId,
      requireInteraction: true,
    });

    return NextResponse.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      errors: result.errors,
    }, { status: 200 });
  } catch (error) {
    console.error("[Push Appointment] Error:", error);
    return NextResponse.json(
      { error: "Bildirim gönderilirken hata oluştu." },
      { status: 500 }
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}