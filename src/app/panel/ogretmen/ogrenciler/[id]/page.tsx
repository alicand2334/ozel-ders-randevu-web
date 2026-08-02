"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge, Card, SectionTitle } from "@/components/ui";

type FetchState = "loading" | "ready" | "error" | "not-found";

type ProfilePayload = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  role: string | null;
};

type AppointmentSlot = {
  available_date: string;
  start_time: string;
  end_time: string;
} | null;

type AppointmentPayload = {
  id: string;
  status: string | null;
  lesson: string | null;
  subject: string | null;
  notes: string | null;
  slot_id: string;
  created_at: string;
  slot: AppointmentSlot;
};

type DetailApiResponse = {
  profile: ProfilePayload;
  appointments: AppointmentPayload[];
};

type ApiError = { error?: string };

const STATUS_LABEL: Record<string, string> = {
  pending: "Beklemede",
  confirmed: "Onaylandı",
  cancelled: "İptal Edildi",
  completed: "Tamamlandı",
};

export default function StudentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const studentId = typeof params?.id === "string" ? params.id : "";

  const { user, loading } = useAuth();
  const [roleLoading, setRoleLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [appointments, setAppointments] = useState<AppointmentPayload[]>([]);
  const [state, setState] = useState<FetchState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/giris");
    }
  }, [loading, user, router]);

  useEffect(() => {
    let active = true;

    if (loading || !user) {
      return;
    }

    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setRoleLoading(false);
        return;
      }

      if (data?.role === "teacher") {
        setAllowed(true);
      } else if (data?.role === "admin") {
        router.replace("/panel/admin");
      } else {
        router.replace("/panel");
      }

      setRoleLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loading, user, router]);

  const fetchDetail = useCallback(async () => {
    if (!studentId) {
      setState("error");
      setErrorMsg("Öğrenci kimliği eksik.");
      return;
    }

    setState("loading");
    setErrorMsg(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setState("error");
        setErrorMsg("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        return;
      }

      const res = await fetch(
        `/api/teacher/students/${encodeURIComponent(studentId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const payload: DetailApiResponse | ApiError = await res.json();

      if (res.status === 404) {
        setState("not-found");
        return;
      }

      if (!res.ok || !("profile" in payload)) {
        const apiError = payload as ApiError;
        setState("error");
        setErrorMsg(
          apiError.error ?? "Öğrenci bilgileri getirilemedi.",
        );
        return;
      }

      setProfile(payload.profile);
      setAppointments(payload.appointments);
      setState("ready");
    } catch {
      setState("error");
      setErrorMsg("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
    }
  }, [studentId]);

  useEffect(() => {
    if (!allowed || !studentId) return;
    let active = true;

    (async () => {
      await fetchDetail();
      if (!active) return;
    })();

    return () => {
      active = false;
    };
  }, [allowed, studentId, fetchDetail]);

  if (loading || (user && roleLoading)) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-muted">Yükleniyor...</p>
      </main>
    );
  }

  if (!user || !allowed) {
    return null;
  }

  return (
    <main className="flex min-h-dvh flex-col items-center px-6 py-16 sm:px-10">
      <div className="w-full max-w-2xl">
        <SectionTitle
          align="left"
          eyebrow="Öğretmen Paneli"
          title="Öğrenci Detayı"
          description="Öğrencinize ait bilgileri ve randevu geçmişini görüntüleyin."
        />

        <Card className="mt-6 sm:mt-8" padding="roomy" raised>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Bilgiler
            </h2>
            {state === "ready" && profile ? (
              <Badge tone={profile.is_active ? "gold" : "neutral"}>
                {profile.is_active ? "Aktif" : "Pasif"}
              </Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {state === "loading" ? (
              <p className="text-sm text-muted">Yükleniyor...</p>
            ) : state === "error" ? (
              <p
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
              >
                {errorMsg ?? "Öğrenci bilgileri yüklenemedi."}
              </p>
            ) : state === "not-found" ? (
              <p
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
              >
                Bu öğrenci size bağlı değil.
              </p>
            ) : profile ? (
              <ul className="divide-y divide-line">
                <li className="flex flex-col gap-0.5 py-3">
                  <span className="text-xs text-muted">Ad Soyad</span>
                  <span className="text-sm font-medium text-ink-text">
                    {profile.full_name?.trim() || "Belirtilmedi"}
                  </span>
                </li>
                <li className="flex flex-col gap-0.5 py-3">
                  <span className="text-xs text-muted">Telefon</span>
                  <span className="text-sm font-medium text-ink-text">
                    {profile.phone?.trim() || "Belirtilmedi"}
                  </span>
                </li>
                <li className="flex flex-col gap-0.5 py-3">
                  <span className="text-xs text-muted">Durum</span>
                  <Badge tone={profile.is_active ? "gold" : "neutral"}>
                    {profile.is_active ? "Aktif" : "Pasif"}
                  </Badge>
                </li>
              </ul>
            ) : null}
          </div>
        </Card>

        <Card className="mt-6" padding="roomy" raised>
          <h2 className="text-base font-semibold tracking-tight text-ink-text">
            Randevu Özeti
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted">Toplam Randevu</dt>
              <dd className="text-lg font-semibold text-ink-text">
                {appointments.length}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted">Tamamlanan</dt>
              <dd className="text-lg font-semibold text-ink-text">
                {appointments.filter((a) => a.status === "completed").length}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-gold/30 bg-gold-soft px-3 py-2.5">
              <dt className="text-xs text-muted">Bekleyen</dt>
              <dd className="text-lg font-semibold text-gold">
                {appointments.filter((a) => a.status === "pending").length}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted">İptal Edilen</dt>
              <dd className="text-lg font-semibold text-ink-text">
                {appointments.filter((a) => a.status === "cancelled").length}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="mt-6" padding="roomy" raised>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Randevular
            </h2>
            {state === "ready" ? (
              <Badge tone="neutral">{appointments.length} kayıt</Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {state === "loading" ? (
              <p className="text-sm text-muted">Yükleniyor...</p>
            ) : state === "ready" ? (
              appointments.length === 0 ? (
                <p className="text-sm leading-relaxed text-muted">
                  Henüz randevu bulunmuyor.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {appointments.map((appt) => {
                    const slot = appt.slot;
                    return (
                      <li
                        key={appt.id}
                        className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-ink-text">
                            {slot ? formatDate(slot.available_date) : "Tarih yok"}
                          </span>
                          <span className="text-xs text-muted">
                            {slot
                              ? `${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}`
                              : "Saat bilgisi yok"}
                          </span>
                          <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
                            <span>
                              <span className="text-muted/80">Ders: </span>
                              {appt.lesson?.trim() || "Belirtilmemiş"}
                            </span>
                            <span>
                              <span className="text-muted/80">Ders Konusu: </span>
                              {appt.subject?.trim() || "Belirtilmemiş"}
                            </span>
                            <span>
                              <span className="text-muted/80">Öğretmen Notu: </span>
                              {appt.notes?.trim() || "Belirtilmemiş"}
                            </span>
                            <span>
                              <span className="text-muted/80">Oluşturulma Tarihi: </span>
                              {appt.created_at ? formatDateTime(appt.created_at) : "Belirtilmemiş"}
                            </span>
                          </div>
                        </div>
                        <Badge tone="neutral">
                          {appt.status
                            ? (STATUS_LABEL[appt.status] ?? appt.status)
                            : "Durum yok"}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </div>
        </Card>
      </div>
    </main>
  );
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(value: string): string {
  return value.slice(0, 5);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
