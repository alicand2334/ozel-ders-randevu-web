import { NextResponse } from "next/server";
import { createServiceClient, verifyTeacherActor } from "@/lib/supabase/server-client";
import { sendPushToMultipleUsers } from "@/lib/push/webpush";

export const runtime = "nodejs";

type HomeworkPushPayload = {
  studentIds: string[];
  title: string;
  description: string;
  dueDate: string;
  dueTime: string | null;
  homeworkId: string;
  type: "assigned" | "updated";
};

export async function POST(request: Request): Promise<Response> {
  const teacher = await verifyTeacherActor(request);

  if (!teacher) {
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

  let body: HomeworkPushPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz istek gövdesi." },
      { status: 400 }
    );
  }

  if (!body.studentIds || body.studentIds.length === 0) {
    return NextResponse.json(
      { error: "En az bir öğrenci ID'si gereklidir." },
      { status: 400 }
    );
  }

  if (!body.title || !body.description || !body.dueDate || !body.homeworkId) {
    return NextResponse.json(
      { error: "Eksik parametreler." },
      { status: 400 }
    );
  }

  const admin = createServiceClient();

  try {
    const { data: teacherProfile, error: teacherError } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", teacher.id)
      .single();

    if (teacherError || !teacherProfile) {
      return NextResponse.json(
        { error: "Öğretmen bilgisi alınamadı." },
        { status: 500 }
      );
    }

    const teacherName = teacherProfile.full_name || "Öğretmeniniz";
    const dueTime = body.dueTime ? ` ${body.dueTime.slice(0, 5)}` : "";
    
    const title = body.type === "assigned" ? "Yeni Ödev" : "Ödev Güncellendi";
    const bodyText = body.type === "assigned"
      ? `${teacherName} size yeni bir ödev verdi: ${body.description.substring(0, 100)}${body.description.length > 100 ? "..." : ""}. Son teslim: ${body.dueDate}${dueTime}`
      : `${teacherName} ödevi güncelledi: ${body.description.substring(0, 100)}${body.description.length > 100 ? "..." : ""}. Yeni son teslim: ${body.dueDate}${dueTime}`;

    const result = await sendPushToMultipleUsers(body.studentIds, {
      title,
      body: bodyText,
      type: body.type === "assigned" ? "homework_assigned" : "homework_updated",
      tag: `homework-${body.type}-${body.homeworkId}`,
      url: `/ogrenci/homework?hw=${body.homeworkId}`,
      homework_id: body.homeworkId,
      requireInteraction: true,
    });

    return NextResponse.json({
      success: true,
      sent: result.totalSent,
      failed: result.totalFailed,
      details: result.userResults,
    }, { status: 200 });
  } catch (error) {
    console.error("[Push Homework] Error:", error);
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