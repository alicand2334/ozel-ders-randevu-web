"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { isValidEmail } from "@/lib/supabase/auth-helpers";
import {
  addDays,
  buildWeekDayKeys,
  dateOnlyToDate,
  formatDateLong,
  formatCalendarDay,
  formatCalendarWeekRange,
  formatDuration,
  formatNotificationDate,
  formatTime,
  istanbulDayEndMs,
  istanbulStartOfWeekMonday,
  istanbulTodayKey,
  istanbulTodayStart,
  isTodayKey,
  isoToMinutes,
  minutesToTime,
  pad2,
  timePartOfIso,
  timeToMinutes,
} from "@/lib/datetime";
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  TextInput,
} from "@/components/ui";

type StudentProfileRow = {
  id: string;
  full_name: string | null;
};

type StudentListItem = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
};

type StudentsApiResponse = StudentListItem[];
type StudentsApiError = { error?: string };

type AvailabilityRow = {
  id: string;
  available_date: string;
  start_time: string;
  end_time: string;
  status: "open" | "booked" | "blocked";
};

type FetchState = "loading" | "ready" | "error";

const STATUS_LABEL: Record<AvailabilityRow["status"], string> = {
  open: "Müsait",
  booked: "Dolu",
  blocked: "Kapalı",
};

type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "completed";

type AppointmentRow = {
  id: string;
  status: AppointmentStatus;
  lesson: string | null;
  subject: string | null;
  notes: string | null;
  student_id: string;
  student_name: string | null;
  slot_id: string;
  created_at: string;
  requested_start_time: string | null;
  start_at: string | null;
  end_at: string | null;
  lesson_count: number | null;
  lesson_duration_minutes: number | null;
  break_duration_minutes: number | null;
  slot:
    | {
        available_date: string;
      }[]
    | null;
};

type NotificationRow = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  ok: boolean;
  appointment_id: string;
  created_at: string;
};

function appointmentDisplayInfo(appt: AppointmentRow): {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  lessonCount: number | null;
  totalDurationMinutes: number | null;
} {
  const availableDate =
    appt.slot && appt.slot.length > 0
      ? appt.slot[0].available_date
      : null;

  const startTime = appt.requested_start_time ?? timePartOfIso(appt.start_at) ?? null;

  let endTime = timePartOfIso(appt.end_at) ?? null;

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

  // Eğer requested_start_time kullanılıyorsa (öğrencinin seçtiği wall-clock),
  // end_at için timePartOfIso'yu tekrar uygulama — zaten start_at/end_at
  // UTC'ye dönüştürülürken walls-time üzerine tekrar offset eklenmiş olabilir
  // (çift dönüşüm). Bitişi requested_start_time + toplam süreden hesapla.
  if (appt.requested_start_time && totalDurationMinutes !== null) {
    const startMinutes = timeToMinutes(appt.requested_start_time);
    if (startMinutes !== null) {
      const endMinutes = startMinutes + totalDurationMinutes;
      endTime = minutesToTime(endMinutes);
    }
  }

  return {
    date: availableDate,
    startTime,
    endTime,
    lessonCount,
    totalDurationMinutes,
  };
}

const CALENDAR_HOUR_START = 0;
const CALENDAR_HOUR_END = 24;
const CALENDAR_HOURS = Array.from(
  { length: CALENDAR_HOUR_END - CALENDAR_HOUR_START },
  (_, i) => CALENDAR_HOUR_START + i,
);

const WEEKDAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;

const MONTH_LABELS_TR = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

/** gg.aa.yyyy formatında Türkçe gösterim için yardımcı. */
function formatDayKeyTr(dayKey: string): string {
  const date = dateOnlyToDate(dayKey);
  if (!date) return dayKey;
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  return `${d}.${m}.${y}`;
}

const APPT_STATUS_CALENDAR_TONE: Record<
  AppointmentStatus,
  "gold" | "neutral"
> = {
  pending: "gold",
  confirmed: "neutral",
  cancelled: "neutral",
  completed: "neutral",
};

type CalendarBlock = {
  id: string;
  kind: "availability" | "appointment";
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
  past: boolean;
  status?: AppointmentStatus;
  slotStatus?: AvailabilityRow["status"];
  appt?: AppointmentRow;
};

function clampMinutes(value: number): number {
  if (value < CALENDAR_HOUR_START * 60) return CALENDAR_HOUR_START * 60;
  if (value > CALENDAR_HOUR_END * 60) return CALENDAR_HOUR_END * 60;
  return value;
}

const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: "Beklemede",
  confirmed: "Onaylandı",
  cancelled: "İptal Edildi",
  completed: "Tamamlandı",
};

type NewStudentForm = {
  full_name: string;
  email: string;
  temporary_password: string;
  phone: string;
};

type CreateStudentResponse = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
};

type CreateStudentApiError = { error?: string };

type AvailabilityForm = {
  date: string;
  startHour: string;
  startMin: string;
  endHour: string;
  endMin: string;
};

const EMPTY_FORM: AvailabilityForm = {
  date: "",
  startHour: "",
  startMin: "",
  endHour: "",
  endMin: "",
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) =>
  i.toString().padStart(2, "0"),
);
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) =>
  (i * 5).toString().padStart(2, "0"),
);

function buildTime(hour: string, minute: string): string {
  return `${hour}:${minute}`;
}

function timeComponents(
  time: string,
): { hour: string; minute: string } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return { hour: match[1], minute: match[2] };
}

const EMPTY_STUDENT_FORM: NewStudentForm = {
  full_name: "",
  email: "",
  temporary_password: "",
  phone: "",
};

export default function OgretmenPanelPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [roleLoading, setRoleLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [slots, setSlots] = useState<AvailabilityRow[]>([]);
  const [state, setState] = useState<FetchState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [apptState, setApptState] = useState<FetchState>("loading");
  const [apptError, setApptError] = useState<string | null>(null);
  const [apptActionId, setApptActionId] = useState<string | null>(null);
  const [apptActionError, setApptActionError] = useState<string | null>(null);
  const [apptCalendarId, setApptCalendarId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState<number>(0);

  const todayReference = useMemo(() => new Date(), []);
  const todayStartMs = useMemo(
    () => istanbulTodayStart(todayReference).getTime(),
    [todayReference],
  );
  const weekStart = useMemo(
    () => addDays(
      istanbulStartOfWeekMonday(todayReference),
      weekOffset * 7,
    ),
    [todayReference, weekOffset],
  );
  const weekDays = useMemo(() => buildWeekDayKeys(weekStart), [weekStart]);
  const weekDayKeys = useMemo(
    () => new Set(weekDays),
    [weekDays],
  );

  const calendarBlocks = useMemo<CalendarBlock[]>(() => {
    const nowMs = todayStartMs;

    const blocks: CalendarBlock[] = [];

    for (const slot of slots) {
      if (!weekDayKeys.has(slot.available_date)) continue;
      let startM = timeToMinutes(slot.start_time);
      let endM = timeToMinutes(slot.end_time);
      if (startM === null || endM === null) continue;
      startM = clampMinutes(startM);
      endM = clampMinutes(endM);
      if (endM <= startM) continue;
      const slotEndOfDay = istanbulDayEndMs(slot.available_date);
      if (slotEndOfDay === null) continue;
      blocks.push({
        id: `avail:${slot.id}`,
        kind: "availability",
        dayKey: slot.available_date,
        startMinutes: startM,
        endMinutes: endM,
        past: slotEndOfDay <= nowMs,
        slotStatus: slot.status,
      });
    }

    for (const appt of appointments) {
      const dayKey = appt.slot?.[0]?.available_date ?? null;
      if (!dayKey || !weekDayKeys.has(dayKey)) continue;
      const info = appointmentDisplayInfo(appt);
      let startM = timeToMinutes(info.startTime);
      let endM = timeToMinutes(info.endTime);
      if (startM === null) {
        startM = isoToMinutes(appt.start_at);
      }
      if (endM === null) {
        endM = isoToMinutes(appt.end_at);
      }
      if (startM === null || endM === null) continue;
      startM = clampMinutes(startM);
      endM = clampMinutes(endM);
      if (endM <= startM) continue;
      const dayEndMs = istanbulDayEndMs(dayKey);
      if (dayEndMs === null) continue;
      blocks.push({
        id: `appt:${appt.id}`,
        kind: "appointment",
        dayKey,
        startMinutes: startM,
        endMinutes: endM,
        past: dayEndMs <= nowMs,
        status: appt.status,
        appt,
      });
    }

    return blocks;
  }, [slots, appointments, weekDayKeys, todayStartMs]);

  const blocksByDay = useMemo(() => {
    const map = new Map<string, CalendarBlock[]>();
    for (const day of weekDays) map.set(day, []);
    for (const block of calendarBlocks) {
      const list = map.get(block.dayKey);
      if (list) list.push(block);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startMinutes - b.startMinutes);
    }
    return map;
  }, [calendarBlocks, weekDays]);

  const selectedCalendarAppt = useMemo(
    () =>
      apptCalendarId
        ? (appointments.find((a) => a.id === apptCalendarId) ?? null)
        : null,
    [apptCalendarId, appointments],
  );

  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [studentForm, setStudentForm] = useState<NewStudentForm>(EMPTY_STUDENT_FORM);
  const [studentFormError, setStudentFormError] = useState<string | null>(null);
  const [studentFormSuccess, setStudentFormSuccess] = useState<string | null>(null);
  const [studentSubmitting, setStudentSubmitting] = useState(false);
  const studentModalPanelRef = useRef<HTMLDivElement>(null);

  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [studentsState, setStudentsState] = useState<FetchState>("loading");
  const [studentsError, setStudentsError] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationsLoading, setNotificationsLoading] =
    useState<boolean>(true);
  const [notificationsError, setNotificationsError] = useState<string | null>(
    null,
  );
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsDropdownRef = useRef<HTMLDivElement | null>(null);

  const openStudentModal = useCallback(() => {
    setStudentForm(EMPTY_STUDENT_FORM);
    setStudentFormError(null);
    setStudentFormSuccess(null);
    setStudentSubmitting(false);
    setStudentModalOpen(true);
  }, []);

  const closeStudentModal = useCallback(() => {
    if (studentSubmitting) return;
    setStudentModalOpen(false);
    setStudentFormError(null);
    setStudentFormSuccess(null);
  }, [studentSubmitting]);

  useEffect(() => {
    if (!studentModalOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !studentSubmitting) {
        setStudentModalOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [studentModalOpen, studentSubmitting]);

  useEffect(() => {
    if (!isNotificationsOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        notificationsDropdownRef.current &&
        !notificationsDropdownRef.current.contains(event.target as Node)
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
    if (!studentModalOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    studentModalPanelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [studentModalOpen]);

  function handleStudentFieldChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setStudentForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleStudentSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (studentSubmitting) return;

    setStudentFormError(null);
    setStudentFormSuccess(null);

    const fullName = studentForm.full_name.trim();
    const email = studentForm.email.trim();
    const temporaryPassword = studentForm.temporary_password;

    if (!fullName) {
      setStudentFormError("Ad Soyad boş olamaz.");
      return;
    }
    if (!isValidEmail(email)) {
      setStudentFormError("Geçerli bir e-posta adresi girin.");
      return;
    }
    if (temporaryPassword.length < 8) {
      setStudentFormError("Geçici şifre en az 8 karakter olmalı.");
      return;
    }

    setStudentSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setStudentFormError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setStudentSubmitting(false);
        return;
      }

      const res = await fetch("/api/teacher/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          temporary_password: temporaryPassword,
          phone: studentForm.phone.trim() || null,
        }),
      });

      const payload: CreateStudentResponse | CreateStudentApiError =
        await res.json();

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as CreateStudentApiError;
        setStudentFormError(
          apiError.error ?? "Öğrenci oluşturulurken bir hata oluştu.",
        );
        setStudentSubmitting(false);
        return;
      }

      setStudentFormSuccess("Öğrenci başarıyla oluşturuldu.");
      setStudentForm(EMPTY_STUDENT_FORM);
      setStudentSubmitting(false);

      void fetchStudents();

      setTimeout(() => {
        setStudentModalOpen(false);
        setStudentFormSuccess(null);
      }, 1200);
    } catch {
      setStudentFormError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setStudentSubmitting(false);
    }
  }

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

  const fetchSlots = useCallback(async (uid: string) => {
    setState("loading");
    setErrorMsg(null);
    const { data, error } = await supabase
      .from("availability")
      .select("id, available_date, start_time, end_time, status")
      .eq("teacher_id", uid)
      .order("available_date", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
      setState("error");
      return;
    }
    setSlots((data ?? []) as AvailabilityRow[]);
    setState("ready");
  }, []);

  const fetchAppointments = useCallback(async (uid: string) => {
    setApptState("loading");
    setApptError(null);
    const { data, error } = await supabase
      .from("appointments")
      .select(
        "id, status, lesson, subject, notes, student_id, slot_id, created_at, requested_start_time, start_at, end_at, lesson_count, lesson_duration_minutes, break_duration_minutes, slot:availability(available_date)",
      )
      .eq("teacher_id", uid)
      .order("created_at", { ascending: false });
    if (error) {
      setApptError(error.message);
      setApptState("error");
      return;
    }

    const rows = (data ?? []) as AppointmentRow[];

    const studentIds = Array.from(
      new Set(rows.map((r) => r.student_id)),
    );
    let studentMap = new Map<string, string | null>();
    if (studentIds.length > 0) {
      const { data: studentData, error: studentError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", studentIds);
      if (studentError) {
        setApptError(studentError.message);
        setApptState("error");
        return;
      }
      studentMap = new Map<string, string | null>(
        ((studentData ?? []) as StudentProfileRow[]).map((s) => [
          s.id,
          s.full_name,
        ]),
      );
    }

    setAppointments(
      rows.map((row) => ({
        ...row,
        student_name: studentMap.get(row.student_id) ?? null,
      })) as AppointmentRow[],
    );
    setApptState("ready");
  }, []);

  const fetchStudents = useCallback(async () => {
    setStudentsState("loading");
    setStudentsError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setStudentsError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setStudentsState("error");
        return;
      }

      const res = await fetch("/api/teacher/students", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const payload: StudentsApiResponse | StudentsApiError =
        await res.json();

      if (!res.ok || !Array.isArray(payload)) {
        const apiError = payload as StudentsApiError;
        setStudentsError(
          apiError.error ?? "Öğrenci listesi getirilemedi.",
        );
        setStudentsState("error");
        return;
      }

      setStudents(payload as StudentsApiResponse);
      setStudentsState("ready");
    } catch {
      setStudentsError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setStudentsState("error");
    }
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => n.ok === false).length,
    [notifications],
  );

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
    if (!allowed || !user) {
      return;
    }
    const uid = user.id;
    let active = true;

    (async () => {
      await Promise.all([
        fetchSlots(uid),
        fetchAppointments(uid),
        fetchStudents(),
        fetchNotifications(uid),
      ]);
      if (!active) return;
    })();

    return () => {
      active = false;
    };
  }, [allowed, user, fetchSlots, fetchAppointments, fetchStudents, fetchNotifications]);

  useEffect(() => {
    if (!allowed || !user) {
      return;
    }
    const uid = user.id;

    const channel = supabase
      .channel("ogretmen-notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${uid}`,
        },
        () => {
          void fetchNotifications(uid);
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
        () => {
          void fetchNotifications(uid);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [allowed, user, fetchNotifications]);

  useEffect(() => {
    if (!allowed || !user) {
      return;
    }
    const uid = user.id;

    const channel = supabase
      .channel("teacher-panel-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability",
          filter: `teacher_id=eq.${uid}`,
        },
        () => {
          void fetchSlots(uid);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `teacher_id=eq.${uid}`,
        },
        () => {
          void fetchAppointments(uid);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [allowed, user, fetchSlots, fetchAppointments]);

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/giris");
  }

  async function handleRetry() {
    if (!user) return;
    await fetchSlots(user.id);
  }

  async function handleApptRetry() {
    if (!user) return;
    await fetchAppointments(user.id);
  }

  async function updateAppointmentStatus(
    appt: AppointmentRow,
    nextStatus: AppointmentStatus,
  ) {
    if (!user) return;
    setApptActionId(appt.id);
    setApptActionError(null);

    const { error } = await supabase
      .from("appointments")
      .update({ status: nextStatus })
      .eq("id", appt.id);

    setApptActionId(null);

    if (error) {
      setApptActionError(translateStatusError(error));
      return;
    }

    await fetchAppointments(user.id);
    await fetchSlots(user.id);
  }

  function updateField(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
    setFormErrors((p) => ({ ...p, [field]: "" }));
    setSubmitError(null);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.date) next.date = "Tarih zorunludur.";

    const startMissing = !form.startHour || !form.startMin;
    const endMissing = !form.endHour || !form.endMin;
    if (startMissing) next.start = "Başlangıç saati zorunludur.";
    if (endMissing) next.end = "Bitiş saati zorunludur.";

    if (!startMissing && !endMissing) {
      const start = buildTime(form.startHour, form.startMin);
      const end = buildTime(form.endHour, form.endMin);
      if (end <= start) {
        next.end = "Bitiş saati başlangıç saatinden sonra olmalıdır.";
      }
    }
    setFormErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!user) return;
    if (!validate()) return;

    const startTime = buildTime(form.startHour, form.startMin);
    const endTime = buildTime(form.endHour, form.endMin);

    setSubmitting(true);
    setSubmitError(null);

    const { data: existingSlots, error: fetchError } = await supabase
      .from("availability")
      .select("id, available_date, start_time, end_time, status")
      .eq("teacher_id", user.id)
      .eq("available_date", form.date);
    if (fetchError) {
      setSubmitting(false);
      setSubmitError(
        fetchError.message ??
          "Mevcut müsaitlikler sorgulanamadı. Lütfen tekrar deneyin.",
      );
      return;
    }

    const overlapping = ((existingSlots ?? []) as AvailabilityRow[]).find(
      (slot) =>
        startTime < slot.end_time && endTime > slot.start_time,
    );
    if (overlapping) {
      setSubmitting(false);
      setSubmitError(
        "Bu saat aralığı mevcut bir müsaitliğinizle çakışıyor.",
      );
      return;
    }

    const { error } = await supabase.from("availability").insert({
      teacher_id: user.id,
      available_date: form.date,
      start_time: startTime,
      end_time: endTime,
      status: "open",
    });

    setSubmitting(false);

    if (error) {
      setSubmitError(translateInsertError(error));
      return;
    }

    setForm(EMPTY_FORM);
    setFormErrors({});
    await fetchSlots(user.id);
  }

  return (
    <main
      className="flex min-h-dvh flex-col items-center px-6 py-16 sm:px-10"
      data-unread-notifications={unreadCount}
      data-notifications-loading={notificationsLoading}
      data-notifications-error={notificationsError ?? ""}
    >
      <div className="w-full max-w-2xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle
            align="left"
            eyebrow="Öğretmen Paneli"
            title="Müsaitlik Takvimi"
            description="Uygun ders saatlerinizi ekleyin ve mevcut kayıtlarınızı görüntüleyin."
          />
          <div
            ref={notificationsDropdownRef}
            className="relative w-full sm:w-auto"
          >
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
                      Henüz bildiriminiz yok.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {notifications.map((n) => (
                        <li
                          key={n.id}
                          className="flex items-start gap-2.5 px-4 py-3 transition-colors duration-150"
                        >
                          <span
                            aria-hidden="true"
                            className={[
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              n.ok ? "bg-subtle" : "bg-gold",
                            ].join(" ")}
                          />
                          <div className="flex flex-1 flex-col gap-0.5">
                            <span
                              className={[
                                "text-sm text-ink-text",
                                n.ok
                                  ? "font-normal"
                                  : "font-semibold",
                              ].join(" ")}
                            >
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold tracking-tight text-ink-text">
                Öğrenci Yönetimi
              </h2>
              <p className="text-xs leading-relaxed text-subtle">
                Sisteme yeni öğrenci hesabı ekleyin.
              </p>
            </div>
            <PrimaryButton
              onClick={openStudentModal}
              className="w-full sm:w-auto"
            >
              Yeni Öğrenci Ekle
            </PrimaryButton>
          </div>
        </Card>

        <Card className="mt-6" padding="roomy" raised>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Öğrencilerim
            </h2>
            {studentsState === "ready" ? (
              <Badge tone="neutral">{students.length} kayıt</Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {studentsState === "loading" ? (
              <p className="text-sm text-muted">Öğrenciler yükleniyor…</p>
            ) : studentsState === "error" ? (
              <p
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
              >
                {studentsError ?? "Öğrenci listesi yüklenemedi."}
              </p>
            ) : students.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                Henüz bağlı öğrenciniz yok.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {students.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/panel/ogretmen/ogrenciler/${s.id}`}
                      className="-mx-3 flex cursor-pointer flex-col gap-1 rounded-lg px-3 py-3 transition-colors hover:bg-surface-raised sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-ink-text">
                          {s.full_name?.trim() || "Belirtilmedi"}
                        </span>
                        {s.phone?.trim() ? (
                          <span className="text-xs text-muted">
                            {s.phone.trim()}
                          </span>
                        ) : null}
                      </div>
                      <Badge tone={s.is_active ? "gold" : "neutral"}>
                        {s.is_active ? "Aktif" : "Pasif"}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="mt-8" padding="roomy" raised>
          <h2 className="text-base font-semibold tracking-tight text-ink-text">
            Yeni Müsaitlik Ekle
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-subtle">
            Tarih ve saat aralığını girin. Aynı tarih ve saatlerde tekrar ekleyemezsiniz.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <TurkishDatePicker
              id="date"
              label="Tarih"
              value={form.date}
              onChange={(v) => updateField("date", v)}
              minDayKey={istanbulTodayKey()}
              aria-invalid={Boolean(formErrors.date)}
              aria-describedby={formErrors.date ? "date-err" : undefined}
            />
            <HourMinutePicker
              label="Başlangıç"
              hourName="startHour"
              minuteName="startMin"
              hourValue={form.startHour}
              minuteValue={form.startMin}
              onChange={updateField}
              ariaInvalid={Boolean(formErrors.start)}
              ariaDescribedby={formErrors.start ? "start-err" : undefined}
            />
            <HourMinutePicker
              label="Bitiş"
              hourName="endHour"
              minuteName="endMin"
              hourValue={form.endHour}
              minuteValue={form.endMin}
              onChange={updateField}
              ariaInvalid={Boolean(formErrors.end)}
              ariaDescribedby={formErrors.end ? "end-err" : undefined}
            />
          </div>

          <div className="mt-3 space-y-1.5">
            {formErrors.date ? (
              <p id="date-err" className="text-xs text-red-400">
                {formErrors.date}
              </p>
            ) : null}
            {formErrors.start ? (
              <p id="start-err" className="text-xs text-red-400">
                {formErrors.start}
              </p>
            ) : null}
            {formErrors.end ? (
              <p id="end-err" className="text-xs text-red-400">
                {formErrors.end}
              </p>
            ) : null}
          </div>

          {submitError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
            >
              {submitError}
            </p>
          ) : null}

          <div className="mt-5">
            <PrimaryButton
              onClick={handleSubmit}
              disabled={
                submitting ||
                !form.date ||
                !form.startHour ||
                !form.startMin ||
                !form.endHour ||
                !form.endMin
              }
              className="w-full sm:w-auto"
            >
              {submitting ? "Kaydediliyor..." : "Kaydet"}
            </PrimaryButton>
          </div>
        </Card>

        <Card className="mt-6" padding="roomy" raised>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold tracking-tight text-ink-text">
                Haftalık Takvim
              </h2>
              <p className="text-xs leading-relaxed text-subtle">
                {formatCalendarWeekRange(weekStart)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton
                onClick={() => setWeekOffset((w) => w - 1)}
                className="w-auto"
                aria-label="Önceki hafta"
              >
                ‹
              </SecondaryButton>
              <SecondaryButton
                onClick={() => setWeekOffset(0)}
                disabled={weekOffset === 0}
                className="w-auto"
              >
                Bugün
              </SecondaryButton>
              <SecondaryButton
                onClick={() => setWeekOffset((w) => w + 1)}
                className="w-auto"
                aria-label="Sonraki hafta"
              >
                ›
              </SecondaryButton>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-subtle">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm border border-gold/40 bg-gold/15"
              />
              Müsait
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm border border-sky-500/40 bg-sky-500/15"
              />
              Onaylandı
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm border border-gold/60 bg-gold/25"
              />
              Beklemede
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm border border-emerald-500/40 bg-emerald-500/15"
              />
              Tamamlandı
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm border border-red-500/40 bg-red-500/15"
              />
              İptal Edildi
            </span>
          </div>

          <div className="mt-5 overflow-x-auto pb-2">
            <div className="min-w-[760px]">
              <div
                className="grid gap-px"
                style={{
                  gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))`,
                }}
              >
                <div className="sticky left-0 z-10 bg-surface" />
                {weekDays.map((dayKey, i) => {
                  const today = isTodayKey(dayKey);
                  return (
                    <div
                      key={dayKey}
                      className="px-2 pb-1 text-center"
                    >
                      <div className="text-xs font-semibold text-ink-text">
                        {WEEKDAY_LABELS[i]}
                      </div>
                      <div
                        className={[
                          "mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs",
                          today
                            ? "bg-gold text-ink font-semibold"
                            : "text-muted",
                        ].join(" ")}
                      >
                        {formatCalendarDay(dayKey)}
                      </div>
                    </div>
                  );
                })}

                {CALENDAR_HOURS.map((hour) => (
                  <CalendarHourRow
                    key={hour}
                    hour={hour}
                    weekDays={weekDays}
                    blocksByDay={blocksByDay}
                    selectedCalendarApptId={apptCalendarId}
                    onSelectAppt={setApptCalendarId}
                  />
                ))}
              </div>
            </div>
          </div>

          {selectedCalendarAppt ? (
            <div className="mt-5 rounded-2xl border border-line bg-ink/40 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted">
                  {selectedCalendarAppt.student_name?.trim() ||
                    "Bilinmeyen Öğrenci"}
                </span>
                {selectedCalendarAppt.lesson ? (
                  <span className="text-xs text-muted">
                    Ders: {selectedCalendarAppt.lesson}
                  </span>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink-text">
                    Konu:{" "}
                    {selectedCalendarAppt.subject?.trim() || "Belirtilmedi"}
                  </span>
                  <Badge
                    tone={APPT_STATUS_CALENDAR_TONE[selectedCalendarAppt.status]}
                  >
                    {APPT_STATUS_LABEL[selectedCalendarAppt.status]}
                  </Badge>
                </div>
                <span className="text-xs text-muted">
                  {(() => {
                    const info = appointmentDisplayInfo(selectedCalendarAppt);
                    const date = info.date ? formatDateLong(info.date) : null;
                    const start = info.startTime
                      ? formatTime(info.startTime)
                      : null;
                    const end = info.endTime
                      ? formatTime(info.endTime)
                      : null;
                    const pieces: string[] = [];
                    if (date) pieces.push(date);
                    if (start && end) pieces.push(`${start} – ${end}`);
                    else if (start) pieces.push(`${start} – ?`);
                    if (info.lessonCount)
                      pieces.push(`${info.lessonCount} ders`);
                    if (info.totalDurationMinutes)
                      pieces.push(formatDuration(info.totalDurationMinutes));
                    return pieces.length > 0
                      ? pieces.join(" · ")
                      : "Randevu bilgisi eksik";
                  })()}
                </span>
                {selectedCalendarAppt.notes &&
                selectedCalendarAppt.notes.trim() ? (
                  <span className="mt-1 text-xs leading-relaxed text-subtle">
                    Not: {selectedCalendarAppt.notes.trim()}
                  </span>
                ) : null}
              </div>

              {apptActionError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {apptActionError}
                </p>
              ) : null}

              {selectedCalendarAppt.status === "pending" ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <PrimaryButton
                    onClick={() => {
                      void updateAppointmentStatus(
                        selectedCalendarAppt,
                        "confirmed",
                      );
                    }}
                    disabled={apptActionId === selectedCalendarAppt.id}
                    className="w-full sm:w-auto"
                  >
                    {apptActionId === selectedCalendarAppt.id
                      ? "İşleniyor..."
                      : "Onayla"}
                  </PrimaryButton>
                  <SecondaryButton
                    onClick={() => {
                      void updateAppointmentStatus(
                        selectedCalendarAppt,
                        "cancelled",
                      );
                    }}
                    disabled={apptActionId === selectedCalendarAppt.id}
                    className="w-full sm:w-auto"
                  >
                    Reddet
                  </SecondaryButton>
                </div>
              ) : null}

              {selectedCalendarAppt.status === "confirmed" ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <PrimaryButton
                    onClick={() => {
                      void updateAppointmentStatus(
                        selectedCalendarAppt,
                        "completed",
                      );
                    }}
                    disabled={apptActionId === selectedCalendarAppt.id}
                    className="w-full sm:w-auto"
                  >
                    {apptActionId === selectedCalendarAppt.id
                      ? "İşleniyor..."
                      : "Tamamlandı Olarak İşaretle"}
                  </PrimaryButton>
                  <SecondaryButton
                    onClick={() => {
                      void updateAppointmentStatus(
                        selectedCalendarAppt,
                        "cancelled",
                      );
                    }}
                    disabled={apptActionId === selectedCalendarAppt.id}
                    className="w-full sm:w-auto"
                  >
                    İptal Et
                  </SecondaryButton>
                </div>
              ) : null}

              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setApptCalendarId(null)}
                  className="text-xs text-muted underline-offset-2 hover:text-ink-text hover:underline"
                >
                  Kapat
                </button>
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="mt-6" padding="roomy" raised>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Müsaitliklerim
            </h2>
            {state === "ready" ? (
              <Badge tone="neutral">{slots.length} kayıt</Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {state === "loading" ? (
              <p className="text-sm text-muted">Yükleniyor...</p>
            ) : state === "error" ? (
              <div className="flex flex-col gap-3">
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  Müsaitlikler yüklenemedi: {errorMsg ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton onClick={handleRetry} className="w-full sm:w-auto">
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : slots.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                Henüz müsaitlik kaydınız yok. Saatlerinizi eklediğinizde burada
                listelenecek.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {slots.map((slot) => (
                  <li
                    key={slot.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-ink-text">
                        {formatDateLong(slot.available_date)}
                      </span>
                      <span className="text-xs text-muted">
                        {formatTime(slot.start_time)} –{" "}
                        {formatTime(slot.end_time)}
                      </span>
                    </div>
                    <Badge tone={toneFor(slot.status)}>
                      {STATUS_LABEL[slot.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="mt-6" padding="roomy" raised>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Gelen Randevular
            </h2>
            {apptState === "ready" ? (
              <Badge tone="neutral">{appointments.length} kayıt</Badge>
            ) : null}
          </div>

          {apptActionError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
            >
              {apptActionError}
            </p>
          ) : null}

          <div className="mt-5">
            {apptState === "loading" ? (
              <p className="text-sm text-muted">Yükleniyor...</p>
            ) : apptState === "error" ? (
              <div className="flex flex-col gap-3">
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  Randevular yüklenemedi: {apptError ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton
                  onClick={handleApptRetry}
                  className="w-full sm:w-auto"
                >
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : appointments.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                Henüz bir randevu talebi yok. Öğrenciler müsait saatlerinize
                randevu oluşturduğunda burada listelenecek.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {appointments.map((appt) => (
                  <li
                    key={appt.id}
                    className="flex flex-col gap-3 py-4"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted">
                        {appt.student_name?.trim() || "Bilinmeyen Öğrenci"}
                      </span>
                      {appt.lesson ? (
                        <span className="text-xs text-muted">
                          Ders: {appt.lesson}
                        </span>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink-text">
                          Konu: {appt.subject?.trim() || "Belirtilmedi"}
                        </span>
                        <Badge tone={apptTone(appt.status)}>
                          {APPT_STATUS_LABEL[appt.status]}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted">
                        {(() => {
                          const info = appointmentDisplayInfo(appt);
                          const date = info.date ? formatDateLong(info.date) : null;
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

                    {appt.status === "pending" ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <PrimaryButton
                          onClick={() =>
                            updateAppointmentStatus(appt, "confirmed")
                          }
                          disabled={apptActionId === appt.id}
                          className="w-full sm:w-auto"
                        >
                          {apptActionId === appt.id
                            ? "İşleniyor..."
                            : "Onayla"}
                        </PrimaryButton>
                        <SecondaryButton
                          onClick={() =>
                            updateAppointmentStatus(appt, "cancelled")
                          }
                          disabled={apptActionId === appt.id}
                          className="w-full sm:w-auto"
                        >
                          Reddet
                        </SecondaryButton>
                      </div>
                    ) : null}

                    {appt.status === "confirmed" ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <PrimaryButton
                          onClick={() =>
                            updateAppointmentStatus(appt, "completed")
                          }
                          disabled={apptActionId === appt.id}
                          className="w-full sm:w-auto"
                        >
                          {apptActionId === appt.id
                            ? "İşleniyor..."
                            : "Tamamlandı Olarak İşaretle"}
                        </PrimaryButton>
                        <SecondaryButton
                          onClick={() =>
                            updateAppointmentStatus(appt, "cancelled")
                          }
                          disabled={apptActionId === appt.id}
                          className="w-full sm:w-auto"
                        >
                          İptal Et
                        </SecondaryButton>
                      </div>
                    ) : null}
                  </li>
                ))}
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

      {studentModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !studentSubmitting) {
              closeStudentModal();
            }
          }}
        >
          <div
            ref={studentModalPanelRef}
            tabIndex={-1}
            className="flex max-h-[calc(100dvh-3rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl shadow-black/50 outline-none"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-ink-deep/40 px-6 py-5">
              <div className="flex flex-col gap-1">
                <h2
                  id="student-modal-title"
                  className="text-base font-semibold tracking-tight text-ink-text"
                >
                  Yeni Öğrenci Ekle
                </h2>
                <p className="text-xs leading-relaxed text-muted">
                  Öğrenci için geçici şifre belirleyin. İlk girişten sonra
                  değiştirebilir.
                </p>
              </div>
              <button
                type="button"
                onClick={closeStudentModal}
                disabled={studentSubmitting}
                aria-label="Kapat"
                className="rounded-lg border border-line p-1.5 text-muted transition hover:border-line-strong hover:bg-surface-raised hover:text-ink-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-muted"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>

            <form
              id="student-create-form"
              onSubmit={handleStudentSubmit}
              className="flex flex-col gap-4 overflow-y-auto px-6 py-5"
            >
              <TextInput
                id="student-full-name"
                name="full_name"
                type="text"
                label="Ad Soyad"
                value={studentForm.full_name}
                onChange={handleStudentFieldChange}
                autoComplete="name"
                required
              />
              <TextInput
                id="student-email"
                name="email"
                type="email"
                label="E-posta"
                value={studentForm.email}
                onChange={handleStudentFieldChange}
                autoComplete="email"
                required
              />
              <TextInput
                id="student-temporary-password"
                name="temporary_password"
                type="text"
                label="Geçici Şifre"
                value={studentForm.temporary_password}
                onChange={handleStudentFieldChange}
                autoComplete="new-password"
                required
              />
              <TextInput
                id="student-phone"
                name="phone"
                type="tel"
                label="Telefon (isteğe bağlı)"
                value={studentForm.phone}
                onChange={handleStudentFieldChange}
                autoComplete="tel"
              />

              {studentFormError ? (
                <p
                  role="alert"
                  className="shrink-0 rounded-xl border border-red-500/40 bg-red-500/15 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {studentFormError}
                </p>
              ) : null}

              {studentFormSuccess ? (
                <p
                  role="status"
                  className="shrink-0 rounded-xl border border-gold/40 bg-gold-soft px-3.5 py-2.5 text-sm text-gold"
                >
                  {studentFormSuccess}
                </p>
              ) : null}
            </form>

            <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-ink-deep/40 px-6 py-4 sm:flex-row sm:justify-end">
              <SecondaryButton
                type="button"
                onClick={closeStudentModal}
                disabled={studentSubmitting}
                className="w-full sm:w-auto"
              >
                İptal
              </SecondaryButton>
              <PrimaryButton
                type="submit"
                form="student-create-form"
                disabled={studentSubmitting}
                className="w-full sm:w-auto"
              >
                {studentSubmitting ? "Oluşturuluyor..." : "Öğrenci Oluştur"}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function toneFor(status: AvailabilityRow["status"]): "gold" | "neutral" {
  return status === "open" ? "gold" : "neutral";
}

function apptTone(status: AppointmentStatus): "gold" | "neutral" {
  if (status === "pending") return "gold";
  return "neutral";
}

function translateInsertError(error: {
  code?: string;
  message?: string;
}): string {
  if (error.code === "23505") {
    return "Bu tarih ve saat aralığı zaten mevcut. Farklı bir tarih veya saat deneyin.";
  }
  if (error.code === "42501") {
    return "Bu işlem için yetkiniz yok. Yalnızca öğretmenler müsaitlik ekleyebilir.";
  }
  if (error.code === "P0003") {
    return "Bitiş saati başlangıç saatinden sonra olmalıdır.";
  }
  return error.message ?? "Müsaitlik kaydedilemedi. Lütfen tekrar deneyin.";
}

function translateStatusError(error: {
  code?: string;
  message?: string;
}): string {
  if (error.code === "P0003") {
    return "Bu durum geçişi geçerli değil. Randevu artık bu işlemi kabul etmiyor olabilir.";
  }
  if (error.code === "42501") {
    return "Bu randevunun durumunu değiştirme yetkiniz yok.";
  }
  return error.message ?? "İşlem gerçekleştirilemedi. Lütfen tekrar deneyin.";
}

const CALENDAR_HOUR_HEIGHT_PX = 56;

function CalendarHourRow({
  hour,
  weekDays,
  blocksByDay,
  selectedCalendarApptId,
  onSelectAppt,
}: {
  hour: number;
  weekDays: string[];
  blocksByDay: Map<string, CalendarBlock[]>;
  selectedCalendarApptId: string | null;
  onSelectAppt: (id: string | null) => void;
}) {
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;

  return (
    <>
      <div
        key={`h-${hour}`}
        className="relative flex items-start justify-end px-1 pt-0.5 text-[0.625rem] text-subtle"
        style={{ height: CALENDAR_HOUR_HEIGHT_PX }}
      >
        {pad2(hour)}:00
      </div>
      {weekDays.map((dayKey) => {
        const dayBlocks = blocksByDay.get(dayKey) ?? [];
        return (
          <div
            key={`${dayKey}-${hour}`}
            className="relative border-t border-line/60"
            style={{ height: CALENDAR_HOUR_HEIGHT_PX }}
          >
            {dayBlocks.map((block) => {
              if (
                block.startMinutes >= hourEnd ||
                block.endMinutes <= hourStart
              ) {
                return null;
              }
              const top =
                ((block.startMinutes - hourStart) / 60) *
                CALENDAR_HOUR_HEIGHT_PX;
              const heightPx =
                ((block.endMinutes - block.startMinutes) / 60) *
                CALENDAR_HOUR_HEIGHT_PX;
              const isSel =
                selectedCalendarApptId != null &&
                block.kind === "appointment" &&
                block.id === `appt:${selectedCalendarApptId}`;
              return (
                <CalendarCell
                  key={block.id}
                  block={block}
                  top={top}
                  heightPx={heightPx}
                  selected={isSel}
                  onSelectAppt={onSelectAppt}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function CalendarCell({
  block,
  top,
  heightPx,
  selected,
  onSelectAppt,
}: {
  block: CalendarBlock;
  top: number;
  heightPx: number;
  selected: boolean;
  onSelectAppt: (id: string | null) => void;
}) {
  if (block.kind === "availability") {
    const isBooked = block.slotStatus === "booked";
    const tonal = isBooked
      ? "border-line-strong/60 bg-line/30 text-muted"
      : "border-gold/40 bg-gold/15 text-gold";
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute left-1 right-1 overflow-hidden rounded-md border ${tonal} ${
          block.past ? "opacity-40" : ""
        }`}
        style={{ top, height: heightPx }}
      >
        <div className="flex h-full items-start px-1.5 py-1">
          <span className="truncate text-[0.625rem] font-medium leading-tight">
            {isBooked ? "" : "Müsait"}
          </span>
        </div>
      </div>
    );
  }

  const appt = block.appt;
  if (!appt) return null;
  const status = block.status ?? "pending";
  const toneClass =
    status === "confirmed"
      ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
      : status === "pending"
        ? "border-gold/60 bg-gold/25 text-gold"
        : status === "completed"
          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
          : "border-red-500/50 bg-red-500/15 text-red-300";
  const selectedClass = selected ? "ring-2 ring-gold/70 ring-offset-0" : "";

  return (
    <button
      type="button"
      onClick={() => onSelectAppt(appt.id)}
      className={`absolute left-1 right-1 overflow-hidden rounded-md border px-1.5 py-1 text-left transition-shadow ${toneClass} ${
        block.past ? "opacity-50" : ""
      } ${selectedClass}`}
      style={{ top, height: heightPx }}
      aria-label={`Randevu: ${appt.student_name?.trim() || "Öğrenci"} - ${
        appt.subject?.trim() || "Konu"
      }`}
    >
      <div className="flex h-full min-w-0 flex-col">
        <span className="truncate text-[0.625rem] font-medium leading-tight">
          {appt.student_name?.trim() || "Öğrenci"}
        </span>
        {heightPx >= 28 ? (
          <span className="truncate text-[0.625rem] leading-tight opacity-80">
            {appt.subject?.trim() || appt.lesson?.trim() || ""}
          </span>
        ) : null}
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Yeni Müsaitlik Ekle — Türkçe tarih ve 24 saat seçiciler                    */
/* -------------------------------------------------------------------------- */

function pickerDayKey(year: number, monthIdx: number, day: number): string {
  const m = String(monthIdx + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/**
 Tarih seçici — Türkçe, Pazartesi başlangıçlı, gg.aa.yyyy gösterim,
 "YYYY-MM-DD" değer. Geçmiş tarihler seçilemez.
*/
function TurkishDatePicker({
  id,
  label,
  value,
  onChange,
  minDayKey,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (dayKey: string) => void;
  minDayKey: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const todayKey = minDayKey;
  const [calendarDayKey, setCalendarDayKey] = useState<string>(
    () =>
      value ??
      pickerDayKey(
        Number(todayKey.slice(0, 4)),
        Number(todayKey.slice(5, 7)) - 1,
        Number(todayKey.slice(8, 10)),
      ),
  );

  function selectMonthDelta(delta: number) {
    const cur = dateOnlyToDate(calendarDayKey);
    if (!cur) return;
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    let ny = y;
    let nm = m + delta;
    if (nm < 0) {
      nm = 11;
      ny -= 1;
    } else if (nm > 11) {
      nm = 0;
      ny += 1;
    }
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    const nd = Math.min(cur.getUTCDate(), last);
    setCalendarDayKey(pickerDayKey(ny, nm, nd));
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const viewDate = dateOnlyToDate(calendarDayKey) ?? new Date();
  const viewYear = viewDate.getUTCFullYear();
  const viewMonth = viewDate.getUTCMonth();

  const daysInMonth = new Date(
    Date.UTC(viewYear, viewMonth + 1, 0),
  ).getUTCDate();

  const firstOfMonthUtc = new Date(Date.UTC(viewYear, viewMonth, 1));
  const firstWeekdayShort =
    new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      weekday: "short",
    }).formatToParts(firstOfMonthUtc).find((p) => p.type === "weekday")
      ?.value ?? "Pzt";
  const shortToMonIdx: Record<string, number> = {
    Pzt: 0,
    Sal: 1,
    Çar: 2,
    Per: 3,
    Cum: 4,
    Cmt: 5,
    Paz: 6,
  };
  const leadingBlanks = shortToMonIdx[firstWeekdayShort] ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-ink-text"
      >
        {label}
      </label>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        className={[
          "w-full rounded-xl border border-line bg-ink px-3.5 py-3 text-left text-sm text-ink-text",
          "transition-colors duration-200 hover:border-line-strong",
          "focus:border-gold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-ink focus:ring-gold/60",
          "min-h-11 touch-manipulation flex items-center justify-between gap-2",
        ].join(" ")}
      >
        <span className={value ? "text-ink-text" : "text-subtle"}>
          {value ? formatDayKeyTr(value) : "gg.aa.yyyy"}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 text-subtle"
        >
          <rect x="3" y="4.5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 2.5v4M16 2.5v4" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={`${label} seç`}
          className="absolute left-0 right-0 z-30 mt-1 rounded-2xl border border-line bg-surface p-3 shadow-2xl shadow-ink-deep/40 sm:right-auto sm:w-72"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => selectMonthDelta(-1)}
              aria-label="Önceki ay"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-line-strong hover:bg-ink/40 hover:text-ink-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-ink-text">
              {MONTH_LABELS_TR[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => selectMonthDelta(1)}
              aria-label="Sonraki ay"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-line-strong hover:bg-ink/40 hover:text-ink-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              ›
            </button>
          </div>

          <div
            className="grid gap-1 text-center"
            style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
          >
            {WEEKDAY_LABELS.map((d) => (
              <div
                key={d}
                className="py-1 text-[0.625rem] font-semibold uppercase tracking-wide text-subtle"
              >
                {d}
              </div>
            ))}

            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`b${i}`} />
            ))}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dayKey = pickerDayKey(viewYear, viewMonth, day);
              const isDisabled = dayKey < todayKey;
              const isSelected = dayKey === value;
              const isToday = dayKey === todayKey;
              return (
                <button
                  key={dayKey}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    onChange(dayKey);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  aria-label={formatDayKeyTr(dayKey)}
                  aria-pressed={isSelected}
                  className={[
                    "h-8 w-full rounded-lg text-xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60",
                    isDisabled
                      ? "cursor-not-allowed text-subtle/40"
                      : "text-ink-text hover:border-line-strong hover:bg-ink/60",
                    isSelected
                      ? "bg-gold font-semibold text-ink"
                      : isToday
                        ? "border border-gold/50 text-gold"
                        : "border border-transparent",
                  ].join(" ")}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 Başlangıç/Bitiş için iki ayrı select: saat (00–23) ve dakika (5 dk adımlarla).
 24 saat, AM/PM yok. Değerler form state'inde ayrı tutulur; HH:mm yukarıda
 buildTime() ile üretilir.
*/
function HourMinutePicker({
  label,
  hourName,
  minuteName,
  hourValue,
  minuteValue,
  onChange,
  ariaInvalid,
  ariaDescribedby,
}: {
  label: string;
  hourName: keyof AvailabilityForm;
  minuteName: keyof AvailabilityForm;
  hourValue: string;
  minuteValue: string;
  onChange: (field: keyof AvailabilityForm, value: string) => void;
  ariaInvalid?: boolean;
  ariaDescribedby?: string;
}) {
  const selectClass = [
    "w-full rounded-xl border border-line bg-ink px-2.5 py-3 text-sm text-ink-text",
    "transition-colors duration-200 hover:border-line-strong",
    "focus:border-gold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-ink focus:ring-gold/60",
    "min-h-11 touch-manipulation",
  ].join(" ");

  return (
    <div
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedby}
    >
      <span className="mb-1.5 block text-sm font-medium text-ink-text">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <select
          aria-label={`${label} saati`}
          value={hourValue}
          onChange={(e) => onChange(hourName, e.target.value)}
          className={selectClass}
        >
          <option value="" disabled>
            SS
          </option>
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="text-sm text-subtle">
          :
        </span>
        <select
          aria-label={`${label} dakikası`}
          value={minuteValue}
          onChange={(e) => onChange(minuteName, e.target.value)}
          className={selectClass}
        >
          <option value="" disabled>
            DD
          </option>
          {MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
