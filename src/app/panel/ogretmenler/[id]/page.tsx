"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  addMinutesToTime,
  formatDateLongNoWeekday,
  formatDurationLabel,
  formatTime,
  formatWeekday,
  isTodayKey,
  istanbulNowMinutes,
  istanbulTodayKey,
  minutesToTime,
  timeToMinutes,
} from "@/lib/datetime";
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
} from "@/components/ui";

type TeacherProfile = {
  id: string;
  full_name: string | null;
  specialization: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
  lesson_duration_minutes: number;
  lesson_break_minutes: number;
  student_buffer_minutes: number;
};

type ProfileView = "loading" | "ready" | "not-found" | "error";

type AvailabilityRow = {
  id: string;
  available_date: string;
  start_time: string;
  end_time: string;
  status: string;
};

type SlotsView = "idle" | "loading" | "ready" | "error" | "empty";

const MIN_LESSON_COUNT = 1;
const MAX_LESSON_COUNT = 30;

const LESSON_COUNT_OPTIONS = Array.from(
  { length: MAX_LESSON_COUNT - MIN_LESSON_COUNT + 1 },
  (_, i) => i + MIN_LESSON_COUNT,
);

const START_TIME_STEP_MIN = 15;

const LESSON_OPTIONS = [
  "Matematik",
  "Türkçe",
  "Fen Bilimleri",
  "İngilizce",
  "Fizik",
  "Kimya",
  "Edebiyat",
  "Biyoloji",
  "Geometri",
  "Tarih",
  "Coğrafya",
  "Koçluk Sistemi",
] as const;

const EMPTY_BOOKING_FORM = { lesson: "", subject: "", lessonMode: "" };

const LESSON_MODE_OPTIONS = [
  { value: "online", label: "Online" },
  { value: "in_person", label: "Yüz Yüze" },
] as const;

export type LessonModeValue = (typeof LESSON_MODE_OPTIONS)[number]["value"];

function lessonModeLabel(mode: string | null | undefined): string {
  if (mode === "online") return "Online";
  if (mode === "in_person") return "Yüz Yüze";
  return "Belirtilmedi";
}

export default function TeacherProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const teacherId = typeof params?.id === "string" ? params.id : "";

  const { user, loading } = useAuth();
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [view, setView] = useState<ProfileView>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [slots, setSlots] = useState<AvailabilityRow[]>([]);
  const [slotsView, setSlotsView] = useState<SlotsView>("idle");
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsShown, setSlotsShown] = useState(false);

  const [lessonCount, setLessonCount] = useState<number>(MIN_LESSON_COUNT);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [requestedStartTime, setRequestedStartTime] = useState<string | null>(null);

  const [bookingForm, setBookingForm] = useState(EMPTY_BOOKING_FORM);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null);
  const [bookedSlotId, setBookedSlotId] = useState<string | null>(null);

  // Auto-dismiss bookingSuccess after 5 seconds
  useEffect(() => {
    if (!bookingSuccess) return;
    const id = window.setTimeout(() => setBookingSuccess(null), 5000);
    return () => {
      window.clearTimeout(id);
    };
  }, [bookingSuccess]);

  // Auto-dismiss bookingError after 5 seconds
  useEffect(() => {
    if (!bookingError) return;
    const id = window.setTimeout(() => setBookingError(null), 5000);
    return () => {
      window.clearTimeout(id);
    };
  }, [bookingError]);

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
        setAuthChecked(true);
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

      setAllowed(true);
      setAuthChecked(true);
    })();

    return () => {
      active = false;
    };
  }, [loading, user, router]);

  const fetchProfile = useCallback(async () => {
    if (!teacherId) {
      setView("not-found");
      return;
    }

    setView("loading");
    setErrorMsg(null);

    const { data, error } = await supabase
      .from("public_teacher_profiles")
      .select(
        "id, full_name, specialization, bio, avatar_url, is_active, lesson_duration_minutes, lesson_break_minutes, student_buffer_minutes",
      )
      .eq("id", teacherId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      setErrorMsg(translateProfileError(error));
      setView("error");
      return;
    }

    if (!data) {
      setProfile(null);
      setView("not-found");
      return;
    }

    setProfile(data as TeacherProfile);
    setView("ready");
  }, [teacherId]);

  useEffect(() => {
    if (!allowed || !teacherId) {
      return;
    }
    let active = true;

    (async () => {
      await fetchProfile();
      if (!active) return;
    })();

    return () => {
      active = false;
    };
  }, [allowed, teacherId, fetchProfile]);

  const fetchSlots = useCallback(async () => {
    if (!teacherId) {
      return;
    }

    setSlotsView("loading");
    setSlotsError(null);
    setSelectedSlotId(null);
    setRequestedStartTime(null);

    let accessToken: string | null = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      accessToken = sessionData.session?.access_token ?? null;
    } catch {
      accessToken = null;
    }

    if (!accessToken) {
      setSlotsError(
        "Müsaitlik bilgilerini görmek için oturumunuz gerekli. Lütfen tekrar giriş yapın.",
      );
      setSlotsView("error");
      return;
    }

    let res: Response;
    try {
      res = await fetch(
        `/api/teacher/${encodeURIComponent(teacherId)}/effective-availability`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
    } catch {
      setSlotsError(
        "Müsaitlikler yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.",
      );
      setSlotsView("error");
      return;
    }

    if (res.status === 401) {
      setSlotsError(
        "Müsaitlik bilgilerini görmek için oturumunuz gerekli. Lütfen tekrar giriş yapın.",
      );
      setSlotsView("error");
      return;
    }
    if (res.status === 403) {
      setSlotsError(
        "Müsaitlik bilgilerini görmek için yetkiniz yok.",
      );
      setSlotsView("error");
      return;
    }

    let payload: { slots?: AvailabilityRow[]; error?: string } | null = null;
    try {
      payload = (await res.json()) as {
        slots?: AvailabilityRow[];
        error?: string;
      } | null;
    } catch {
      payload = null;
    }

    if (!res.ok || !payload || !Array.isArray(payload.slots)) {
      setSlotsError(
        payload?.error ?? "Müsaitlikler yüklenemedi. Lütfen tekrar deneyin.",
      );
      setSlotsView("error");
      return;
    }

    const todayStr = istanbulTodayKey();
    const nowMinutes = istanbulNowMinutes();

    const upcoming = (payload.slots as AvailabilityRow[])
      .filter((row) => {
        if (row.available_date > todayStr) return true;
        if (row.available_date < todayStr) return false;
        return (timeToMinutes(row.start_time) ?? 0) >= nowMinutes;
      })
      .sort((a, b) => {
        const dateCmp = a.available_date.localeCompare(b.available_date);
        if (dateCmp !== 0) return dateCmp;
        return a.start_time.localeCompare(b.start_time);
      });

    setSlots(upcoming);
    setSlotsView(upcoming.length === 0 ? "empty" : "ready");
  }, [teacherId]);

  function handleShowSlots() {
    setSlotsShown(true);
    if (slotsView === "idle") {
      void fetchSlots();
    }
  }

  async function handleCreateBooking() {
    if (!user || !selectedSlotId || !requestedStartTime) return;
    const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null;
    if (!selectedSlot) return;

    const lesson = bookingForm.lesson.trim();
    const subject = bookingForm.subject.trim();
    const lessonMode = bookingForm.lessonMode.trim();
    if (!lesson) {
      setBookingError("Lütfen bir ders seçin.");
      return;
    }
    if (!subject) {
      setBookingError("Lütfen ders konusunu girin.");
      return;
    }
    if (lessonMode !== "online" && lessonMode !== "in_person") {
      setBookingError("Lütfen ders türünü seçin (Online veya Yüz Yüze).");
      return;
    }
    if (
      !Number.isInteger(lessonCount) ||
      lessonCount < MIN_LESSON_COUNT ||
      lessonCount > MAX_LESSON_COUNT
    ) {
      setBookingError("Ders sayısı 1 ile 30 arasında olmalıdır.");
      return;
    }
    if (!teacherSettings) {
      setBookingError("Öğretmen ayarları yüklenemedi. Lütfen sayfayı yenileyin.");
      return;
    }
    if (!availableStartTimes.includes(requestedStartTime)) {
      setBookingError("Seçilen başlangıç saati bu ders sayısı için uygun değil.");
      return;
    }

    setBookingSubmitting(true);
    setBookingError(null);
    setBookingSuccess(null);

    const { data: insertedAppointment, error } = await supabase
      .from("appointments")
      .insert({
        slot_id: selectedSlot.id,
        student_id: user.id,
        lesson,
        subject,
        lesson_count: lessonCount,
        requested_start_time: requestedStartTime,
        lesson_mode: lessonMode,
        notes: null,
      })
      .select("id")
      .single();

    setBookingSubmitting(false);

    if (error || !insertedAppointment) {
      setBookingError(error?.message ?? "Randevu oluşturulamadı. Lütfen tekrar deneyin.");
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
          appointmentId: insertedAppointment.id,
          type: "booking_created",
        }),
      }).catch((err) => {
        console.error("[Push] Failed to send appointment notification:", err);
      });
    }

    setBookedSlotId(selectedSlot.id);
    setSelectedSlotId(null);
    setRequestedStartTime(null);
    setBookingForm(EMPTY_BOOKING_FORM);
    setBookingSuccess("Randevu başarıyla oluşturuldu.");
    void fetchSlots();
  }

  if (loading || (user && !authChecked)) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-muted">Yükleniyor...</p>
      </main>
    );
  }

  if (!user || !allowed) {
    return null;
  }

  const teacherSettings: TeacherSettings | null = profile
    ? {
        lesson_duration_minutes: profile.lesson_duration_minutes,
        lesson_break_minutes: profile.lesson_break_minutes,
        student_buffer_minutes: profile.student_buffer_minutes,
      }
    : null;

  const totalsForCount =
    teacherSettings && lessonCount
      ? totalDurationMinutes(lessonCount, teacherSettings)
      : 0;

  const selectedSlot =
    slots.find((s) => s.id === selectedSlotId) ?? null;

  const availableStartTimes: string[] =
    selectedSlot && teacherSettings
      ? generateStartTimes(selectedSlot, lessonCount, teacherSettings)
      : [];

  const handleGoBackToTeachers = () => {
    router.push("/panel");
  };

  const handleGoHome = () => {
    router.push("/panel");
  };

  return (
    <main className="flex min-h-dvh flex-col px-6 py-8 sm:px-10">
      <div className="w-full max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-foreground">Öğretmen Profili</h1>
            <p className="mt-1 text-muted-foreground">Seçtiğiniz öğretmenin bilgilerini burada görüntüleyebilirsiniz.</p>
          </div>
        </div>

        <Card className="overflow-hidden" padding="snug">
          {view === "loading" ? (
            <p className="text-sm text-muted text-center py-8">Öğretmen bilgileri yükleniyor...</p>
          ) : view === "error" ? (
            <div className="flex flex-col gap-3 text-center py-4">
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {errorMsg ?? "Profil bilgileri yüklenemedi."}
              </p>
              <SecondaryButton onClick={() => void fetchProfile()} className="w-full sm:w-auto mx-auto">
                Tekrar Dene
              </SecondaryButton>
            </div>
          ) : view === "not-found" ? (
            <div className="flex flex-col gap-3 text-center py-4">
              <p className="text-sm leading-relaxed text-muted">
                Aradığınız öğretmen bulunamadı veya artık aktif değil.
              </p>
              <SecondaryButton onClick={handleGoBackToTeachers} className="w-full sm:w-auto mx-auto">
                Öğretmenlere Dön
              </SecondaryButton>
            </div>
          ) : profile ? (
            <ProfileDetail
              profile={profile}
              slotsShown={slotsShown}
              onShowSlots={handleShowSlots}
            />
          ) : null}
        </Card>

        {profile && slotsShown ? (
          <AvailabilityPanel
            slots={slots}
            slotsView={slotsView}
            slotsError={slotsError}
            lessonCount={lessonCount}
            selectedSlotId={selectedSlotId}
            requestedStartTime={requestedStartTime}
            availableStartTimes={availableStartTimes}
            teacherSettings={teacherSettings}
            totalsForCount={totalsForCount}
            bookedSlotId={bookedSlotId}
            onLessonChange={(value) => {
              setLessonCount(value);
              setRequestedStartTime(null);
              setBookingError(null);
            }}
            onSelectSlot={(id) => {
              setSelectedSlotId(id);
              setRequestedStartTime(null);
              setBookingError(null);
              setBookingSuccess(null);
            }}
            onSelectStartTime={(time) => {
              setRequestedStartTime(time);
              setBookingError(null);
              setBookingSuccess(null);
            }}
            onRetry={() => void fetchSlots()}
          />
        ) : null}

        {profile && slotsShown && (slotsView === "ready" || slotsView === "empty") ? (
          <BookingFormCard
            bookingForm={bookingForm}
            bookingSubmitting={bookingSubmitting}
            bookingError={bookingError}
            bookingSuccess={bookingSuccess}
            selectedSlotId={selectedSlotId}
            requestedStartTime={requestedStartTime}
            lessonCount={lessonCount}
            onLessonChange={(e) => {
              setBookingForm((p) => ({ ...p, lesson: e.target.value }));
              setBookingError(null);
              setBookingSuccess(null);
            }}
            onSubjectChange={(e) => {
              setBookingForm((p) => ({ ...p, subject: e.target.value }));
              setBookingError(null);
              setBookingSuccess(null);
            }}
            onLessonModeChange={(e) => {
              setBookingForm((p) => ({ ...p, lessonMode: e.target.value }));
              setBookingError(null);
              setBookingSuccess(null);
            }}
            onSubmit={() => void handleCreateBooking()}
            disabled={
              bookingSubmitting ||
              !selectedSlotId ||
              !requestedStartTime ||
              !bookingForm.lesson ||
              !bookingForm.subject.trim() ||
              (bookingForm.lessonMode !== "online" && bookingForm.lessonMode !== "in_person")
            }
          />
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row justify-end">
          <SecondaryButton onClick={handleGoHome} className="w-full sm:w-auto">
            Ana Sayfa
          </SecondaryButton>
        </div>
      </div>
    </main>
  );
}

function ProfileDetail({
  profile,
  slotsShown,
  onShowSlots,
}: {
  profile: TeacherProfile;
  slotsShown: boolean;
  onShowSlots: () => void;
}) {
  const fullName = profile.full_name?.trim() || "Öğretmen";
  const specialization = profile.specialization?.trim() || "Branş belirtilmedi";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <TeacherAvatar name={profile.full_name} url={profile.avatar_url} />
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground truncate">{fullName}</h2>
            <Badge tone="gold">Aktif</Badge>
          </div>
          <p className="text-base text-muted-foreground">{specialization}</p>
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Hakkında</h3>
        <p className="mt-2 text-base leading-relaxed text-foreground">
          {profile.bio?.trim() || "Bu öğretmen henüz bir biyografi eklememiş."}
        </p>
      </div>

      <div className="border-t border-border pt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <PrimaryButton
          onClick={onShowSlots}
          disabled={slotsShown}
          className="w-full sm:w-auto"
        >
          {slotsShown ? "Müsaitlikler Görüntüleniyor" : "Uygun Saatleri Gör"}
        </PrimaryButton>
        <p className="text-sm text-muted-foreground">
          Ders sayısını seçip uygun bir başlangıç saati belirleyin.
        </p>
      </div>
    </div>
  );
}

function AvailabilityPanel({
  slots,
  slotsView,
  slotsError,
  lessonCount,
  selectedSlotId,
  requestedStartTime,
  availableStartTimes,
  teacherSettings,
  totalsForCount,
  bookedSlotId,
  onLessonChange,
  onSelectSlot,
  onSelectStartTime,
  onRetry,
}: {
  slots: AvailabilityRow[];
  slotsView: SlotsView;
  slotsError: string | null;
  lessonCount: number;
  selectedSlotId: string | null;
  requestedStartTime: string | null;
  availableStartTimes: string[];
  teacherSettings: TeacherSettings | null;
  totalsForCount: number;
  bookedSlotId: string | null;
  onLessonChange: (value: number) => void;
  onSelectSlot: (id: string | null) => void;
  onSelectStartTime: (time: string | null) => void;
  onRetry: () => void;
}) {
  const totalsLabel = formatDurationLabel(totalsForCount);

  return (
    <Card className="overflow-hidden" padding="snug">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Müsait Saatler</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {teacherSettings
              ? `Her ders ${teacherSettings.lesson_duration_minutes} dk, dersler arası ${teacherSettings.lesson_break_minutes} dk moladır.`
              : "Öğretmen ders süresi ayarları yükleniyor..."}
          </p>
        </div>
        {(slotsView === "ready" || slotsView === "empty") && (
          <Badge tone="neutral">{slots.length} kayıt</Badge>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-5">
        <div className="flex flex-col gap-3 w-full sm:max-w-xs">
          <label htmlFor="lesson-count" className="text-sm font-medium text-foreground">
            Ders Sayısı
          </label>
          <select
            id="lesson-count"
            value={lessonCount}
            onChange={(e) => onLessonChange(Number(e.target.value))}
            disabled={!teacherSettings}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 touch-manipulation disabled:opacity-60"
          >
            {LESSON_COUNT_OPTIONS.map((n) => (
              <option
                key={n}
                value={n}
                style={{
                  backgroundColor: "#1a1a1a",
                  color: "#ffffff",
                }}
              >
                {n} ders · {teacherSettings ? formatDurationLabel(totalDurationMinutes(n, teacherSettings)) : "—"}
              </option>
            ))}
          </select>
          <p className="text-sm text-muted-foreground">
            Seçilen dersler için toplam süre: {totalsLabel}.
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-5">
        {slotsView === "loading" ? (
          <p className="text-sm text-muted text-center py-8">Müsaitlikler yükleniyor...</p>
        ) : slotsView === "error" ? (
          <div className="flex flex-col gap-3 text-center py-4">
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {slotsError ?? "Müsaitlikler yüklenemedi."}
            </p>
            <SecondaryButton onClick={onRetry} className="w-full sm:w-auto mx-auto">
              Tekrar Dene
            </SecondaryButton>
          </div>
        ) : slotsView === "empty" ? (
          <p className="text-sm leading-relaxed text-muted text-center py-8">
            Bu öğretmenin için şu anda açık müsait saat bulunmuyor.
          </p>
        ) : (
          <SlotsList
            slots={slots}
            selectedSlotId={selectedSlotId}
            requestedStartTime={requestedStartTime}
            availableStartTimes={availableStartTimes}
            teacherSettings={teacherSettings}
            lessonCount={lessonCount}
            totalsForCount={totalsForCount}
            bookedSlotId={bookedSlotId}
            onSelectSlot={onSelectSlot}
            onSelectStartTime={onSelectStartTime}
          />
        )}
      </div>
    </Card>
  );
}

function SlotsList({
  slots,
  selectedSlotId,
  requestedStartTime,
  availableStartTimes,
  teacherSettings,
  lessonCount,
  totalsForCount,
  bookedSlotId,
  onSelectSlot,
  onSelectStartTime,
}: {
  slots: AvailabilityRow[];
  selectedSlotId: string | null;
  requestedStartTime: string | null;
  availableStartTimes: string[];
  teacherSettings: TeacherSettings | null;
  lessonCount: number;
  totalsForCount: number;
  bookedSlotId: string | null;
  onSelectSlot: (id: string | null) => void;
  onSelectStartTime: (time: string | null) => void;
}) {
  const selectedSlot = useMemo(
    () => slots.find((s) => s.id === selectedSlotId) ?? null,
    [slots, selectedSlotId],
  );

  const blockedForCount = teacherSettings
    ? blockedDurationMinutes(lessonCount, teacherSettings)
    : 0;

  const computedEnd =
    selectedSlot && teacherSettings && requestedStartTime
      ? addMinutesToTime(requestedStartTime, totalsForCount)
      : null;

  const computedBlockedUntil =
    selectedSlot && teacherSettings && requestedStartTime
      ? addMinutesToTime(requestedStartTime, blockedForCount)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {slots.map((slot) => {
          const isSelected = slot.id === selectedSlotId;
          const isBooked = slot.id === bookedSlotId;
          return (
            <li key={slot.id}>
              <button
                type="button"
                disabled={isBooked}
                onClick={() => onSelectSlot(isSelected ? null : slot.id)}
                aria-pressed={isSelected}
                className={[
                  "w-full text-left rounded-2xl border p-4 sm:p-5 transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-yellow-500/60",
                  isBooked
                    ? "cursor-not-allowed border-border bg-muted/50 opacity-60"
                    : isSelected
                    ? "border-yellow-500 bg-yellow-500/10"
                    : "border-border bg-card hover:border-yellow-500/50",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold text-foreground">
                    {formatDateLongNoWeekday(slot.available_date)}
                  </span>
                  <Badge tone={isSelected ? "gold" : "neutral"} className="text-xs">
                    {formatWeekday(slot.available_date)}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <span aria-hidden="true">⏱</span>
                  <span>{formatTime(slot.start_time)} – {formatTime(slot.end_time)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {selectedSlot ? (
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Müsaitlik Aralığı
          </p>
          <p className="mt-1.5 text-sm text-foreground">
            {formatDateLongNoWeekday(selectedSlot.available_date)} · {formatWeekday(selectedSlot.available_date)} · {formatTime(selectedSlot.start_time)} – {formatTime(selectedSlot.end_time)}
          </p>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Başlangıç Saati Seçin
            </p>
            {teacherSettings && availableStartTimes.length === 0 ? (
              <p role="alert" className="mt-2 text-sm font-medium text-red-400">
                Bu ders sayısı bu müsaitlik aralığına sığmıyor. Lütfen daha az ders sayısı veya başka bir aralık deneyin.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {availableStartTimes.map((time) => {
                  const isSelected = time === requestedStartTime;
                  return (
                    <button
                      key={time}
                      type="button"
                      onClick={() => onSelectStartTime(isSelected ? null : time)}
                      aria-pressed={isSelected}
                      className={[
                        "rounded-full border px-4 py-2.5 text-sm font-medium transition-colors duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-yellow-500/60",
                        isSelected
                          ? "border-yellow-500 bg-yellow-500/10 text-foreground"
                          : "border-border bg-card text-foreground hover:border-yellow-500/50",
                      ].join(" ")}
                    >
                      {formatTime(time)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {requestedStartTime && computedEnd ? (
            <div className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Randevu Özeti
              </p>
              <p className="mt-1.5 text-sm text-foreground">
                Başlangıç: {formatTime(requestedStartTime)} · Bitiş: {formatTime(computedEnd)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {lessonCount} ders · toplam {formatDurationLabel(totalsForCount)}
              </p>
              {computedBlockedUntil ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Öğretmenin bir sonraki öğrenciye hazır olması: {formatTime(computedBlockedUntil)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Yukarıdaki uygun saatlerden bir başlangıç seçin. Bitiş saati seçilen ders sayısına göre otomatik hesaplanır.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground text-center py-4">
          Bir müsaitlik aralığı seçin; o aralıkta uygun başlangıç saatleri otomatik listelenecektir.
        </p>
      )}
    </div>
  );
}

function BookingFormCard({
  bookingForm,
  bookingSubmitting,
  bookingError,
  bookingSuccess,
  selectedSlotId,
  requestedStartTime,
  lessonCount,
  onLessonChange,
  onSubjectChange,
  onLessonModeChange,
  onSubmit,
  disabled,
}: {
  bookingForm: typeof EMPTY_BOOKING_FORM;
  bookingSubmitting: boolean;
  bookingError: string | null;
  bookingSuccess: string | null;
  selectedSlotId: string | null;
  requestedStartTime: string | null;
  lessonCount: number;
  onLessonChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onSubjectChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLessonModeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <Card className="overflow-hidden" padding="snug">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">Randevu Oluştur</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Bir müsaitlik aralığı seçin, ardından o aralıkta uygun olan bir başlangıç saati belirleyin. Ders sayısını seçip ders konusunu girin.
      </p>

      {bookingSuccess && (
        <p role="status" className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          {bookingSuccess}
        </p>
      )}

      {bookingError && (
        <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {bookingError}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="booking-lesson" className="text-sm font-medium text-foreground">Ders</label>
          <select
            id="booking-lesson"
            value={bookingForm.lesson}
            onChange={onLessonChange}
            disabled={bookingSubmitting || !selectedSlotId}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 touch-manipulation disabled:opacity-60"
          >
            <option value="" disabled style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}>
              Ders seçin
            </option>
            {LESSON_OPTIONS.map((l) => (
              <option
                key={l}
                value={l}
                style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}
              >
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="booking-subject" className="text-sm font-medium text-foreground">Ders Konusu</label>
          <input
            id="booking-subject"
            type="text"
            placeholder="Konu başlığı"
            value={bookingForm.subject}
            onChange={onSubjectChange}
            disabled={bookingSubmitting || !selectedSlotId}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 touch-manipulation disabled:opacity-60 placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <label htmlFor="booking-lesson-mode" className="text-sm font-medium text-foreground">Ders Türü</label>
        <select
          id="booking-lesson-mode"
          value={bookingForm.lessonMode}
          onChange={onLessonModeChange}
          disabled={bookingSubmitting || !selectedSlotId}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 touch-manipulation disabled:opacity-60"
        >
          <option value="" disabled style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}>
            Ders türü seçin
          </option>
          {LESSON_MODE_OPTIONS.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Online veya Yüz Yüze ders arasında bir seçim yapın.</p>
      </div>

      <div className="mt-5">
        <PrimaryButton onClick={onSubmit} disabled={disabled} className="w-full sm:w-auto">
          {bookingSubmitting ? "Oluşturuluyor..." : "Randevu Oluştur"}
        </PrimaryButton>
        {!selectedSlotId ? (
          <p className="mt-2 text-sm text-muted-foreground">Önce bir müsaitlik aralığı ve başlangıç saati seçin.</p>
        ) : !requestedStartTime ? (
          <p className="mt-2 text-sm text-muted-foreground">Lütfen uygun bir başlangıç saati seçin.</p>
        ) : bookingForm.lessonMode !== "online" && bookingForm.lessonMode !== "in_person" ? (
          <p className="mt-2 text-sm text-muted-foreground">Lütfen ders türünü seçin (Online veya Yüz Yüze).</p>
        ) : null}
      </div>
    </Card>
  );
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
        width={96}
        height={96}
        className="inline-flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-border object-cover"
        unoptimized
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-border bg-yellow-500/20 text-2xl font-semibold text-black"
    >
      {initialsOf(name)}
    </span>
  );
}

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function translateProfileError(error: { code?: string; message?: string }): string {
  if (error.code === "42501") {
    return "Bu işlem için yetkiniz yok. Lütfen tekrar giriş yapın.";
  }
  if (error.code === "42P01") {
    return "Profil kaynağı geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin.";
  }
  return error.message ?? "Profil bilgileri yüklenemedi. Lütfen tekrar deneyin.";
}

function translateSlotsError(error: { code?: string; message?: string }): string {
  if (error.code === "42501") {
    return "Müsaitlik bilgilerini görmek için yetkiniz yok. Lütfen tekrar giriş yapın.";
  }
  return error.message ?? "Müsaitlikler yüklenemedi. Lütfen tekrar deneyin.";
}

type TeacherSettings = {
  lesson_duration_minutes: number;
  lesson_break_minutes: number;
  student_buffer_minutes: number;
};

function totalDurationMinutes(lessonCount: number, settings: TeacherSettings): number {
  const lessons = Math.max(MIN_LESSON_COUNT, Math.min(MAX_LESSON_COUNT, lessonCount));
  const lessonsPart = lessons * settings.lesson_duration_minutes;
  const breaksPart = Math.max(0, lessons - 1) * settings.lesson_break_minutes;
  return lessonsPart + breaksPart;
}

function blockedDurationMinutes(lessonCount: number, settings: TeacherSettings): number {
  return totalDurationMinutes(lessonCount, settings) + settings.student_buffer_minutes;
}

function generateStartTimes(slot: AvailabilityRow, lessonCount: number, settings: TeacherSettings): string[] {
  const blocked = blockedDurationMinutes(lessonCount, settings);
  const slotStart = timeToMinutes(slot.start_time);
  const slotEnd = timeToMinutes(slot.end_time);

  if (slotStart === null || slotEnd === null) return [];
  if (blocked > slotEnd - slotStart) return [];

  const candidates: string[] = [];
  const today = isTodayKey(slot.available_date);
  const nowMin = istanbulNowMinutes();

  for (let t = slotStart; t + blocked <= slotEnd; t += START_TIME_STEP_MIN) {
    if (today && t < nowMin) continue;
    candidates.push(minutesToTime(t));
  }
  return candidates;
}