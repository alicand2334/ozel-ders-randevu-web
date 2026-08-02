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
} from "@/lib/datetime";
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
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
  const endTime = timePartOfIso(appt.end_at) ?? null;

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
        .select("role")
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

    // Tercih edilen kaynak: public_teacher_profiles görünümü.
    // Çalışmıorsa (örn. görünüm yok) profiles tablosuna düş.
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

    // Görünüm mevcut değilse profiles tablosuna dön.
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

  return (
    <main className="flex min-h-dvh flex-col items-center px-6 py-16 sm:px-10">
      <div className="w-full max-w-2xl overflow-x-hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle
            align="left"
            eyebrow="Öğrenci Paneli"
            title="Öğretmenlerimiz"
            description="Randevu oluşturmak için bir öğretmenin profilini görüntüleyin."
          />
          <div ref={dropdownRef} className="relative w-full sm:w-auto">
            <button
              type="button"
              aria-label="Bildirimler"
              aria-expanded={isNotificationsOpen}
              aria-haspopup="true"
              onClick={() => setIsNotificationsOpen((p) => !p)}
              className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl border border-line bg-ink text-ink-text transition-colors duration-200 hover:border-line-strong focus:border-gold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-ink focus:ring-gold/60"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {unreadCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full border border-red-500/40 bg-red-500 px-1 text-[0.625rem] font-semibold leading-none text-white shadow-sm">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </button>

            {isNotificationsOpen ? (
              <div
                role="dialog"
                aria-label="Bildirimler"
                className="fixed left-4 right-4 top-20 z-50 sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[360px] sm:max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-ink-deep/40 backdrop-blur-sm"
              >
                <div className="flex items-center justify-between gap-3 border-b border-line bg-ink/60 px-4 py-3">
                  <h2 className="text-sm font-semibold tracking-tight text-ink-text">
                    Bildirimler
                  </h2>
                  {unreadCount > 0 ? (
                    <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-gold-soft px-2 py-0.5 text-xs font-semibold text-gold">
                      {unreadCount}
                    </span>
                  ) : null}
                </div>

                <div className="max-h-[60vh] overflow-y-auto sm:max-h-[420px]">
                  {notificationsLoading ? (
                    <p className="px-4 py-6 text-sm text-muted">
                      Bildirimler yükleniyor...
                    </p>
                  ) : notificationsError ? (
                    <p
                      role="alert"
                      className="px-4 py-4 text-sm text-red-300"
                    >
                      {notificationsError}
                    </p>
                  ) : notifications.length === 0 ? (
                    <p className="px-4 py-6 text-sm leading-relaxed text-muted">
                      Henüz bildiriminiz bulunmuyor.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {notifications.slice(0, 10).map((n) => (
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
                          className="flex cursor-pointer items-start gap-2.5 px-4 py-3 transition-colors duration-150 hover:bg-ink/40 focus:bg-ink/40 focus:outline-none"
                        >
                          <span
                            aria-hidden="true"
                            className={[
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              n.ok ? "bg-subtle" : "bg-gold",
                            ].join(" ")}
                          />
                          <div className="flex flex-1 flex-col gap-0.5">
                            <span className="text-sm font-medium text-ink-text">
                              {n.title?.trim() || "Bildirim"}
                            </span>
                            {n.body && n.body.trim() ? (
                              <span className="text-xs leading-relaxed text-muted">
                                {n.body.trim()}
                              </span>
                            ) : null}
                            <span className="text-xs text-subtle">
                              {formatNotificationDate(n.created_at)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <Card className="mt-6 sm:mt-8" padding="roomy" raised>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Öğretmenlerimiz
            </h2>
            {teachersState === "ready" ? (
              <Badge tone="neutral">{teachers.length} kayıt</Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {teachersState === "loading" ? (
              <p className="text-sm text-muted">Öğretmenler yükleniyor...</p>
            ) : teachersState === "error" ? (
              <div className="flex flex-col gap-3">
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  Öğretmenler yüklenemedi:{" "}
                  {teachersError ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton
                  onClick={handleTeachersRetry}
                  className="w-full sm:w-auto"
                >
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : teachers.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                Şu anda aktif öğretmen bulunmuyor.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {teachers.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-col gap-3 rounded-2xl border border-line bg-ink/40 p-4 transition-colors duration-200 hover:border-line-strong"
                  >
                    <div className="flex items-start gap-3">
                      <TeacherAvatar
                        name={t.full_name}
                        url={t.avatar_url}
                      />
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink-text">
                            {t.full_name?.trim() || "Öğretmen"}
                          </span>
                          <Badge tone="gold">Aktif</Badge>
                        </div>
                        <span className="text-xs text-muted">
                          {t.specialization?.trim() ||
                            "Branş belirtilmedi"}
                        </span>
                      </div>
                    </div>

                    {t.bio && t.bio.trim() ? (
                      <p className="text-xs leading-relaxed text-muted line-clamp-3">
                        {t.bio.trim()}
                      </p>
                    ) : null}

                    <div className="mt-auto">
                      <Link
                        href={`/panel/ogretmenler/${t.id}`}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-line bg-transparent px-3 py-2 text-xs font-semibold tracking-wide text-ink-text transition-colors duration-200 hover:bg-surface hover:border-line-strong active:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:ring-gold min-h-11 touch-manipulation select-none"
                        aria-label={`${t.full_name?.trim() || "Öğretmen"} profilini gör`}
                      >
                        Profili Gör
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="mt-5 sm:mt-6" padding="roomy" raised>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Bildirimler
            </h2>
            {!notificationsLoading && !notificationsError ? (
              <Badge tone="neutral">
                {notifications.slice(0, 5).length} kayıt
              </Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {notificationsLoading ? (
              <p className="text-sm text-muted">Bildirimler yükleniyor...</p>
            ) : notificationsError ? (
              <p
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
              >
                Bildirimler yüklenemedi: {notificationsError}
              </p>
            ) : notifications.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                Henüz bildiriminiz bulunmuyor.
              </p>
            ) : (
                <ul className="divide-y divide-line">
                  {notifications.slice(0, 5).map((n) => (
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
                      className="flex cursor-pointer flex-col gap-1 py-3 transition-colors duration-150 hover:bg-ink/40 focus:bg-ink/40 focus:outline-none"
                    >
                    <div className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className={[
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          n.ok ? "bg-subtle" : "bg-gold",
                        ].join(" ")}
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-ink-text">
                          {n.title?.trim() || "Bildirim"}
                        </span>
                        {n.body && n.body.trim() ? (
                          <span className="text-xs leading-relaxed text-muted">
                            {n.body.trim()}
                          </span>
                        ) : null}
                        <span className="text-xs text-subtle">
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

        <Card className="mt-5 sm:mt-6" padding="roomy" raised>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Randevularım
            </h2>
            {myApptState === "ready" ? (
              <Badge tone="neutral">{myAppointments.length} kayıt</Badge>
            ) : null}
          </div>

          {myApptActionError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
            >
              {myApptActionError}
            </p>
          ) : null}

          <div className="mt-5">
            {myApptState === "loading" ? (
              <p className="text-sm text-muted">Yükleniyor...</p>
            ) : myApptState === "error" ? (
              <div className="flex flex-col gap-3">
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  Randevular yüklenemedi: {myApptError ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton
                  onClick={handleMyApptRetry}
                  className="w-full sm:w-auto"
                >
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : myAppointments.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                Henüz bir randevunuz yok. Bir öğretmenin profilinden randevu
                oluşturduğunuzda burada listelenecek.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {myAppointments.map((appt) => {
                  const info = appointmentDisplayInfo(appt);
                  const isCancellable =
                    appt.status === "pending" || appt.status === "confirmed";
                  const isBusy = myApptActionId === appt.id;
                  return (
                    <li
                      key={appt.id}
                      className="flex flex-col gap-3 py-4"
                    >
                      <div className="flex flex-col gap-1">
                        {appt.lesson ? (
                          <span className="text-xs font-medium text-subtle">
                            Ders: {appt.lesson}
                          </span>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink-text">
                            {appt.subject?.trim() || "Konu belirtilmedi"}
                          </span>
                          <Badge tone="neutral">
                            {APPT_STATUS_LABEL[appt.status]}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted">
                          {(() => {
                            const date = info.date
                              ? formatDateLong(info.date)
                              : null;
                            const start = info.startTime
                              ? formatTime(info.startTime)
                              : null;
                            const end = info.endTime
                              ? formatTime(info.endTime)
                              : null;
                            const pieces: string[] = [];
                            if (date) pieces.push(date);
                            if (start && end) {
                              pieces.push(`${start} – ${end}`);
                            } else if (start) {
                              pieces.push(`${start} – ?`);
                            }
                            if (info.lessonCount) {
                              pieces.push(`${info.lessonCount} ders`);
                            }
                            if (info.totalDurationMinutes) {
                              pieces.push(
                                formatDuration(info.totalDurationMinutes),
                              );
                            }
                            return pieces.length > 0
                              ? pieces.join(" · ")
                              : "Randevu bilgisi eksik";
                          })()}
                        </span>
                        {appt.notes && appt.notes.trim() ? (
                          <span className="mt-1 text-xs leading-relaxed text-subtle">
                            Not: {appt.notes.trim()}
                          </span>
                        ) : null}
                      </div>

                      {isCancellable ? (
                        <SecondaryButton
                          onClick={() => cancelAppointment(appt)}
                          disabled={isBusy}
                          className="w-full sm:w-auto"
                        >
                          {isBusy ? "İptal Ediliyor..." : "İptal Et"}
                        </SecondaryButton>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <PrimaryButton onClick={handleSignOut} className="w-full sm:w-auto">
            Çıkış Yap
          </PrimaryButton>
          <SecondaryButton
            onClick={() => router.push("/")}
            className="w-full sm:w-auto"
          >
            Ana Sayfa
          </SecondaryButton>
        </div>
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
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line object-cover"
        unoptimized
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-ink text-base font-semibold text-gold"
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
  if (error.code === "23505") {
    return "Bu işlem çakışma nedeniyle yapılamadı. Lütfen listeyi yenileyip tekrar deneyin.";
  }
  return error.message ?? "Randevu iptal edilemedi. Lütfen tekrar deneyin.";
}
