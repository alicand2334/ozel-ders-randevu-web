"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  formatDateLong,
  formatDuration,
  formatNotificationDate,
  formatTime,
  timePartOfIso,
  addMinutesToTime,
} from "@/lib/datetime";
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";

type TeacherCardRow = {
  id: string;
  full_name: string | null;
  specialization: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
};

type TeachersFetchState = "loading" | "ready" | "error";

type FetchState = "loading" | "ready" | "error";

type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "completed";

type NotificationRow = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  ok: boolean;
  appointment_id: string;
  created_at: string;
};

type AppointmentRow = {
  id: string;
  status: AppointmentStatus;
  lesson: string | null;
  subject: string | null;
  notes: string | null;
  teacher_id: string;
  created_at: string;
  requested_start_time: string | null;
  start_at: string | null;
  end_at: string | null;
  lesson_count: number | null;
  lesson_duration_minutes: number | null;
  break_duration_minutes: number | null;
  availability: {
    available_date: string;
  } | null;
};

const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: "Beklemede",
  confirmed: "Onaylandı",
  cancelled: "İptal Edildi",
  completed: "Tamamlandı",
};

function appointmentDisplayInfo(appt: AppointmentRow): {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  lessonCount: number | null;
  totalDurationMinutes: number | null;
} {
  const availableDate = appt.availability?.available_date ?? null;

  const startTime =
    appt.requested_start_time ?? timePartOfIso(appt.start_at) ?? null;

  const lessonCount =
    appt.lesson_count !== null && appt.lesson_count > 0
      ? appt.lesson_count
      : null;

  let totalDurationMinutes: number | null = null;
  if (
    lessonCount !== null &&
    appt.lesson_duration_minutes !== null &&
    appt.lesson_duration_minutes > 0 &&
    appt.break_duration_minutes !== null &&
    appt.break_duration_minutes >= 0
  ) {
    totalDurationMinutes =
      lessonCount * appt.lesson_duration_minutes +
      (lessonCount - 1) * appt.break_duration_minutes;
  }

  let endTime: string | null = null;
  if (startTime && totalDurationMinutes !== null && totalDurationMinutes > 0) {
    endTime = addMinutesToTime(startTime, totalDurationMinutes);
  } else {
    endTime = timePartOfIso(appt.end_at) ?? null;
  }

  return {
    date: availableDate,
    startTime,
    endTime,
    lessonCount,
    totalDurationMinutes,
  };
}

export default function PanelPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [roleLoading, setRoleLoading] = useState(true);

  const [myAppointments, setMyAppointments] = useState<AppointmentRow[]>([]);
  const [myApptState, setMyApptState] = useState<FetchState>("loading");
  const [myApptError, setMyApptError] = useState<string | null>(null);
  const [myApptActionId, setMyApptActionId] = useState<string | null>(null);
  const [myApptActionError, setMyApptActionError] = useState<string | null>(
    null,
  );

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationsLoading, setNotificationsLoading] =
    useState<boolean>(true);
  const [notificationsError, setNotificationsError] = useState<string | null>(
    null,
  );

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const [teachers, setTeachers] = useState<TeacherCardRow[]>([]);
  const [teachersState, setTeachersState] =
    useState<TeachersFetchState>("loading");
  const [teachersError, setTeachersError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNotificationsOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsNotificationsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isNotificationsOpen]);

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
        .select("role, is_active")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setRoleLoading(false);
        return;
      }

      if (data?.role === "teacher") {
        router.replace("/panel/ogretmen");
        return;
      }

      if (data?.role === "admin") {
        router.replace("/panel/admin");
        return;
      }

      if (data?.role === "student") {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token ?? null;
          if (accessToken) {
            const guardRes = await fetch("/api/auth/student-guard", {
              method: "GET",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (guardRes.status === 403) {
              const payload: { inactive?: boolean } = await guardRes.json();
              if (payload.inactive === true) {
                await supabase.auth.signOut();
                router.replace("/giris");
                return;
              }
            }
          }
        } catch {
        }
      }

      setRoleLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loading, user, router]);

  const fetchTeachers = useCallback(async () => {
    setTeachersState("loading");
    setTeachersError(null);

    const selectColumns =
      "id, full_name, specialization, bio, avatar_url, is_active";

    const { data: viewData, error: viewError } = await supabase
      .from("public_teacher_profiles")
      .select(selectColumns)
      .eq("is_active", true)
      .order("full_name", { ascending: true });

    if (!viewError) {
      setTeachers((viewData ?? []) as TeacherCardRow[]);
      setTeachersState("ready");
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select(selectColumns)
      .eq("role", "teacher")
      .eq("is_active", true)
      .order("full_name", { ascending: true });

    if (profileError) {
      setTeachersError(profileError.message);
      setTeachersState("error");
      return;
    }

    setTeachers((profileData ?? []) as TeacherCardRow[]);
    setTeachersState("ready");
  }, []);

  const fetchMyAppointments = useCallback(async (uid: string) => {
    setMyApptState("loading");
    setMyApptError(null);
    const { data, error } = await supabase
      .from("appointments")
      .select(
        "id, status, lesson, subject, notes, teacher_id, created_at, requested_start_time, start_at, end_at, lesson_count, lesson_duration_minutes, break_duration_minutes, availability(available_date)",
      )
      .eq("student_id", uid)
      .order("created_at", { ascending: false });
    if (error) {
      setMyApptError(error.message);
      setMyApptState("error");
      return;
    }
    setMyAppointments((data ?? []) as unknown as AppointmentRow[]);
    setMyApptState("ready");
  }, []);

  const fetchNotifications = useCallback(async (uid: string) => {
    setNotificationsLoading(true);
    setNotificationsError(null);
    const { data, error } = await supabase
      .from("notifications")
      .select(
        "id, type, title, body, ok, appointment_id, created_at",
      )
      .eq("recipient_id", uid)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      setNotificationsError(error.message);
      setNotificationsLoading(false);
      return;
    }
    setNotifications((data ?? []) as unknown as NotificationRow[]);
    setNotificationsLoading(false);
  }, []);

  useEffect(() => {
    if (!user || roleLoading === true) {
      return;
    }

    (async () => {
      await Promise.all([
        fetchTeachers(),
        fetchMyAppointments(user.id),
        fetchNotifications(user.id),
      ]);
    })();
  }, [user, roleLoading, fetchMyAppointments, fetchNotifications, fetchTeachers]);

  useEffect(() => {
    if (!user || roleLoading === true) {
      return;
    }
    const uid = user.id;

    const channel = supabase
      .channel("student-panel-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `student_id=eq.${uid}`,
        },
        () => {
          void fetchMyAppointments(uid);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, roleLoading, fetchMyAppointments]);

  useEffect(() => {
    if (!user || roleLoading === true) {
      return;
    }
    const uid = user.id;

    const channel = supabase
      .channel("student-notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${uid}`,
        },
        (payload) => {
          const row = payload.new as unknown as NotificationRow;
          setNotifications((prev) => {
            if (prev.some((n) => n.id === row.id)) return prev;
            return [row, ...prev];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${uid}`,
        },
        (payload) => {
          const row = payload.new as unknown as NotificationRow;
          setNotifications((prev) =>
            prev.map((n) => (n.id === row.id ? row : n)),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, roleLoading]);

  if (loading || (user && roleLoading)) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-muted">Yükleniyor...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/giris");
  }

  async function handleMyApptRetry() {
    if (!user) return;
    await fetchMyAppointments(user.id);
  }

  async function handleTeachersRetry() {
    await fetchTeachers();
  }

  async function cancelAppointment(appt: AppointmentRow) {
    if (!user) return;
    setMyApptActionId(appt.id);
    setMyApptActionError(null);

    const { error } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", appt.id);

    setMyApptActionId(null);

    if (error) {
      setMyApptActionError(translateCancelError(error));
      return;
    }

    // Send push notification to teacher (fire and forget)
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    
    if (accessToken) {
      fetch("/api/push/appointment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          appointmentId: appt.id,
          type: "booking_cancelled_by_student",
        }),
      }).catch((err) => {
        console.error("[Push] Failed to send appointment cancellation notification:", err);
      });
    }

    await fetchMyAppointments(user.id);
  }

  const unreadCount = notifications.filter((n) => n.ok === false).length;

  async function markNotificationRead(id: string) {
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      if (!target || target.ok) return prev;
      return prev.map((n) => (n.id === id ? { ...n, ok: true } : n));
    });

    const { error } = await supabase
      .from("notifications")
      .update({ ok: true })
      .eq("id", id);

    if (error) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ok: false } : n)),
      );
    }
  }

  const handleGoBack = () => {
    router.push("/ogrenci");
  };

  const formatDate = (isoDate: string) => {
    const [year, month, day] = isoDate.split("-");
    return `${day}.${month}.${year}`;
  };

  const formatCreatedAt = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getApptStatusBadgeStyle = (status: AppointmentStatus) => {
    switch (status) {
      case "completed":
        return "bg-green-500/20 text-green-400 border border-green-500/30";
      case "cancelled":
        return "bg-red-500/20 text-red-400 border border-red-500/30";
      case "confirmed":
        return "bg-blue-500/20 text-blue-400 border border-blue-500/30";
      default:
        return "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30";
    }
  };

  return (
    <main className="flex min-h-dvh flex-col px-6 py-8 sm:px-10">
      <div className="w-full max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-foreground">Randevu Sistemi</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end gap-3">
            <SecondaryButton onClick={handleGoBack} className="w-full sm:w-auto">
              Ana Menüye Dön
            </SecondaryButton>
            <PrimaryButton
              onClick={handleSignOut}
              className="w-full sm:w-auto bg-red-600 hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500 text-white"
            >
              Çıkış Yap
            </PrimaryButton>
          </div>
        </div>

        {/* ÖĞRETMENLER */}
        <Card className="overflow-hidden" padding="snug">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Öğretmenler</h2>
            {teachersState === "ready" && (
              <Badge tone="neutral">{teachers.length} kayıt</Badge>
            )}
          </div>

          <div className="mt-5">
            {teachersState === "loading" ? (
              <p className="text-sm text-muted text-center py-8">Öğretmenler yükleniyor...</p>
            ) : teachersState === "error" ? (
              <div className="flex flex-col gap-3 text-center py-4">
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  Öğretmenler yüklenemedi: {teachersError ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton onClick={handleTeachersRetry} className="w-full sm:w-auto mx-auto">
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : teachers.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted text-center py-8">
                Şu anda aktif öğretmen bulunmuyor.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {teachers.map((t) => (
                  <li key={t.id} className="flex flex-col gap-4 p-4 sm:p-5 rounded-2xl border border-border bg-card transition-colors duration-200 hover:border-yellow-500/50">
                    <div className="flex items-start gap-4">
                      <TeacherAvatar name={t.full_name} url={t.avatar_url} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-foreground truncate">
                            {t.full_name?.trim() || "Öğretmen"}
                          </span>
                          <Badge tone="gold">Aktif</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t.specialization?.trim() || "Branş belirtilmedi"}
                        </p>
                        {t.bio && t.bio.trim() && (
                          <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                            {t.bio.trim()}
                          </p>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/panel/ogretmenler/${t.id}`}
                      className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-200 bg-yellow-500 hover:bg-yellow-600 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      Profili Gör
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* BİLDİRİMLER */}
        <Card className="overflow-hidden" padding="snug">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Bildirimler</h2>
            {!notificationsLoading && !notificationsError && (
              <Badge tone="neutral">{notifications.length} kayıt</Badge>
            )}
          </div>

          <div className="mt-5">
            {notificationsLoading ? (
              <p className="text-sm text-muted text-center py-8">Bildirimler yükleniyor...</p>
            ) : notificationsError ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                Bildirimler yüklenemedi: {notificationsError}
              </p>
            ) : notifications.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted text-center py-8">
                Henüz bildiriminiz bulunmuyor.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!n.ok) void markNotificationRead(n.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (!n.ok) void markNotificationRead(n.id);
                      }
                    }}
                    className="py-4 transition-colors duration-150 hover:bg-ink/40 focus:bg-ink/40 focus:outline-none"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={[
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          n.ok ? "bg-subtle" : "bg-yellow-500",
                        ].join(" ")}
                      />
                      <div className="flex-1 flex-col gap-1">
                        <span className="text-sm font-medium text-foreground">
                          {n.title?.trim() || "Bildirim"}
                        </span>
                        {n.body && n.body.trim() ? (
                          <span className="text-sm text-muted-foreground">
                            {n.body.trim()}
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {formatNotificationDate(n.created_at)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* RANDEVULARIM */}
        <Card className="overflow-hidden" padding="snug">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Randevularım</h2>
            {myApptState === "ready" && (
              <Badge tone="neutral">{myAppointments.length} kayıt</Badge>
            )}
          </div>

          {myApptActionError && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {myApptActionError}
            </div>
          )}

          <div className="mt-5">
            {myApptState === "loading" ? (
              <p className="text-sm text-muted text-center py-8">Yükleniyor...</p>
            ) : myApptState === "error" ? (
              <div className="flex flex-col gap-3 text-center py-4">
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  Randevular yüklenemedi: {myApptError ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton onClick={handleMyApptRetry} className="w-full sm:w-auto mx-auto">
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : myAppointments.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted text-center py-8">
                Henüz bir randevunuz yok. Bir öğretmenin profilinden randevu
                oluşturduğunuzda burada listelenecek.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {myAppointments.map((appt) => {
                  const info = appointmentDisplayInfo(appt);
                  const isCancellable =
                    appt.status === "pending" || appt.status === "confirmed";
                  const isBusy = myApptActionId === appt.id;

                  return (
                    <li key={appt.id} className="py-5 relative">
                      <span
                        className={`absolute top-5 right-5 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium border ${getApptStatusBadgeStyle(appt.status)}`}
                      >
                        {APPT_STATUS_LABEL[appt.status]}
                      </span>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between pr-40 sm:pr-0">
                        <div className="flex-1 min-w-0">
                          {appt.lesson && (
                            <span className="text-xs font-medium text-muted-foreground">
                              Ders: {appt.lesson}
                            </span>
                          )}
                          <h3 className="mt-1 text-lg font-bold text-foreground">
                            {appt.subject?.trim() || "Konu belirtilmedi"}
                          </h3>
                          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">Tarih:</span>
                              <span>
                                {info.date ? formatDateLong(info.date) : "Belirtilmemiş"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">Saat:</span>
                              <span>
                                {info.startTime && info.endTime
                                  ? `${formatTime(info.startTime)} – ${formatTime(info.endTime)}`
                                  : info.startTime
                                  ? `${formatTime(info.startTime)} – ?`
                                  : "Belirtilmemiş"}
                              </span>
                            </div>
                            {info.lessonCount && (
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">Ders Sayısı:</span>
                                <span>{info.lessonCount} ders</span>
                              </div>
                            )}
                            {info.totalDurationMinutes && (
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">Toplam Süre:</span>
                                <span>{formatDuration(info.totalDurationMinutes)}</span>
                              </div>
                            )}
                          </div>
                          {appt.notes && appt.notes.trim() && (
                            <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                              <span className="font-medium text-foreground mt-0.5">Not:</span>
                              <span className="text-muted-foreground">{appt.notes.trim()}</span>
                            </div>
                          )}
                        </div>

                        {isCancellable && (
                          <SecondaryButton
                            onClick={() => cancelAppointment(appt)}
                            disabled={isBusy}
                            className="mt-4 shrink-0 w-full sm:w-auto"
                          >
                            {isBusy ? "İptal Ediliyor..." : "İptal Et"}
                          </SecondaryButton>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function TeacherAvatar({
  name,
  url,
}: {
  name: string | null;
  url: string | null;
}) {
  if (url) {
    return (
      <Image
        src={url}
        alt={name?.trim() ? name.trim() : "Öğretmen"}
        width={48}
        height={48}
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border object-cover"
        unoptimized
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-base font-semibold text-black"
    >
      {initialsOf(name)}
    </span>
  );
}

function translateCancelError(error: {
  code?: string;
  message?: string;
}): string {
  if (error.code === "P0003") {
    return "Bu randevu iptal edilemez. Yalnızca beklemede veya onaylanmış randevuları iptal edebilirsiniz.";
  }
  if (error.code === "42501") {
    return "Bu randevuyu iptal etme yetkiniz yok.";
  }
  if (error.code === "23503") {
    return "Bu işlem çakışma nedeniyle yapılamadı. Lütfen listeyi yenileyip tekrar deneyin.";
  }
  return error.message ?? "Randevu iptal edilemedi. Lütfen tekrar deneyin.";
}