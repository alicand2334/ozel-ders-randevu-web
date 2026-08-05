import { NextResponse } from "next/server";
import {
  createAuthVerifyClient,
  createServiceClient,
} from "@/lib/supabase/server-client";

// Supabase service-role client ve admin Auth API çağrıları Node.js
// runtime'ına bağlıdır; edge runtime'da çalışmaz.
export const runtime = "nodejs";

// GET /api/auth/student-guard
//   Client-side giriş akışında çağrılır._server tarafından access token
//   doğrulanir, profiles satırı okunur:
//     - role !== 'student' ise 403 + "Bu sayfa yalnızca öğrenciler içindir."
//     - is_active === false ise 403 + pasif mesajı
//   Başarılıysa 200 + { id, full_name } döner.
//
// Bu uç, istemci tarafından gönderilen role/is_active bilgisine güvenmez;
// profiles kaydını server tarafında service-role ile okur (RLS bypass).
//
// Pasif öğretmen davranışına veya admin girişine karışmaz.
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json(
      { error: "Oturum bulunamadı. Lütfen giriş yapın." },
      { status: 401 },
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json(
      { error: "Oturum bulunamadı. Lütfen giriş yapın." },
      { status: 401 },
    );
  }

  // Token doğrulaması için service-role client'inin global
  // "Authorization: Bearer <service_role>" header'ı ile auth.getUser(token)
  // çağrısı çakışıp GoTrue tarafında token doğrulamasını bozuyordu
  // (production'da esnek davranmıyordu). Bu yüzden anon-key'li, apikey
  // only ayrı bir auth doğrulama client kullanılır.
  const authClient = createAuthVerifyClient();
  let userId: string | null = null;
  try {
    const {
      data: { user: u },
      error,
    } = await authClient.auth.getUser(token);
    if (error || !u) {
      return NextResponse.json(
        { error: "Oturum bulunamadı. Lütfen giriş yapın." },
        { status: 401 },
      );
    }
    userId = u.id;
  } catch {
    return NextResponse.json(
      { error: "Oturum bulunamadı. Lütfen giriş yapın." },
      { status: 401 },
    );
  }

  const dbClient = createServiceClient();
  try {
    const { data: profile, error: profileError } = await dbClient
      .from("profiles")
      .select("role, is_active, full_name")
      .eq("id", userId!)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { error: "Profil bilgileri alınamadı." },
        { status: 500 },
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "Profil kaydınız bulunamadı. Lütfen yöneticinizle iletişime geçin." },
        { status: 403 },
      );
    }

    if (profile.role !== "student") {
      // Öğrenci olmayan kullanıcılar (admin/öğretmen) bu uçla engellenmez;
      // yalnızca bu uç onlar için uygun değildir — sessizce 200 dönmek yerine
      // öğrenci olmama durumunu belirtip istemcinin kendi akışına bırakıyoruz.
      return NextResponse.json(
        {
          error: "Bu sayfa yalnızca öğrenciler içindir.",
          not_student: true,
          role: profile.role ?? null,
        },
        { status: 403 },
      );
    }

    if (!profile.is_active) {
      return NextResponse.json(
        {
          error:
            "Hesabınız pasife alınmıştır. Lütfen yöneticinizle iletişime geçin.",
          inactive: true,
        },
        { status: 403 },
      );
    }

    return NextResponse.json(
      {
        id: userId,
        full_name: profile.full_name ?? null,
        is_active: true,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Profil bilgileri alınamadı." },
      { status: 500 },
    );
  }
}
