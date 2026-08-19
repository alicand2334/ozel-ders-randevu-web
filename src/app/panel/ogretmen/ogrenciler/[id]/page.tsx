"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge, Card, PrimaryButton, SecondaryButton, SectionTitle, TextInput } from "@/components/ui";

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
  lesson_mode: "online" | "in_person" | null;
  slot: AppointmentSlot;
};

type DetailApiResponse = {
  profile: ProfilePayload;
  appointments: AppointmentPayload[];
};

type ApiError = { error?: string };

// PATCH /api/teacher/students/[id] yanıtı
type EditStudentResponse = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
};

// DELETE /api/teacher/students/[id] yanıtı
type DeleteStudentResponse = {
  message?: string;
  deactivated?: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Beklemede",
  confirmed: "Onaylandı",
  cancelled: "İptal Edildi",
  completed: "Tamamlandı",
};

const EMPTY_EDIT_FORM: EditForm = {
  full_name: "",
  phone: "",
};

type EditForm = {
  full_name: string;
  phone: string;
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

  // --- Düzenle modalı ---
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const editPanelRef = useRef<HTMLDivElement>(null);

  // --- Pasife Al / Aktif Et modalı ---
  const [toggleOpen, setToggleOpen] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleSubmitting, setToggleSubmitting] = useState(false);
  const togglePanelRef = useRef<HTMLDivElement>(null);

  // --- Sil modalı (soft-sil) ---
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const deletePanelRef = useRef<HTMLDivElement>(null);

  // --- Genel durum mesajı (silme başarılı vb.) ---
  const [toast, setToast] = useState<string | null>(null);

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

  // --- Toast otomatik kaybolur ---
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // --- Düzenle modalı açma/kapatma ---
  const openEdit = useCallback(() => {
    if (!profile) return;
    setEditForm({
      full_name: profile.full_name?.trim() ?? "",
      phone: profile.phone?.trim() ?? "",
    });
    setEditError(null);
    setEditSubmitting(false);
    setEditOpen(true);
  }, [profile]);

  const closeEdit = useCallback(() => {
    if (editSubmitting) return;
    setEditOpen(false);
    setEditError(null);
  }, [editSubmitting]);

  // --- Pasife Al / Aktif Et modalı açma/kapatma ---
  const openToggle = useCallback(() => {
    setToggleError(null);
    setToggleSubmitting(false);
    setToggleOpen(true);
  }, []);

  const closeToggle = useCallback(() => {
    if (toggleSubmitting) return;
    setToggleOpen(false);
    setToggleError(null);
  }, [toggleSubmitting]);

  // --- Sil modalı açma/kapatma ---
  const openDelete = useCallback(() => {
    setDeleteError(null);
    setDeleteSubmitting(false);
    setDeleteMessage(null);
    setDeleteOpen(true);
  }, []);

  const closeDelete = useCallback(() => {
    if (deleteSubmitting) return;
    setDeleteOpen(false);
    setDeleteError(null);
    setDeleteMessage(null);
  }, [deleteSubmitting]);

  // --- ESC ile modal kapatma + focus yönetimi ---
  useEffect(() => {
    if (!editOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !editSubmitting) setEditOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editOpen, editSubmitting]);

  useEffect(() => {
    if (!editOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    editPanelRef.current?.focus();
    return () => prev?.focus?.();
  }, [editOpen]);

  useEffect(() => {
    if (!toggleOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !toggleSubmitting) setToggleOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleOpen, toggleSubmitting]);

  useEffect(() => {
    if (!toggleOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    togglePanelRef.current?.focus();
    return () => prev?.focus?.();
  }, [toggleOpen]);

  useEffect(() => {
    if (!deleteOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleteSubmitting) setDeleteOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleteOpen, deleteSubmitting]);

  useEffect(() => {
    if (!deleteOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    deletePanelRef.current?.focus();
    return () => prev?.focus?.();
  }, [deleteOpen]);

  async function getAccessToken(): Promise<string | null> {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token ?? null;
  }

  function handleEditFieldChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleEditSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (editSubmitting || !profile) return;

    setEditError(null);

    const fullName = editForm.full_name.trim();
    if (!fullName) {
      setEditError("Ad soyad boş olamaz.");
      return;
    }

    setEditSubmitting(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setEditError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setEditSubmitting(false);
        return;
      }

      const res = await fetch(
        `/api/teacher/students/${encodeURIComponent(studentId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            full_name: fullName,
            phone: editForm.phone.trim() || null,
          }),
        },
      );

      const payload: EditStudentResponse | ApiError = await res.json();

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as ApiError;
        setEditError(
          apiError.error ?? "Öğrenci güncellenirken bir hata oluştu.",
        );
        setEditSubmitting(false);
        return;
      }

      const updated = payload as EditStudentResponse;
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              full_name: updated.full_name,
              phone: updated.phone,
            }
          : prev,
      );

      setEditSubmitting(false);
      setEditOpen(false);
      setToast("Öğrenci bilgileri güncellendi.");
    } catch {
      setEditError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setEditSubmitting(false);
    }
  }

  async function handleToggleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (toggleSubmitting || !profile) return;

    setToggleError(null);
    const nextActive = !profile.is_active;

    setToggleSubmitting(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setToggleError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setToggleSubmitting(false);
        return;
      }

      const res = await fetch(
        `/api/teacher/students/${encodeURIComponent(studentId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ is_active: nextActive }),
        },
      );

      const payload: EditStudentResponse | ApiError = await res.json();

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as ApiError;
        setToggleError(
          apiError.error ?? "Durum güncellenirken bir hata oluştu.",
        );
        setToggleSubmitting(false);
        return;
      }

      const updated = payload as EditStudentResponse;
      setProfile((prev) =>
        prev ? { ...prev, is_active: updated.is_active } : prev,
      );

      setToast(
        updated.is_active
          ? "Öğrenci tekrar aktif edildi."
          : "Öğrenci pasife alındı.",
      );
      setToggleSubmitting(false);
      setToggleOpen(false);
    } catch {
      setToggleError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setToggleSubmitting(false);
    }
  }

  async function handleDeleteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (deleteSubmitting) return;

    setDeleteError(null);
    setDeleteMessage(null);

    setDeleteSubmitting(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setDeleteError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setDeleteSubmitting(false);
        return;
      }

      const res = await fetch(
        `/api/teacher/students/${encodeURIComponent(studentId)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const payload: DeleteStudentResponse | ApiError = await res.json();

      if (!res.ok) {
        const apiError = payload as ApiError;
        setDeleteError(
          apiError.error ?? "Öğrenci kaldırılırken bir hata oluştu.",
        );
        setDeleteSubmitting(false);
        return;
      }

      const ok = payload as DeleteStudentResponse;
      setDeleteSubmitting(false);
      setDeleteOpen(false);
      setToast(
        ok.message ??
          "Öğrenci listenizden kaldırıldı. Geçmiş randevular korundu.",
      );
      // Detay sayfasından öğretmen listesine geri dön.
      router.push("/panel/ogretmen");
    } catch {
      setDeleteError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setDeleteSubmitting(false);
    }
  }

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
          description="Öğrencinize ait bilgileri ve randevu geçmişini görüntüleyin; düzenleyin, pasife alın veya listenizden kaldırın."
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

          {state === "ready" && profile ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <SecondaryButton
                onClick={openEdit}
                className="w-full sm:w-auto px-4 py-2 text-xs"
                aria-label="Öğrenciyi düzenle"
              >
                Düzenle
              </SecondaryButton>
              <SecondaryButton
                onClick={openToggle}
                className="w-full sm:w-auto px-4 py-2 text-xs"
                aria-label={
                  profile.is_active ? "Öğrenciyi pasife al" : "Öğrenciyi aktif et"
                }
              >
                {profile.is_active ? "Pasife Al" : "Aktif Et"}
              </SecondaryButton>
              <SecondaryButton
                onClick={openDelete}
                className="w-full sm:w-auto px-4 py-2 text-xs rounded-full border border-red-500/30 bg-transparent text-red-300 transition-colors duration-200 hover:bg-red-500/10 hover:border-red-500/50 active:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:ring-red-400/60"
                aria-label="Öğrenciyi listeden kaldır"
              >
                Sil
              </SecondaryButton>
            </div>
          ) : null}

          {state === "ready" && profile ? (
            <p className="mt-4 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-muted">
              <span className="font-semibold text-ink-text">Not:</span> Sil
              butonu öğrencinin hesabını, profilini ya da geçmiş randevularını
              fiziksel olarak <span className="font-semibold">silmez</span>.
              Yalnızca aranızdaki öğretmen-öğrenci ilişkisini kaldırır. Aktif
              (pending/confirmed) randevu varsa kaldırma engellenir; geçmiş
              (cancelled/completed) randevular korunur.
            </p>
          ) : null}
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
                              <span className="text-muted/80">Ders Türü: </span>
                              {lessonModeLabel(appt.lesson_mode)}
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

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <SecondaryButton
            onClick={() => router.push("/panel/ogretmen")}
            className="w-full sm:w-auto"
          >
            Öğretmen Paneline Dön
          </SecondaryButton>
        </div>
      </div>

      {/* Düzenle modalı */}
      {editOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
          onClick={(e) => {
            if (editSubmitting) return;
            if (e.target === e.currentTarget) setEditOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-student-modal-title"
        >
          <div
            ref={editPanelRef}
            tabIndex={-1}
            className="flex w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-line bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-0.5">
                <h2
                  id="edit-student-modal-title"
                  className="text-base font-semibold tracking-tight text-ink-text"
                >
                  Öğrenciyi Düzenle
                </h2>
                {profile?.full_name?.trim() ? (
                  <span className="text-xs text-subtle">
                    {profile.full_name.trim()}
                  </span>
                ) : null}
              </div>
              <SecondaryButton
                onClick={closeEdit}
                disabled={editSubmitting}
                className="w-auto px-4 py-2 text-xs"
                aria-label="Kapat"
              >
                Kapat
              </SecondaryButton>
            </div>

            <form
              onSubmit={handleEditSubmit}
              className="flex flex-col gap-4 px-5 py-5 sm:px-6"
            >
              {editError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {editError}
                </p>
              ) : null}

              <TextInput
                id="edit-student-full-name"
                name="full_name"
                type="text"
                label="Ad Soyad"
                placeholder="ör. Mehmet Demir"
                value={editForm.full_name}
                onChange={handleEditFieldChange}
                disabled={editSubmitting}
                autoComplete="name"
                required
              />

              <TextInput
                id="edit-student-phone"
                name="phone"
                type="tel"
                label="Telefon (isteğe bağlı)"
                placeholder="ör. +90 5xx xxx xx xx"
                value={editForm.phone}
                onChange={handleEditFieldChange}
                disabled={editSubmitting}
                autoComplete="tel"
              />

              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SecondaryButton
                  type="button"
                  onClick={closeEdit}
                  disabled={editSubmitting}
                  className="w-full sm:w-auto"
                >
                  Vazgeç
                </SecondaryButton>
                <PrimaryButton
                  type="submit"
                  disabled={editSubmitting}
                  className="w-full sm:w-auto"
                >
                  {editSubmitting ? "Kaydediliyor..." : "Kaydet"}
                </PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Pasife Al / Aktif Et modalı */}
      {toggleOpen && profile ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
          onClick={(e) => {
            if (toggleSubmitting) return;
            if (e.target === e.currentTarget) setToggleOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="toggle-student-modal-title"
        >
          <div
            ref={togglePanelRef}
            tabIndex={-1}
            className="flex w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-line bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-0.5">
                <h2
                  id="toggle-student-modal-title"
                  className="text-base font-semibold tracking-tight text-ink-text"
                >
                  {profile.is_active ? "Öğrenciyi Pasife Al" : "Öğrenciyi Aktif Et"}
                </h2>
                {profile.full_name?.trim() ? (
                  <span className="text-xs text-subtle">
                    {profile.full_name.trim()}
                  </span>
                ) : null}
              </div>
              <SecondaryButton
                onClick={closeToggle}
                disabled={toggleSubmitting}
                className="w-auto px-4 py-2 text-xs"
                aria-label="Kapat"
              >
                Kapat
              </SecondaryButton>
            </div>

            <form
              onSubmit={handleToggleSubmit}
              className="flex flex-col gap-4 px-5 py-5 sm:px-6"
            >
              {toggleError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {toggleError}
                </p>
              ) : null}

              <p className="text-sm leading-relaxed text-ink-text">
                {profile.is_active
                  ? "Bu öğrenciyi pasife almak istediğinize emin misiniz? Öğrenci sisteme giriş yapamayacak ve yeni randevu oluşturamayacak. Mevcut ve geçmiş randevular etkilenmez."
                  : "Bu öğrenciyi tekrar aktif etmek istediğinize emin misiniz?"}
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SecondaryButton
                  type="button"
                  onClick={closeToggle}
                  disabled={toggleSubmitting}
                  className="w-full sm:w-auto"
                >
                  Vazgeç
                </SecondaryButton>
                <PrimaryButton
                  type="submit"
                  disabled={toggleSubmitting}
                  className="w-full sm:w-auto"
                >
                  {toggleSubmitting
                    ? "Güncelleniyor..."
                    : profile.is_active
                      ? "Pasife Al"
                      : "Aktif Et"}
                </PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Sil (soft-sil) modalı */}
      {deleteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
          onClick={(e) => {
            if (deleteSubmitting) return;
            if (e.target === e.currentTarget) setDeleteOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-student-modal-title"
        >
          <div
            ref={deletePanelRef}
            tabIndex={-1}
            className="flex w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-red-500/30 bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-red-500/30 px-5 py-4 sm:px-6">
              <h2
                id="delete-student-modal-title"
                className="text-base font-semibold tracking-tight text-red-300"
              >
                Öğrenciyi Listenizden Kaldır
              </h2>
              <SecondaryButton
                onClick={closeDelete}
                disabled={deleteSubmitting}
                className="w-auto px-4 py-2 text-xs"
                aria-label="Kapat"
              >
                Kapat
              </SecondaryButton>
            </div>

            <form
              onSubmit={handleDeleteSubmit}
              className="flex flex-col gap-4 px-5 py-5 sm:px-6"
            >
              {deleteError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {deleteError}
                </p>
              ) : null}

              {deleteMessage ? (
                <p
                  role="status"
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300"
                >
                  {deleteMessage}
                </p>
              ) : null}

              <p className="text-sm leading-relaxed text-ink-text">
                <span className="font-semibold text-ink-text">
                  {profile?.full_name?.trim() || "İsimsiz"}
                </span>
                {" adlı öğrenciyi listenizden kaldırmak istediğinize emin misiniz?"}
              </p>
              <p className="text-xs leading-relaxed text-muted">
                Öğrencinin hesabı, profili ya da geçmiş randevu kayıtları
                silinmez. Yalnızca sizin aranızdaki öğretmen-öğrenci ilişkisi
                kaldırılır. Eğer öğrenci başka bir öğretmene de bağlıysa, o
                öğretmenin öğrencisi olarak kalır. pending/confirmed aktif
                randevu varsa bu işlem engellenir.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SecondaryButton
                  type="button"
                  onClick={closeDelete}
                  disabled={deleteSubmitting}
                  className="w-full sm:w-auto"
                >
                  Vazgeç
                </SecondaryButton>
                <PrimaryButton
                  type="submit"
                  disabled={deleteSubmitting}
                  className="w-full sm:w-auto rounded-full border border-red-500/30 bg-red-500/10 text-red-300 transition-colors duration-200 hover:bg-red-500/20 active:bg-red-500/30 focus-visible:ring-red-400/60"
                >
                  {deleteSubmitting ? "Kaldırılıyor..." : "Kaldır"}
                </PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300 shadow-lg"
        >
          {toast}
        </div>
      ) : null}
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

function lessonModeLabel(mode: "online" | "in_person" | null): string {
  if (mode === "online") return "Online";
  if (mode === "in_person") return "Yüz Yüze";
  return "Belirtilmedi";
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
