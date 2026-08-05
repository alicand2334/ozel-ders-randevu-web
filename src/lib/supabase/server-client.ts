import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Eksik sunucu ortam değişkeni: ${name}. .env.local içine ekleyin.`,
    );
  }
  return value;
}

export function createServiceClient() {
  const url = getEnvOrThrow("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnvOrThrow("SUPABASE_SERVICE_ROLE_KEY");
  // Supabase-js, createClient(url, serviceRoleKey) ile service_role anahtarını
  // otomatik olarak `apikey` header'ına set eder; PostgREST service-role
  // bypass (RLS muafiyeti) için bu `apikey`'yi tanır. Manuel `Authorization:
  // Bearer <service_role>` override etmek gereksizdir ve üretimde PostgREST
  // tarafında "Invalid API key" hatasına yol açabilmektedir (apikey ile
  // Authorization çakışıp geçersiz kombinasyon oluşabiliyordu). Bu yüzden
  // global header override yapılmaz; supabase-js varsayılan davranışına
  // bırakılır.
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// auth.getUser(token) çağrısı için kullanılan anon-key'li client. Service-role
// client'ının global "Authorization: Bearer <service_role>" header'ı, supabase-js
// `auth.getUser(token)` sırasında set edilen "Authorization: Bearer <token>"
// header'ı ile çakışıp production (GoTrue auth) tarafında token doğrulamasını
// bozabiliyordu (lokalde esnek davranıyordu). Bu yüzden kullanıcı JWT'sini
// doğrulamak için temiz, anon-key'li (apikey only) bir client kullanıyoruz.
// PostgREST/RLS bu client ile çalıştırılmaz; profiles sorgusu için ayrı service
// client (createServiceClient) kullanılır.
export function createAuthVerifyClient() {
  const url = getEnvOrThrow("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = getEnvOrThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function verifyAdminActor(
  request: Request,
): Promise<{ id: string; email: string | null } | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return null;
  }

  // auth.getUser(token) için service-role client'inin global
  // "Authorization: Bearer <service_role>" header'ı ile token çakıştığından
  // ayrı, anon-key'li (apikey only) temiz client kullanılır.
  const authClient = createAuthVerifyClient();
  let user: { id: string; email?: string | null } | null = null;
  try {
    const {
      data: { user: u },
      error,
    } = await authClient.auth.getUser(token);

    if (error || !u) {
      return null;
    }
    user = u;
  } catch {
    return null;
  }

  // profiles sorgusu için RLS bypass (service_role) client kullanılır.
  const dbClient = createServiceClient();
  try {
    const { data: profile, error: profileError } = await dbClient
      .from("profiles")
      .select("role")
      .eq("id", user!.id)
      .maybeSingle();

    if (profileError || !profile) {
      return null;
    }

    if (profile.role !== "admin") {
      return null;
    }

    return { id: user!.id, email: user!.email ?? null };
  } catch {
    return null;
  }
}

export type ActorInfo = { id: string; email: string | null };

export async function verifyStudentActor(
  request: Request,
): Promise<ActorInfo | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return null;
  }

  const authClient = createAuthVerifyClient();
  let user: { id: string; email?: string | null } | null = null;
  try {
    const {
      data: { user: u },
      error,
    } = await authClient.auth.getUser(token);

    if (error || !u) {
      return null;
    }
    user = u;
  } catch {
    return null;
  }

  // profiles sorgusu için RLS bypass (service_role) client kullanılır.
  const dbClient = createServiceClient();
  try {
    const {
      data: profile,
      error: profileError,
    } = await dbClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", user!.id)
      .maybeSingle();

    if (profileError || !profile) {
      return null;
    }

    // Açıklama için bkz. verifyTeacherActor: `is_active` kolon tipi
    // numeric/string olabileceğinden katı `!== true` yerine truthy kontrol.
    if (profile.role !== "student" || !profile.is_active) {
      return null;
    }

    return { id: user!.id, email: user!.email ?? null };
  } catch {
    return null;
  }
}

export async function verifyTeacherActor(
  request: Request,
): Promise<ActorInfo | null> {
  const TAG = "[verifyTeacherActor]";

  // 1) Authorization header var mı?
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    console.warn(`${TAG} 403 SEBEP=1 authorization_header=YOK`);
    return null;
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    console.warn(
      `${TAG} 403 SEBEP=2 token=BOS header_len=${authHeader.length}`,
    );
    return null;
  }

  // 2) auth.getUser(token) başarılı mı? user.id nedir?
  const authClient = createAuthVerifyClient();
  let user: { id: string; email?: string | null } | null = null;
  try {
    const {
      data: { user: u },
      error,
    } = await authClient.auth.getUser(token);

    if (error) {
      console.warn(
        `${TAG} 403 SEBEP=3 auth_getUser=HATA code=${error.code ?? "YOK"} message=${error.message ?? "YOK"}`,
      );
      return null;
    }
    if (!u) {
      console.warn(`${TAG} 403 SEBEP=4 auth_getUser=USER_NULL`);
      return null;
    }
    console.warn(
      `${TAG} auth_getUser=OK user_id=${u.id} user_email=${u.email ?? "YOK"}`,
    );
    user = u;
  } catch (e) {
    const err = e as { code?: string; message?: string } | null;
    console.warn(
      `${TAG} 403 SEBEP=5 auth_getUser=EXCEPTION code=${err?.code ?? "YOK"} message=${err?.message ?? "YOK"}`,
    );
    return null;
  }

  // 3/4/5) profiles sorgusu kaç satır, role ve is_active ne?
  const dbClient = createServiceClient();
  try {
    const {
      data: profile,
      error: profileError,
    } = await dbClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", user!.id)
      .maybeSingle();

    if (profileError) {
      console.warn(
        `${TAG} 403 SEBEP=6 profiles_query=HATA code=${profileError.code ?? "YOK"} message=${profileError.message ?? "YOK"}`,
      );
      return null;
    }
    if (!profile) {
      console.warn(
        `${TAG} 403 SEBEP=7 profiles_query=ROWS_0 user_id=${user!.id}`,
      );
      return null;
    }

    console.warn(
      `${TAG} profiles_query=ROWS_1 role=${JSON.stringify(profile.role)} is_active=${JSON.stringify(profile.is_active)} is_active_type=${typeof profile.is_active}`,
    );

    // 6) 403'ün oluştuğu tam satır — tek satır kesin sebep
    if (profile.role !== "teacher") {
      console.warn(
        `${TAG} 403 SEBEP=8 role_mismatch expected=teacher actual=${JSON.stringify(profile.role)}`,
      );
      return null;
    }
    if (profile.is_active !== true) {
      console.warn(
        `${TAG} 403 SEBEP=9 is_active_not_true value=${JSON.stringify(profile.is_active)} type=${typeof profile.is_active}`,
      );
      return null;
    }

    console.warn(`${TAG} OK teacher dogrulandi user_id=${user!.id}`);
    return { id: user!.id, email: user!.email ?? null };
  } catch (e) {
    const err = e as { code?: string; message?: string } | null;
    console.warn(
      `${TAG} 403 SEBEP=10 profiles_query=EXCEPTION code=${err?.code ?? "YOK"} message=${err?.message ?? "YOK"}`,
    );
    return null;
  }
}

export type CreateStudentInput = {
  full_name: string;
  email: string;
  temporary_password: string;
  phone?: string | null;
};

export type CreateStudentResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export async function createStudentUser(
  input: CreateStudentInput,
): Promise<CreateStudentResult> {
  const admin = createServiceClient();

  const cleanFullName = input.full_name.trim();
  const cleanEmail = input.email.trim();
  const password = input.temporary_password;
  const phone =
    typeof input.phone === "string" && input.phone.trim().length > 0
      ? input.phone.trim()
      : null;

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: cleanFullName,
        phone,
      },
    });

  if (createError || !created?.user) {
    const message = createError?.message ?? "";
    if (/already.*registered|already.*exists|user.*exists/i.test(message)) {
      return {
        ok: false,
        status: 409,
        error: "Bu e-posta adresiyle kayıtlı bir kullanıcı zaten var.",
      };
    }
    if (/password|weak/i.test(message)) {
      return {
        ok: false,
        status: 400,
        error: "Şifre politika gereksinimlerini karşılamıyor.",
      };
    }
    return {
      ok: false,
      status: 500,
      error: "Kullanıcı oluşturulurken bir hata oluştu.",
    };
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: userId,
      role: "student",
      full_name: cleanFullName,
      phone,
      is_active: true,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return {
      ok: false,
      status: 500,
      error: "Profil kaydı oluşturulamadı. İşlem geri alındı.",
    };
  }

  return { ok: true, userId };
}

export type AssignTeacherStudentInput = {
  teacher_id: string;
  student_id: string;
  assigned_by: string;
};

export type AssignTeacherStudentResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function assignTeacherStudent(
  input: AssignTeacherStudentInput,
): Promise<AssignTeacherStudentResult> {
  const admin = createServiceClient();

  try {
    const { error } = await admin.from("teacher_students").insert({
      teacher_id: input.teacher_id,
      student_id: input.student_id,
      assigned_by: input.assigned_by,
    });

    if (error) {
      const errAny = error as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      console.warn("[assignTeacherStudent] INSERT error nesnesi:");
      console.warn("[assignTeacherStudent] code:", errAny.code ?? "YOK");
      console.warn("[assignTeacherStudent] message:", errAny.message ?? "YOK");
      console.warn("[assignTeacherStudent] details:", errAny.details ?? "YOK");
      console.warn("[assignTeacherStudent] hint:", errAny.hint ?? "YOK");

      const code = errAny.code ?? "";
      if (code === "23505") {
        return {
          ok: false,
          status: 409,
          error: "Bu öğrenci zaten bu öğretmene bağlı.",
        };
      }
      if (code === "23503") {
        return {
          ok: false,
          status: 400,
          error: "Öğretmen veya öğrenci kaydı bulunamadı.",
        };
      }
      return {
        ok: false,
        status: 500,
        error: "Öğretmen–öğrenci ilişkisi kaydedilemedi.",
      };
    }

    return { ok: true };
  } catch (e) {
    console.warn("[assignTeacherStudent] INSERT exception fırlattı");
    const err = e as {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
    } | null;
    console.warn("[assignTeacherStudent] code:", err?.code ?? "YOK");
    console.warn("[assignTeacherStudent] message:", err?.message ?? "YOK");
    console.warn("[assignTeacherStudent] details:", err?.details ?? "YOK");
    console.warn("[assignTeacherStudent] hint:", err?.hint ?? "YOK");
    return {
      ok: false,
      status: 500,
      error: "Öğretmen–öğrenci ilişkisi kaydedilemedi.",
    };
  }
}

export async function rollbackStudentUser(userId: string): Promise<void> {
  const admin = createServiceClient();
  try {
    await admin.from("profiles").delete().eq("id", userId);
  } catch {
    // sessizce yut: en azından denendi
  }
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    // sessizce yut: en azından denendi
  }
}

export function unauthorizedResponse(): Response {
  return NextResponse.json(
    { error: "Oturum bulunamadı. Lütfen giriş yapın." },
    { status: 401 },
  );
}

export function forbiddenResponse(): Response {
  return NextResponse.json(
    { error: "Bu işlem için yetkiniz bulunmuyor." },
    { status: 403 },
  );
}
