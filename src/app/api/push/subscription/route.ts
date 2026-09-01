import { NextResponse } from "next/server";
import { createServiceClient, verifyStudentActor, verifyTeacherActor } from "@/lib/supabase/server-client";

export const runtime = "nodejs";

type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

type PushSubscriptionPayload = {
  endpoint: string;
  keys: PushSubscriptionKeys;
  userAgent?: string;
};

type SubscriptionResponse = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function getVapidPublicKey(): string {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) {
    throw new Error("VAPID_PUBLIC_KEY environment variable is not set");
  }
  return key;
}

export async function GET(request: Request): Promise<Response> {
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

  const admin = createServiceClient();

  try {
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth, is_active, created_at, updated_at")
      .eq("user_id", actor.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "Abonelikler getirilemedi." },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? [], { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Abonelikler getirilemedi." },
      { status: 500 }
    );
  }
}

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

  let body: PushSubscriptionPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz istek gövdesi." },
      { status: 400 }
    );
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json(
      { error: "Endpoint ve keys (p256dh, auth) zorunludur." },
      { status: 400 }
    );
  }

  const admin = createServiceClient();

  try {
    const { data: existing, error: checkError } = await admin
      .from("push_subscriptions")
      .select("id, is_active")
      .eq("endpoint", body.endpoint)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      return NextResponse.json(
        { error: "Abonelik kontrolünde hata oluştu." },
        { status: 500 }
      );
    }

    if (existing) {
      if (existing.is_active) {
        const { data: updated, error: updateError } = await admin
          .from("push_subscriptions")
          .update({
            user_id: actor.id,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
            user_agent: body.userAgent ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("endpoint", body.endpoint)
          .select("id, user_id, endpoint, p256dh, auth, is_active, created_at, updated_at")
          .single();

        if (updateError) {
          return NextResponse.json(
            { error: "Abonelik güncellenirken hata oluştu." },
            { status: 500 }
          );
        }

        return NextResponse.json(updated, { status: 200 });
      } else {
        const { data: reactivated, error: reactivateError } = await admin
          .from("push_subscriptions")
          .update({
            user_id: actor.id,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
            user_agent: body.userAgent ?? null,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("endpoint", body.endpoint)
          .select("id, user_id, endpoint, p256dh, auth, is_active, created_at, updated_at")
          .single();

        if (reactivateError) {
          return NextResponse.json(
            { error: "Abonelik yeniden aktifleştirilemedi." },
            { status: 500 }
          );
        }

        return NextResponse.json(reactivated, { status: 200 });
      }
    }

    const { data: inserted, error: insertError } = await admin
      .from("push_subscriptions")
      .insert({
        user_id: actor.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: body.userAgent ?? null,
        is_active: true,
      })
      .select("id, user_id, endpoint, p256dh, auth, is_active, created_at, updated_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Bu cihaz zaten kayıtlı." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Abonelik oluşturulurken hata oluştu." },
        { status: 500 }
      );
    }

    return NextResponse.json(inserted, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Abonelik işlemi sırasında beklenmeyen hata oluştu." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
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

  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");

  if (!endpoint) {
    return NextResponse.json(
      { error: "Endpoint parametresi zorunludur." },
      { status: 400 }
    );
  }

  const admin = createServiceClient();

  try {
    const { error } = await admin
      .from("push_subscriptions")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("endpoint", endpoint)
      .eq("user_id", actor.id);

    if (error) {
      return NextResponse.json(
        { error: "Abonelik devre dışı bırakılırken hata oluştu." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Abonelik silinirken beklenmeyen hata oluştu." },
      { status: 500 }
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}