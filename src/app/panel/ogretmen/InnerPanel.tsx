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
  formatWeekday,
  istanbulDayEndMs,
  istanbulDayKeyFromDate,
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
import { NotificationToggleButton } from "@/components/pwa/NotificationToggleButton";

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
  series_id?: string | null;
  recurrence_rule?: "WEEKLY" | null;
  recurrence_end_date?: string | null;
  source_date?: string | null;
};

type FetchState = "loading" | "ready" | "error";

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
  lesson_mode: "online" | "in_person" | null;
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
  bio: string;
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
  repeatWeekly: boolean;
};

const EMPTY_FORM: AvailabilityForm = {
  date: "",
  startHour: "00",
  startMin: "00",
  endHour: "00",
  endMin: "00",
  repeatWeekly: false,
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
  bio: "",
};

export default function OgretmenPanelPage() {
  const router = useRouter();
  const { session, user, loading } = useAuth();
  const [roleLoading, setRoleLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [slots, setSlots] = useState<AvailabilityRow[]>([]);
  const [state, setState] = useState<FetchState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [slotActionId, setSlotActionId] = useState<string | null>(null);
  const [slotActionError, setSlotActionError] = useState<string | null>(null);
  const [slotActionSuccess, setSlotActionSuccess] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteConfirmSeriesId, setDeleteConfirmSeriesId] = useState<string | null>(null);

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [apptState, setApptState] = useState<FetchState>("loading");
  const [apptError, setApptError] = useState<string | null>(null);
  const [apptActionId, setApptActionId] = useState<string | null>(null);
  const [apptActionError, setApptActionError] = useState<string | null>(null);
  const [apptCalendarId, setApptCalendarId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState<number>(0);

  const [activeApptTab, setActiveApptTab] = useState<"pending" | "completed" | "cancelled">("pending");

  const pendingAppointments = useMemo(
    () => appointments.filter((a) => a.status === "pending"),
    [appointments],
  );
  const completedAppointments = useMemo(
    () => appointments.filter((a) => a.status === "completed"),
    [appointments],
  );
  const cancelledAppointments = useMemo(
    () => appointments.filter((a) => a.status === "cancelled"),
    [appointments],
  );

  const pendingCount = pendingAppointments.length;
  const completedCount = completedAppointments.length;
  const cancelledCount = cancelledAppointments.length;

  const filteredAppointments = useMemo(() => {
    switch (activeApptTab) {
      case "pending":
        return pendingAppointments;
      case "completed":
        return completedAppointments;
      case "cancelled":
        return cancelledAppointments;
      default:
        return [];
    }
  }, [activeApptTab, pendingAppointments, completedAppointments, cancelledAppointments]);

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

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 10000);
    return () => {
      window.clearTimeout(id);
    };
  }, [toast]);

  // Auto-dismiss slotActionSuccess after 10 seconds
  useEffect(() => {
    if (!slotActionSuccess) return;
    const id = window.setTimeout(() => setSlotActionSuccess(null), 10000);
    return () => {
      window.clearTimeout(id);
    };
  }, [slotActionSuccess]);

  // Auto-dismiss slotActionError after 10 seconds
  useEffect(() => {
    if (!slotActionError) return;
    const id = window.setTimeout(() => setSlotActionError(null), 10000);
    return () => {
      window.clearTimeout(id);
    };
  }, [slotActionError]);

  // Auto-dismiss apptActionError after 10 seconds
  useEffect(() => {
    if (!apptActionError) return;
    const id = window.setTimeout(() => setApptActionError(null), 10000);
    return () => {
      window.clearTimeout(id);
    };
  }, [apptActionError]);

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
    const todayKey = istanbulTodayKey();
    const { data, error } = await supabase
      .from("availability")
      .select(
        "id, available_date, start_time, end_time, status, series_id, recurrence_rule, recurrence_end_date, source_date, teacher_id",
      )
      .eq("teacher_id", uid)
      .gte("available_date", todayKey)
      .is("deleted_at", null)
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
      let accessToken: string | null = session?.access_token ?? null;
      if (!accessToken) {
        const { data: sessionData } = await supabase.auth.getSession();
        accessToken = sessionData.session?.access_token ?? null;
      }

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
  }, [session]);

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

  const { seriesGroups, singles } = useMemo(() => {
    const groups = new Map<string, AvailabilityRow[]>();
    const singleSlots: AvailabilityRow[] = [];
    for (const slot of slots) {
      const isSeries = Boolean(
        slot.recurrence_rule === "WEEKLY" && slot.series_id,
      );
      if (!isSeries) {
        singleSlots.push(slot);
        continue;
      }
      const key = seriesGroupKey(slot);
      const arr = groups.get(key) ?? [];
      arr.push(slot);
      groups.set(key, arr);
    }
    const seriesGroupsArr = Array.from(groups.entries()).map(
      ([key, groupSlots]) => {
        const first = groupSlots[0];
        const todayKey = istanbulTodayKey();
        const upcoming =
          groupSlots.find((s) => s.available_date >= todayKey) ??
          groupSlots[0];
        const wd = weekdayIndexOf(first.source_date ?? first.available_date);
        let cancelSlot: AvailabilityRow | null = null;
        if (wd !== null) {
          const weekStart = istanbulStartOfWeekMonday(new Date());
          const targetKey = istanbulDayKeyFromDate(addDays(weekStart, wd));
          if (targetKey >= todayKey) {
            cancelSlot =
              groupSlots.find((s) => s.available_date === targetKey) ?? null;
          }
        }
        const statusOrder: AvailabilityRow["status"][] = [
          "open",
          "booked",
          "blocked",
        ];
        const statusCounts = new Map<AvailabilityRow["status"], number>();
        for (const s of groupSlots) {
          statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);
        }
        const groupStatus =
          statusCounts.size === 1
            ? (groupSlots[0].status as AvailabilityRow["status"])
            : statusOrder.find((st) => statusCounts.has(st)) ??
              (groupSlots[0].status as AvailabilityRow["status"]);
        return {
          key,
          repSlot: upcoming,
          cancelSlot,
          groupStatus,
          count: groupSlots.length,
          firstSlot: first,
        };
      },
    );
    return { seriesGroups: seriesGroupsArr, singles: singleSlots };
  }, [slots]);

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

  async function handleDeleteSlot(slot: AvailabilityRow, confirmed = false) {
    if (!user) return;

    const isSeries = Boolean(slot.recurrence_rule === "WEEKLY" && slot.series_id);

    if (isSeries && !confirmed) {
      setDeleteConfirmSeriesId(slot.series_id!);
      return;
    }

    setSlotActionId(slot.id);
    setSlotActionError(null);
    setSlotActionSuccess(null);
    setDeleteConfirmSeriesId(null);
    setToast(null);
    setApptActionError(null);

    try {
      let result: { success: boolean; error?: string; message?: string; error_code?: string };

      if (isSeries) {
        const { data, error } = await supabase.rpc("delete_availability_series", {
          p_series_id: slot.series_id!,
          p_teacher_id: user.id,
        });

        if (error) throw error;
        result = data as typeof result;
      } else {
        const { data, error } = await supabase.rpc("delete_availability_slot", {
          p_slot_id: slot.id,
          p_teacher_id: user.id,
        });

        if (error) throw error;
        result = data as typeof result;
      }

      setSlotActionId(null);

      if (!result.success) {
        const errMsg = result.error ?? "Bilinmeyen hata";
        setSlotActionError(
          isSeries
            ? "Haftalık tekrar silinemedi: " + errMsg
            : "Müsaitlik silinemedi: " + errMsg,
        );
        setToast("Silme işlemi başarısız: " + errMsg);
        return;
      }

      setSlotActionSuccess(
        isSeries
          ? "Haftalık tekrar serisi başarıyla silindi."
          : "Müsaitlik başarıyla silindi.",
      );
      setToast(
        isSeries
          ? "Haftalık tekrar serisi başarıyla silindi."
          : "Müsaitlik başarıyla silindi.",
      );
      await fetchSlots(user.id);
    } catch (error: unknown) {
      setSlotActionId(null);
      const errMsg = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
      setSlotActionError(
        isSeries
          ? "Haftalık tekrar silinemedi: " + errMsg
          : "Müsaitlik silinemedi: " + errMsg,
      );
      setToast("Silme işlemi başarısız: " + errMsg);
    }
  }

  async function handleCancelSlotDay(slot: AvailabilityRow) {
    if (!user) return;
    setSlotActionId(slot.id);
    setSlotActionError(null);
    setSlotActionSuccess(null);
    setToast(null);
    setApptActionError(null);

    const { error } = await supabase
      .from("availability_overrides")
      .upsert(
        {
          teacher_id: user.id,
          series_id: slot.series_id!,
          override_date: slot.available_date,
          action: "cancel",
          start_time: null,
          end_time: null,
        },
        { onConflict: "series_id,override_date" },
      );

    setSlotActionId(null);

    if (error) {
      setSlotActionError(translateOverrideError(error));
      return;
    }

    setSlotActionSuccess(
      `${formatDateLong(slot.available_date)} tarihi için bu haftanın günü iptal edildi. ` +
        "Öğrenciler bu günü artık göremez; serinin diğer haftaları devam ediyor.",
    );
    await fetchSlots(user.id);
  }

  async function updateAppointmentStatus(
    appt: AppointmentRow,
    nextStatus: AppointmentStatus,
  ) {
    if (!user) return;
    setApptActionId(appt.id);
    setApptActionError(null);
    setSlotActionError(null);
    setSlotActionSuccess(null);
    setToast(null);

    const { error } = await supabase
      .from("appointments")
      .update({ status: nextStatus })
      .eq("id", appt.id);

    setApptActionId(null);

    if (error) {
      setApptActionError(translateStatusError(error));
      return;
    }

    // Send push notification to student (fire and forget)
    let notificationType: "booking_confirmed" | "booking_rejected" | "booking_cancelled_by_teacher" | "booking_completed" | null = null;
    if (nextStatus === "confirmed" && appt.status === "pending") {
      notificationType = "booking_confirmed";
    } else if (nextStatus === "cancelled" && appt.status === "pending") {
      notificationType = "booking_rejected";
    } else if (nextStatus === "cancelled" && appt.status === "confirmed") {
      notificationType = "booking_cancelled_by_teacher";
    } else if (nextStatus === "completed" && appt.status === "confirmed") {
      notificationType = "booking_completed";
    }

    if (notificationType) {
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
            type: notificationType,
          }),
        }).catch((err) => {
          console.error("[Push] Failed to send appointment notification:", err);
        });
      }
    }

    await fetchAppointments(user.id);
    await fetchSlots(user.id);
  }

  function updateField(field: string, value: string) {
    console.log("[TurkishDatePicker] onChange/updateField", { field, value, formDate: form.date });
    setForm((p) => ({ ...p, [field]: value }));
    setFormErrors((p) => ({ ...p, [field]: "" }));
    setSubmitError(null);
  }

  function updateRepeatWeekly(value: boolean) {
    setForm((p) => ({ ...p, repeatWeekly: value }));
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
    setSlotActionError(null);
    setSlotActionSuccess(null);
    setApptActionError(null);
    setToast(null);

    const todayKey = istanbulTodayKey();
    if (form.date < todayKey) {
      setSubmitting(false);
      setSubmitError("Geçmiş bir tarih için müsaitlik eklenemez.");
      return;
    }

    if (form.repeatWeekly) {
      const seriesId = crypto.randomUUID();
      const recurrenceEndDate = istanbulDayKeyFromDate(
        addDays(dateOnlyToDate(form.date)!, 7 * 51),
      );

      const { data: allSlots, error: fetchError } = await supabase
        .from("availability")
        .select(
          "id, available_date, start_time, end_time, status, series_id, recurrence_rule",
        )
        .eq("teacher_id", user.id)
        .is("deleted_at", null);
      if (fetchError) {
        setSubmitting(false);
        setSubmitError(
          fetchError.message ??
            "Mevcut müsaitlikler sorgulanamadı. Lütfen tekrar deneyin.",
        );
        return;
      }

      const allRows = (allSlots ?? []) as AvailabilityRow[];
      const occurrences: string[] = [];
      const base = dateOnlyToDate(form.date);
      if (!base) {
        setSubmitting(false);
        setSubmitError("Geçersiz tarih.");
        return;
      }
      const endBoundary = dateOnlyToDate(recurrenceEndDate) ?? base;
      for (
        let d = base;
        d.getTime() <= endBoundary.getTime();
        d = addDays(d, 7)
      ) {
        occurrences.push(istanbulDayKeyFromDate(d));
      }

      for (const occDate of occurrences) {
        const clash = allRows.find(
          (slot) =>
            slot.available_date === occDate &&
            startTime < slot.end_time &&
            endTime > slot.start_time,
        );
        if (clash) {
          setSubmitting(false);
          setSubmitError(
            `Bu saat aralığı mevcut bir müsaitliğinizle çakışıyor ` +
              `(${occDate}). Lütfen saati değiştirin ya da önce o günün ` +
              `müsaitliğini kaldırın.`,
          );
          return;
        }
      }

      const rowsToInsert = occurrences.map((occDate) => ({
        teacher_id: user.id,
        available_date: occDate,
        start_time: startTime,
        end_time: endTime,
        status: "open" as const,
        series_id: seriesId,
        recurrence_rule: "WEEKLY" as const,
        recurrence_end_date: recurrenceEndDate,
        source_date: form.date,
      }));

      const { error: insertError } = await supabase
        .from("availability")
        .insert(rowsToInsert);

      setSubmitting(false);

      if (insertError) {
        setSubmitError(translateInsertError(insertError));
        return;
      }

      setForm(EMPTY_FORM);
      setFormErrors({});
      await fetchSlots(user.id);
      return;
    }

    const { data: existingSlots, error: fetchError } = await supabase
      .from("availability")
      .select("id, available_date, start_time, end_time, status")
      .eq("teacher_id", user.id)
      .eq("available_date", form.date)
      .is("deleted_at", null);
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
      source_date: form.date,
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
    <main className="flex min-h-dvh flex-col px-4 sm:px-6 py-6 sm:py-8 portrait-padding">
      <div className="w-full max-w-4xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between portrait-flex-wrap portrait-gap-3">
          <SectionTitle
            align="left"
            eyebrow="Öğretmen Paneli"
            title="Müsaitlik Takvimi"
            description="Uygun ders saatlerinizi ekleyin ve mevcut kayıtlarınızı görüntüleyin."
          />
          <div className="flex items-center gap-2 sm:gap-3">
            <NotificationToggleButton showLabel={false} compact />
            <div
              ref={notificationsDropdownRef}
              className="relative w-full sm:w-auto self-start"
            >
              <button
                type="button"
                aria-label="Bildirimler"
                aria-expanded={isNotificationsOpen}
                aria-haspopup="true"
                onClick={() => setIsNotificationsOpen((p) => !p)}
                className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl border border-border bg-surface text-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-yellow-500/60"
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
                className="fixed left-4 right-4 top-20 z-50 sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[360px] sm:max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/40 backdrop-blur-sm dropdown-mobile dropdown-portrait"
              >
                <div className="flex items-center justify-between gap-3 border-b border-border bg-surface/60 px-4 py-3">
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">
                    Bildirimler
                  </h2>
                  {unreadCount > 0 ? (
                    <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-semibold text-yellow-500">
                      {unreadCount}
                    </span>
                  ) : null}
                </div>

                <div className="max-h-[60vh] overflow-y-auto sm:max-h-[420px]">
                  {notificationsLoading ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      Bildirimler yükleniyor...
                    </p>
                  ) : notificationsError ? (
                    <p
                      role="alert"
                      className="px-4 py-4 text-sm text-red-400"
                    >
                      {notificationsError}
                    </p>
                  ) : notifications.length === 0 ? (
                    <p className="px-4 py-6 text-sm leading-relaxed text-muted-foreground">
                      Henüz bildiriminiz yok.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {notifications.map((n) => (
                        <li
                          key={n.id}
                          className="flex items-start gap-2.5 px-4 py-3 transition-colors duration-150"
                        >
                          <span
                            aria-hidden="true"
                            className={[
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              n.ok ? "bg-subtle" : "bg-yellow-500",
                            ].join(" ")}
                          />
                          <div className="flex flex-1 flex-col gap-0.5">
                            <span
                              className={[
                                "text-sm text-foreground",
                                n.ok
                                  ? "font-normal"
                                  : "font-semibold",
                              ].join(" ")}
                            >
                              {n.title?.trim() || "Bildirim"}
                            </span>
                            {n.body && n.body.trim() ? (
                              <span className="text-xs leading-relaxed text-muted-foreground">
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
        </div>

        <Card className="overflow-hidden" padding="snug">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Öğrenci Yönetimi
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
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

        <Card className="overflow-hidden" padding="snug">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Öğrencilerim
            </h2>
            {studentsState === "ready" ? (
              <Badge tone="neutral">{students.length} kayıt</Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {studentsState === "loading" ? (
              <p className="text-sm text-muted-foreground text-center py-8">Öğrenciler yükleniyor…</p>
            ) : studentsState === "error" ? (
              <p
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
              >
                {studentsError ?? "Öğrenci listesi yüklenemedi."}
              </p>
            ) : students.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted-foreground text-center py-8">
                Henüz bağlı öğrenciniz yok.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {students.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/panel/ogretmen/ogrenciler/${s.id}`}
                      className="flex cursor-pointer flex-col gap-1 rounded-lg px-3 py-3 transition-colors hover:bg-surface/50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {s.full_name?.trim() || "Belirtilmedi"}
                        </span>
                        {s.phone?.trim() ? (
                          <span className="text-xs text-muted-foreground">
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

        <Card className="overflow-visible" padding="snug">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Yeni Müsaitlik Ekle</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
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

          <label
            htmlFor="repeat-weekly"
            className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-surface/50 p-4 cursor-pointer transition-colors duration-200 hover:border-yellow-500/50"
          >
            <input
              id="repeat-weekly"
              type="checkbox"
              checked={form.repeatWeekly}
              onChange={(e) => updateRepeatWeekly(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-yellow-500"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                Her hafta aynı gün ve saatte tekrarla
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Seçilen gün ve saat, siz kaldırana kadar her hafta tekrarlanır.
              </span>
            </span>
          </label>

          {submitError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
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

<Card className="overflow-hidden" padding="snug">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Haftalık Takvim
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {formatCalendarWeekRange(weekStart, addDays(weekStart, 6))}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <SecondaryButton
                onClick={() => setWeekOffset((o) => o - 1)}
                className="px-3 py-1.5 text-xs sm:px-4 sm:py-2"
                aria-label="Önceki hafta"
              >
                ‹ Önceki
              </SecondaryButton>
              <SecondaryButton
                onClick={() => setWeekOffset(0)}
                className="px-3 py-1.5 text-xs sm:px-4 sm:py-2"
                aria-label="Bu hafta"
              >
                Bugün
              </SecondaryButton>
              <SecondaryButton
                onClick={() => setWeekOffset((o) => o + 1)}
                className="px-3 py-1.5 text-xs sm:px-4 sm:py-2"
                aria-label="Sonraki hafta"
              >
                Sonraki ›
              </SecondaryButton>
            </div>
          </div>

          <div className="mt-5">
            <div className="grid gap-2 sm:grid-cols-7 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0">
              {weekDays.map((dayKey, idx) => {
                const isToday = isTodayKey(dayKey);
                const dayDate = dateOnlyToDate(dayKey);
                const dayNum = dayDate
                  ? Number(new Intl.DateTimeFormat("tr-TR", {
                      timeZone: "Europe/Istanbul",
                      day: "numeric",
                    }).format(dayDate))
                  : idx + 1;
                const dayShort = dayDate
                  ? new Intl.DateTimeFormat("tr-TR", {
                      timeZone: "Europe/Istanbul",
                      weekday: "short",
                    }).format(dayDate)
                  : "";
                const blocks = blocksByDay.get(dayKey) ?? [];
                const visibleBlocks = blocks.slice(0, 3);
                const hiddenCount = blocks.length - 3;

                return (
                  <div
                    key={dayKey}
                    className={[
                      "relative flex flex-col min-h-[110px] rounded-xl border border-border bg-card p-2.5 sm:p-3 transition-colors",
                      isToday ? "border-yellow-500/50 bg-yellow-500/5 ring-1 ring-yellow-500/20" : "",
                    ].join(" ")}
                  >
                    <div className="flex flex-col items-start gap-1 mb-2">
                      <span className="text-lg font-bold text-foreground sm:text-xl">
                        {dayNum}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {dayShort}
                      </span>
                      {isToday && (
                        <Badge tone="gold" className="text-[0.6rem]">
                          Bugün
                        </Badge>
                      )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
                      {blocks.length === 0 ? (
                        <p className="text-xs text-muted-foreground/50 text-center py-2">
                          —
                        </p>
                      ) : (
                        <>
                          {visibleBlocks.map((block) => (
                            <CalendarBlockElement
                              key={block.id}
                              block={block}
                              onSlotClick={() => {
                                if (block.kind === "availability") {
                                }
                              }}
                              onApptClick={() => setApptCalendarId(block.appt?.id ?? null)}
                            />
                          ))}
                          {hiddenCount > 0 && (
                            <button
                              type="button"
                              className="w-full text-xs text-muted-foreground/60 hover:text-foreground py-1"
                              disabled
                            >
                              +{hiddenCount} daha
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {selectedCalendarAppt ? (
          <AppointmentDetailCard
            appt={selectedCalendarAppt}
            onClose={() => setApptCalendarId(null)}
            onUpdateStatus={updateAppointmentStatus}
            apptActionId={apptActionId}
          />
        ) : null}

        {slotActionError ? (
          <Card className="overflow-hidden border-red-500/30 bg-red-500/10" padding="snug">
            <p role="alert" className="text-sm text-red-400">
              {slotActionError}
            </p>
          </Card>
        ) : null}
        {slotActionSuccess ? (
          <Card className="overflow-hidden border-green-500/30 bg-green-500/10" padding="snug">
            <p role="status" className="text-sm text-green-400">
              {slotActionSuccess}
            </p>
          </Card>
        ) : null}

        {apptActionError ? (
          <Card className="overflow-hidden border-red-500/30 bg-red-500/10" padding="snug">
            <p role="alert" className="text-sm text-red-400">
              {apptActionError}
            </p>
          </Card>
        ) : null}

        {/* Randevular */}
        <Card className="overflow-hidden" padding="snug">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Randevular</h2>
          </div>

          <div className="mt-4 flex border-b border-border">
            <button
              onClick={() => setActiveApptTab("pending")}
              className={`flex-1 py-3 px-4 text-sm font-semibold transition-colors duration-200 border-b-2 border-transparent text-center whitespace-nowrap
                ${activeApptTab === "pending"
                  ? "border-yellow-500 text-foreground"
                  : "text-muted-foreground hover:text-foreground"}`}
            >
              Onay Bekleyenler ({pendingCount})
            </button>
            <button
              onClick={() => setActiveApptTab("completed")}
              className={`flex-1 py-3 px-4 text-sm font-semibold transition-colors duration-200 border-b-2 border-transparent text-center whitespace-nowrap
                ${activeApptTab === "completed"
                  ? "border-yellow-500 text-foreground"
                  : "text-muted-foreground hover:text-foreground"}`}
            >
              Tamamlananlar ({completedCount})
            </button>
            <button
              onClick={() => setActiveApptTab("cancelled")}
              className={`flex-1 py-3 px-4 text-sm font-semibold transition-colors duration-200 border-b-2 border-transparent text-center whitespace-nowrap
                ${activeApptTab === "cancelled"
                  ? "border-yellow-500 text-foreground"
                  : "text-muted-foreground hover:text-foreground"}`}
            >
              İptal Edilenler ({cancelledCount})
            </button>
          </div>

          <div className="mt-5">
            {apptState === "loading" ? (
              <p className="text-sm text-muted-foreground text-center py-8">Yükleniyor...</p>
            ) : apptState === "error" ? (
              <div className="flex flex-col gap-3 text-center py-4">
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {apptError ?? "Randevular yüklenemedi."}
                </p>
                <SecondaryButton onClick={() => fetchAppointments(user.id)} className="w-full sm:w-auto mx-auto">
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : filteredAppointments.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted-foreground text-center py-8">
                {activeApptTab === "pending"
                  ? "Onay bekleyen randevu bulunmuyor."
                  : activeApptTab === "completed"
                  ? "Tamamlanmış randevu bulunmuyor."
                  : "İptal edilmiş randevu bulunmuyor."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {filteredAppointments.map((appt) => {
                  const info = appointmentDisplayInfo(appt);
                  const isCancellable = appt.status === "pending" || appt.status === "confirmed";
                  const isBusy = apptActionId === appt.id;
                  return (
                    <li key={appt.id} className="py-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex-1 min-w-0">
                          {appt.lesson && (
                            <span className="text-xs font-medium text-muted-foreground">
                              Ders: {appt.lesson}
                            </span>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <h3 className="text-lg font-bold text-foreground">
                              {appt.subject?.trim() || "Konu belirtilmedi"}
                            </h3>
                            <Badge tone={appt.status === "pending" ? "gold" : appt.status === "confirmed" ? "neutral" : appt.status === "cancelled" ? "neutral" : "neutral"}>
                              {APPT_STATUS_LABEL[appt.status]}
                            </Badge>
                          </div>
                          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">Öğrenci:</span>
                              <span>{appt.student_name ?? "Belirtilmedi"}</span>
                            </div>
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
                            {appt.notes && appt.notes.trim() && (
                              <div className="flex items-start gap-2">
                                <span className="font-medium text-foreground mt-0.5">Not:</span>
                                <span className="text-muted-foreground">{appt.notes.trim()}</span>
                              </div>
                            )}
                          </div>
                        </div>

{(appt.status === "pending" || appt.status === "confirmed") && (
                          <div className="mt-4 shrink-0 w-full sm:w-auto flex flex-col gap-2 sm:flex-row">
                            {appt.status === "pending" && (
                              <div>
                                <PrimaryButton
                                  onClick={() => updateAppointmentStatus(appt, "confirmed")}
                                  disabled={apptActionId === appt.id}
                                  className="w-full sm:w-auto"
                                >
                                  {apptActionId === appt.id ? "Onaylanıyor..." : "Onayla"}
                                </PrimaryButton>
                                <SecondaryButton
                                  onClick={() => updateAppointmentStatus(appt, "cancelled")}
                                  disabled={apptActionId === appt.id}
                                  className="w-full sm:w-auto border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                >
                                  {apptActionId === appt.id ? "İptal ediliyor..." : "Reddet"}
                                </SecondaryButton>
                              </div>
                            )}
                            {appt.status === "confirmed" && (
                              <PrimaryButton
                                onClick={() => updateAppointmentStatus(appt, "completed")}
                                disabled={apptActionId === appt.id}
                                className="w-full sm:w-auto"
                              >
                                {apptActionId === appt.id ? "Tamamlanıyor..." : "Tamamlandı Olarak İşaretle"}
                              </PrimaryButton>
                            )}
                          </div>
                        )}
                      </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </Card>

        {/* Müsaitliklerim */}
        <Card className="overflow-hidden" padding="snug">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Müsaitliklerim</h2>
            {state === "ready" && (
              <Badge tone="neutral">{slots.length} kayıt</Badge>
            )}
          </div>

          <div className="mt-5">
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground text-center py-8">Yükleniyor...</p>
            ) : state === "error" ? (
              <div className="flex flex-col gap-3 text-center py-4">
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {errorMsg ?? "Müsaitlikler yüklenemedi."}
                </p>
                <SecondaryButton onClick={handleRetry} className="w-full sm:w-auto mx-auto">
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : slots.length === 0 && seriesGroups.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted-foreground text-center py-8">
                Henüz oluşturulmuş bir müsaitliğiniz bulunmuyor.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {singles.map((slot) => {
                  const isPast = slot.status === "blocked" || (slot.status === "open" && slot.available_date < istanbulTodayKey());
                  return (
                    <li key={slot.id} className="py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {formatDateLong(slot.available_date)} · {formatWeekday(slot.available_date)}
                            </span>
                            <Badge tone={slot.status === "open" ? "gold" : slot.status === "booked" ? "neutral" : "neutral"}>
                              {slot.status === "open" ? "Müsait" : slot.status === "booked" ? "Dolu" : "Kapalı"}
                            </Badge>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{formatTime(slot.start_time)} – {formatTime(slot.end_time)}</span>
                          </div>
                        </div>
                        <div className="mt-3 shrink-0 w-full sm:w-auto flex flex-col gap-2 sm:flex-row">
                          <SecondaryButton
                            onClick={() => handleDeleteSlot(slot)}
                            disabled={slotActionId === slot.id}
                            className="w-full sm:w-auto border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          >
                            {slotActionId === slot.id ? "Siliniyor..." : "Sil"}
                          </SecondaryButton>
                        </div>
                      </div>
                    </li>
                  );
                })}
                {seriesGroups.map((group) => {
                  const firstSlot = group.firstSlot;
                  const todayKey = istanbulTodayKey();
                  // Find the next upcoming occurrence in this series (first slot with available_date >= today)
                  const seriesSlots = slots.filter((s) => s.series_id === firstSlot.series_id);
                  const nextOccurrence = seriesSlots
                    .filter((s) => s.available_date >= todayKey)
                    .sort((a, b) => a.available_date.localeCompare(b.available_date))[0] ?? null;
                  return (
                    <li key={group.key} className="py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground">
                              {formatWeekday(firstSlot.source_date ?? firstSlot.available_date)}
                            </span>
                            <Badge tone="gold" className="text-xs">
                              Her hafta tekrar
                            </Badge>
                            <Badge tone={firstSlot.status === "open" ? "gold" : firstSlot.status === "booked" ? "neutral" : "neutral"}>
                              {firstSlot.status === "open" ? "Müsait" : firstSlot.status === "booked" ? "Dolu" : "Kapalı"}
                            </Badge>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{formatTime(firstSlot.start_time)} – {formatTime(firstSlot.end_time)}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Başlangıç:</span>
                            <span>{formatDateLong(firstSlot.source_date ?? firstSlot.available_date)}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Gelecek tekrar sayısı:</span>
                            <span>{group.count} hafta</span>
                          </div>
                        </div>
                        <div className="mt-3 shrink-0 w-full sm:w-auto flex flex-col gap-2 sm:flex-row">
                          {nextOccurrence ? (
                            <>
                              <SecondaryButton
                                onClick={() => handleCancelSlotDay(nextOccurrence)}
                                disabled={slotActionId === nextOccurrence.id}
                                className="w-full sm:w-auto"
                              >
                                {slotActionId === nextOccurrence.id ? "İptal ediliyor..." : "Bu Haftayı İptal Et"}
                              </SecondaryButton>
                            </>
                          ) : (
                            <SecondaryButton
                              disabled
                              className="w-full sm:w-auto opacity-50"
                            >
                              Gelecek müsaitlik yok
                            </SecondaryButton>
                          )}
                          <SecondaryButton
                            onClick={() => handleDeleteSlot(firstSlot, false)}
                            disabled={slotActionId === firstSlot.id}
                            className="w-full sm:w-auto border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          >
                            {slotActionId === firstSlot.id ? "Siliniyor..." : "Tüm Seriyi Sil"}
                          </SecondaryButton>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {apptActionError ? (
          <Card className="overflow-hidden border-red-500/30 bg-red-500/10" padding="snug">
            <p role="alert" className="text-sm text-red-400">
              {apptActionError}
            </p>
          </Card>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <SecondaryButton
            onClick={() => router.push("/panel/ogretmen")}
            className="w-full sm:w-auto"
          >
            Menüye Dön
          </SecondaryButton>
          <PrimaryButton onClick={handleSignOut} className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white focus-visible:ring-red-500">
            Çıkış Yap
          </PrimaryButton>
        </div>

        {studentModalOpen ? (
          <StudentModal
            open={studentModalOpen}
            onClose={closeStudentModal}
            onSubmit={handleStudentSubmit}
            form={studentForm}
            formError={studentFormError}
            formSuccess={studentFormSuccess}
            submitting={studentSubmitting}
            onFieldChange={handleStudentFieldChange}
            panelRef={studentModalPanelRef}
          />
        ) : null}

        {deleteConfirmSeriesId ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          >
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
              <h3 id="delete-confirm-title" className="text-lg font-semibold text-foreground">
                Tüm Seriyi Sil
              </h3>
              <p className="mt-3 text-sm text-muted-foreground">
                Bu haftalık tekrar serisine ait <strong>tüm müsaitlik kayıtları</strong>
                kalıcı olarak silinecek. Bu işlem geri alınamaz.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SecondaryButton
                  onClick={() => setDeleteConfirmSeriesId(null)}
                  className="w-full sm:w-auto"
                >
                  İptal
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => {
                    handleDeleteSlot(
                      {
                        id: "",
                        series_id: deleteConfirmSeriesId!,
                        recurrence_rule: "WEEKLY",
                        available_date: "",
                        start_time: "",
                        end_time: "",
                        status: "open",
                        teacher_id: user.id,
                      } as AvailabilityRow,
                      true,
                    );
                  }}
                  className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white"
                >
                  Evet, Tümünü Sil
                </PrimaryButton>
              </div>
            </div>
          </div>
        ) : null}

        {toast ? (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-sm text-green-400 shadow-lg"
          >
            {toast}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function TurkishDatePicker({
  id,
  label,
  value,
  onChange,
  minDayKey,
  ariaInvalid,
  ariaDescribedby,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  minDayKey: string;
  ariaInvalid?: boolean;
  ariaDescribedby?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const base = value ? dateOnlyToDate(value) : istanbulTodayStart();
    if (!base) return new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const clickedInput = inputRef.current?.contains(event.target as Node);
      const clickedPopover = popoverRef.current?.contains(event.target as Node);
      console.log("[TurkishDatePicker] OUTSIDE CLICK", { clickedInput, clickedPopover, target: event.target });
      if (!clickedInput && !clickedPopover) {
        console.log("[TurkishDatePicker] CLOSING POPUP via outside click");
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const monthNames = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
  ];

  const weekdayNames = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

  const todayKey = istanbulTodayKey();

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayIndex = (currentMonth.getDay() + 6) % 7;

  const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);

  function handleDayClick(day: number) {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const key = istanbulDayKeyFromDate(date);
    console.log("[TurkishDatePicker] CALENDAR ONSELECT", { day, date, key, value, minDayKey });
    onChange(key);
    console.log("[TurkishDatePicker] SELECTED DATE STATE", { newValue: key });
    setIsOpen(false);
  }

  function handleTodayClick() {
    const key = todayKey;
    console.log("[TurkishDatePicker] TODAY CLICK", { key });
    onChange(key);
    setIsOpen(false);
  }

  function handleClearClick() {
    console.log("[TurkishDatePicker] CLEAR CLICK");
    onChange("");
    setIsOpen(false);
  }

  function handlePrevMonth() {
    setCurrentMonth(prevMonth);
  }

  function handleNextMonth() {
    setCurrentMonth(nextMonth);
  }

  function formatDisplay(dateKey: string | null): string {
    if (!dateKey) return "";
    const date = dateOnlyToDate(dateKey);
    if (!date) return "";
    return new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  return (
    <div className="flex flex-col gap-1.5 relative">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          readOnly
          value={formatDisplay(value)}
          placeholder="gg.aa.yyyy"
          onClick={() => setIsOpen(true)}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 touch-manipulation disabled:opacity-60 cursor-pointer"
        />
        {isOpen && (
          <div
            ref={popoverRef}
            className="absolute left-0 top-full mt-1 z-50 w-full max-w-xs bg-surface border border-border rounded-xl shadow-xl p-4"
            role="dialog"
            aria-label="Tarih seçici"
          >
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 rounded-lg hover:bg-border transition-colors"
                aria-label="Önceki ay"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <span className="text-sm font-semibold text-foreground">
                {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </span>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 rounded-lg hover:bg-border transition-colors"
                aria-label="Sonraki ay"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs text-muted-foreground">
              {weekdayNames.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDayIndex }, (_, i) => (
                <div key={`empty-${i}`} className="aspect-square" />
              ))}
{Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
                const key = istanbulDayKeyFromDate(date);
                const isToday = Boolean(key === todayKey);
                const isSelected = key === value;
                const isDisabled = Boolean(minDayKey && key < minDayKey);
                console.log("[TurkishDatePicker] DAY RENDER", { day, key, isToday, isSelected, isDisabled, minDayKey, date: date.toISOString() });
                return (
                  <button
                    key={key}
                    type="button"
                    onPointerDown={(e) => console.log("[TurkishDatePicker] DAY POINTER DOWN", { day, key, disabled: isDisabled })}
                    onClick={(e) => {
                      console.log("[TurkishDatePicker] DAY CLICK", { day, key, disabled: isDisabled });
                      if (!isDisabled) handleDayClick(day);
                    }}
                    disabled={isDisabled}
                    className={`aspect-square rounded-lg text-sm font-medium transition-all duration-150 ease-out ${
                      isDisabled
                        ? "text-muted-foreground/30 cursor-not-allowed"
                        : isSelected
                        ? "bg-yellow-500 text-white hover:bg-yellow-500 hover:text-white"
                        : isToday
                        ? "bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 hover:border-yellow-500/50 hover:bg-yellow-500/30 hover:shadow-[0_0_0_2px_theme(colors.yellow.500)]"
                        : "text-foreground hover:bg-border hover:border-yellow-500/50 hover:shadow-[0_0_0_2px_theme(colors.yellow.500)]"
                    }`}
                    aria-selected={isSelected}
                    aria-current={isToday === true ? "date" : undefined}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <button
                type="button"
                onClick={handleClearClick}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Temizle
              </button>
              <button
                type="button"
                onClick={handleTodayClick}
                className="text-xs font-semibold text-yellow-500 hover:text-yellow-400 transition-colors"
              >
                Bugün
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  hourName: string;
  minuteName: string;
  hourValue: string;
  minuteValue: string;
  onChange: (field: string, value: string) => void;
  ariaInvalid?: boolean;
  ariaDescribedby?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="flex gap-2">
        <select
          name={hourName}
          value={hourValue}
          onChange={(e) => onChange(hourName, e.target.value)}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          className="w-[70px] flex-1 rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 touch-manipulation disabled:opacity-60"
        >
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="flex items-center text-foreground mx-1">:</span>
        <select
          name={minuteName}
          value={minuteValue}
          onChange={(e) => onChange(minuteName, e.target.value)}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          className="w-[70px] flex-1 rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 touch-manipulation disabled:opacity-60"
        >
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

function CalendarBlockElement({
  block,
  onSlotClick,
  onApptClick,
}: {
  block: CalendarBlock;
  onSlotClick: () => void;
  onApptClick: () => void;
}) {
  const startStr = minutesToTime(block.startMinutes);
  const endStr = minutesToTime(block.endMinutes);
  const isPast = block.past;
  const isAppointment = block.kind === "appointment";

  const baseClasses =
    "text-xs rounded-lg px-2 py-1.5 truncate transition-colors cursor-pointer hover:bg-yellow-500/10";
  const statusColor =
    block.kind === "availability"
      ? block.slotStatus === "open"
        ? "bg-green-500/20 text-green-400 border-green-500/30"
        : block.slotStatus === "booked"
        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
        : "bg-red-500/20 text-red-400 border-red-500/30"
      : APPT_STATUS_CALENDAR_TONE[block.status!] === "gold"
      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
      : "bg-gray-500/20 text-gray-400 border-gray-500/30";

  const pastOverlay = isPast ? "opacity-50" : "";

  return (
    <button
      type="button"
      onClick={isAppointment ? onApptClick : onSlotClick}
      disabled={isPast}
      className={`${baseClasses} ${statusColor} border ${pastOverlay}`}
      aria-label={
        isAppointment
          ? `Randevu: ${startStr}–${endStr}`
          : `Müsaitlik: ${startStr}–${endStr}`
      }
    >
      {startStr}–{endStr}
    </button>
  );
}

function AppointmentDetailCard({
  appt,
  onClose,
  onUpdateStatus,
  apptActionId,
}: {
  appt: AppointmentRow;
  onClose: () => void;
  onUpdateStatus: (appt: AppointmentRow, nextStatus: AppointmentStatus) => Promise<void>;
  apptActionId: string | null;
}) {
  const info = appointmentDisplayInfo(appt);

  return (
    <Card className="overflow-hidden border-yellow-500/30 bg-yellow-500/5" padding="snug">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground">Randevu Detayı</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {info.date ? formatDateLong(info.date) : "Tarih belirtilmemiş"} ·
            {info.startTime && info.endTime
              ? `${formatTime(info.startTime)} – ${formatTime(info.endTime)}`
              : info.startTime
              ? `${formatTime(info.startTime)} – ?`
              : "Saat belirtilmemiş"}
          </p>
        </div>
        <SecondaryButton
          onClick={onClose}
          className="w-full sm:w-auto"
        >
          Kapat
        </SecondaryButton>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Öğrenci</p>
          <p className="mt-1 font-medium text-foreground">{appt.student_name ?? "Belirtilmedi"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Durum</p>
          <p className="mt-1">
            <Badge tone={appt.status === "pending" ? "gold" : "neutral"}>
              {APPT_STATUS_LABEL[appt.status]}
            </Badge>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Ders</p>
          <p className="mt-1 font-medium text-foreground">{appt.lesson ?? "Belirtilmemiş"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Konu</p>
          <p className="mt-1 font-medium text-foreground">{appt.subject ?? "Belirtilmemiş"}</p>
        </div>
        {info.lessonCount && (
          <div>
            <p className="text-xs text-muted-foreground">Ders Sayısı</p>
            <p className="mt-1 font-medium text-foreground">{info.lessonCount} ders</p>
          </div>
        )}
        {info.totalDurationMinutes && (
          <div>
            <p className="text-xs text-muted-foreground">Toplam Süre</p>
            <p className="mt-1 font-medium text-foreground">{formatDuration(info.totalDurationMinutes)}</p>
          </div>
        )}
        {appt.notes && appt.notes.trim() && (
          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">Not</p>
            <p className="mt-1 text-sm text-foreground">{appt.notes.trim()}</p>
          </div>
        )}
        {appt.lesson_mode && (
          <div>
            <p className="text-xs text-muted-foreground">Ders Türü</p>
            <p className="mt-1 font-medium text-foreground">{appt.lesson_mode === "online" ? "Online" : "Yüz Yüze"}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {appt.status === "pending" && (
          <>
            <PrimaryButton
              onClick={() => onUpdateStatus(appt, "confirmed")}
              disabled={apptActionId === appt.id}
              className="w-full sm:w-auto"
            >
              {apptActionId === appt.id ? "Onaylanıyor..." : "Onayla"}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => onUpdateStatus(appt, "cancelled")}
              disabled={apptActionId === appt.id}
              className="w-full sm:w-auto border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
            >
              {apptActionId === appt.id ? "İptal ediliyor..." : "İptal Et"}
            </SecondaryButton>
          </>
        )}
        {appt.status === "confirmed" && (
          <PrimaryButton
            onClick={() => onUpdateStatus(appt, "completed")}
            disabled={apptActionId === appt.id}
            className="w-full sm:w-auto"
          >
            {apptActionId === appt.id ? "Tamamlanıyor..." : "Tamamlandı Olarak İşaretle"}
          </PrimaryButton>
        )}
      </div>
    </Card>
  );
}

function StudentModal({
  open,
  onClose,
  onSubmit,
  form,
  formError,
  formSuccess,
  submitting,
  onFieldChange,
  panelRef,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  form: NewStudentForm;
  formError: string | null;
  formSuccess: string | null;
  submitting: boolean;
  onFieldChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
      onClick={(e) => {
        if (submitting) return;
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-student-modal-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-border bg-surface outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <h2
            id="new-student-modal-title"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            Yeni Öğrenci Ekle
          </h2>
          <SecondaryButton
            onClick={onClose}
            disabled={submitting}
            className="w-auto px-4 py-2 text-xs"
            aria-label="Kapat"
          >
            Kapat
          </SecondaryButton>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4 px-5 py-5 sm:px-6">
          {formError ? (
            <p
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
              {formError}
            </p>
          ) : null}
          {formSuccess ? (
            <p
              role="status"
              className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400"
            >
              {formSuccess}
            </p>
          ) : null}

          <TextInput
            id="new-student-full-name"
            name="full_name"
            label="Ad Soyad"
            placeholder="ör. Ayşe Yılmaz"
            value={form.full_name}
            onChange={onFieldChange}
            disabled={submitting}
            autoComplete="name"
            required
          />

          <TextInput
            id="new-student-email"
            name="email"
            type="email"
            label="E-posta"
            placeholder="ornek@eposta.com"
            value={form.email}
            onChange={onFieldChange}
            disabled={submitting}
            autoComplete="email"
            required
          />

          <TextInput
            id="new-student-temporary-password"
            name="temporary_password"
            type="password"
            label="Geçici Şifre"
            placeholder="En az 8 karakter"
            value={form.temporary_password}
            onChange={onFieldChange}
            disabled={submitting}
            autoComplete="new-password"
            hint="Öğretmen ilk girişten sonra değiştirebilir."
            required
          />

          <TextInput
            id="new-student-phone"
            name="phone"
            type="tel"
            label="Telefon (isteğe bağlı)"
            placeholder="ör. +90 5xx xxx xx xx"
            value={form.phone}
            onChange={onFieldChange}
            disabled={submitting}
            autoComplete="tel"
          />

          <div className="w-full">
            <label
              htmlFor="new-student-bio"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Biyografi (isteğe bağlı)
            </label>
            <textarea
              id="new-student-bio"
              name="bio"
              placeholder="Öğretmen hakkında kısa bilgi"
              value={form.bio}
              onChange={onFieldChange}
              disabled={submitting}
              rows={4}
              className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 hover:border-yellow-500/50 focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 min-h-11 touch-manipulation resize-y disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
            />
          </div>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <SecondaryButton
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              İptal
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              {submitting ? "Öğretmen oluşturuluyor..." : "Oluştur"}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}

function seriesGroupKey(slot: AvailabilityRow): string {
  const src = slot.source_date ?? slot.available_date;
  const wd = weekdayIndexOf(src);
  return `${slot.series_id}|${wd}|${slot.start_time}|${slot.end_time}`;
}

function weekdayIndexOf(dateKey: string): number | null {
  const date = dateOnlyToDate(dateKey);
  if (!date) return null;
  const day = date.getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function translateInsertError(error: { code?: string; message?: string }): string {
  if (error.code === "23505") {
    return "Bu saat aralığı zaten kayıtlı.";
  }
  return error.message ?? "Müsaitlik eklenirken bir hata oluştu.";
}

function translateOverrideError(error: { code?: string; message?: string }): string {
  if (error.code === "23505") {
    return "Bu gün zaten iptal edilmiş.";
  }
  return error.message ?? "İptal işlemi başarısız oldu.";
}

function translateStatusError(error: { code?: string; message?: string }): string {
  if (error.code === "P0003") {
    return "Bu durum geçişine izin verilmiyor.";
  }
  return error.message ?? "Durum güncellenemedi.";
}