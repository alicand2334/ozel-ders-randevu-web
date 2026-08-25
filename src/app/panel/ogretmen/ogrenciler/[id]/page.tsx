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

type EditStudentResponse = {
  id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
};

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

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const editPanelRef = useRef<HTMLDivElement>(null);

  const [toggleOpen, setToggleOpen] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleSubmitting, setToggleSubmitting] = useState(false);
  const togglePanelRef = useRef<HTMLDivElement>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const deletePanelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

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
    <main className="flex min-h-dvh flex-col px-6 py-8 sm:px-10">
      <div className="w-full max-w-4xl mx-auto space-y-6">
        <SectionTitle
          align="left"
          eyebrow="Öğretmen Paneli"
          title="Öğrenci Detayı"
          description="Öğrencinize ait bilgileri ve randevu geçmişini görüntüleyin; düzenleyin, pasife alın veya listenizden kaldırın."
        />

        <Card className="overflow-hidden" padding="snug">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Bilgiler</h2>
            {state === "ready" && profile ? (
              <Badge tone={profile.is_active ? "gold" : "neutral"}>
                {profile.is_active ? "Aktif" : "Pasif"}
              </Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground text-center py-8">Yükleniyor...</p>
            ) : state === "error" ? (
              <p
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
              >
                {errorMsg ?? "Öğrenci bilgileri yüklenemedi."}
              </p>
            ) : state === "not-found" ? (
              <p
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
              >
                Bu öğrenci size bağlı değil.
              </p>
            ) : profile ? (
              <ul className="divide-y divide-border">
                <li className="flex flex-col gap-0.5 py-3">
                  <span className="text-xs text-muted-foreground">Ad Soyad</span>
                  <span className="text-sm font-medium text-foreground">
                    {profile.full_name?.trim() || "Belirtilmedi"}
                  </span>
                </li>
                <li className="flex flex-col gap-0.5 py-3">
                  <span className="text-xs text-muted-foreground">Telefon</span>
                  <span className="text-sm font-medium text-foreground">
                    {profile.phone?.trim() || "Belirtilmedi"}
                  </span>
                </li>
                <li className="flex flex-col gap-0.5 py-3">
                  <span className="text-xs text-muted-foreground">Durum</span>
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
                className="w-full sm:w-auto"
                aria-label="Öğrenciyi düzenle"
              >
                Düzenle
              </SecondaryButton>
              <SecondaryButton
                onClick={openToggle}
                className="w-full sm:w-auto"
                aria-label={
                  profile.is_active ? "Öğrenciyi pasife al" : "Öğrenciyi aktif et"
                }
              >
                {profile.is_active ? "Pasife Al" : "Aktif Et"}
              </SecondaryButton>
              <SecondaryButton
                onClick={openDelete}
                className="w-full sm:w-auto rounded-full border border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                aria-label="Öğrenciyi listeden kaldır"
              >
                Sil
              </SecondaryButton>
            </div>
          ) : null}

          {state === "ready" && profile ? (
            <p className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Not:</span> Sil
              butonu öğrencinin hesabını, profilini ya da geçmiş randevularını
              fiziksel olarak <span className="font-semibold">silmez</span>.
              Yalnızca aranızdaki öğretmen-öğrenci ilişkisini kaldırır. Aktif
              (pending/confirmed) randevu varsa kaldırma engellenir; geçmiş
              (cancelled/completed) randevular korunur.
            </p>
          ) : null}
        </Card>

        <Card className="overflow-hidden" padding="snug">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Randevu Özeti</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Toplam Randevu</dt>
              <dd className="text-lg font-semibold text-foreground">
                {appointments.length}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Tamamlanan</dt>
              <dd className="text-lg font-semibold text-foreground">
                {appointments.filter((a) => a.status === "completed").length}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Bekleyen</dt>
              <dd className="text-lg font-semibold text-yellow-500">
                {appointments.filter((a) => a.status === "pending").length}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">İptal Edilen</dt>
              <dd className="text-lg font-semibold text-foreground">
                {appointments.filter((a) => a.status === "cancelled").length}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="overflow-hidden" padding="snug">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Randevular</h2>
            {state === "ready" ? (
              <Badge tone="neutral">{appointments.length} kayıt</Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground text-center py-8">Yükleniyor...</p>
            ) : state === "ready" ? (
              appointments.length === 0 ? (
                <p className="text-sm leading-relaxed text-muted-foreground text-center py-8">
                  Henüz randevu bulunmuyor.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {appointments.map((appt) => {
                    const slot = appt.slot;
                    return (
                      <li
                        key={appt.id}
                        className="py-4"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {slot ? formatDate(slot.available_date) : "Tarih yok"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {slot
                                ? `${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}`
                                : "Saat bilgisi yok"}
                            </p>
                            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                              <p><span className="font-medium text-foreground">Ders: </span>{appt.lesson?.trim() || "Belirtilmemiş"}</p>
                              <p><span className="font-medium text-foreground">Ders Türü: </span>{lessonModeLabel(appt.lesson_mode)}</p>
                              <p><span className="font-medium text-foreground">Ders Konusu: </span>{appt.subject?.trim() || "Belirtilmemiş"}</p>
                              <p><span className="font-medium text-foreground">Öğretmen Notu: </span>{appt.notes?.trim() || "Belirtilmemiş"}</p>
                              <p><span className="font-medium text-foreground">Oluşturulma Tarihi: </span>{appt.created_at ? formatDateTime(appt.created_at) : "Belirtilmemiş"}</p>
                            </div>
                          </div>
                          <Badge tone={appt.status === "pending" ? "gold" : "neutral"}>
                            {appt.status ? (STATUS_LABEL[appt.status] ?? appt.status) : "Durum yok"}
                          </Badge>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </div>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row">
          <SecondaryButton
            onClick={() => router.push("/panel/ogretmen/randevular")}
            className="w-full sm:w-auto"
          >
            Randevulara Dön
          </SecondaryButton>
        </div>

        {editOpen ? (
          <Modal
            open={editOpen}
            onClose={closeEdit}
            title="Öğrenciyi Düzenle"
            subtitle={profile?.full_name?.trim()}
            submitLabel="Kaydet"
            submitting={editSubmitting}
            onSubmit={handleEditSubmit}
            panelRef={editPanelRef}
            error={editError}
          >
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
          </Modal>
        ) : null}

        {toggleOpen && profile ? (
          <Modal
            open={toggleOpen}
            onClose={closeToggle}
            title={profile.is_active ? "Öğrenciyi Pasife Al" : "Öğrenciyi Aktif Et"}
            subtitle={profile.full_name?.trim()}
            submitLabel={profile.is_active ? "Pasife Al" : "Aktif Et"}
            submitting={toggleSubmitting}
            onSubmit={handleToggleSubmit}
            panelRef={togglePanelRef}
            error={toggleError}
          >
            <p className="text-sm leading-relaxed text-foreground">
              {profile.is_active
                ? "Bu öğrenciyi pasife almak istediğinize emin misiniz? Öğrenci sisteme giriş yapamayacak ve yeni randevu oluşturamayacak. Mevcut ve geçmiş randevular etkilenmez."
                : "Bu öğrenciyi tekrar aktif etmek istediğinize emin misiniz?"}
            </p>
          </Modal>
        ) : null}

        {deleteOpen ? (
          <Modal
            open={deleteOpen}
            onClose={closeDelete}
            title="Öğrenciyi Listenizden Kaldır"
            subtitle={profile?.full_name?.trim()}
            submitLabel="Kaldır"
            submitting={deleteSubmitting}
            onSubmit={handleDeleteSubmit}
            panelRef={deletePanelRef}
            error={deleteError}
            success={deleteMessage}
            danger
          >
            <p className="text-sm leading-relaxed text-foreground">
              <span className="font-semibold text-foreground">
                {profile?.full_name?.trim() || "İsimsiz"}
              </span>
              {" adlı öğrenciyi listenizden kaldırmak istediğinize emin misiniz?"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Öğrencinin hesabı, profili ya da geçmiş randevu kayıtları
              silinmez. Yalnızca sizin aranızdaki öğretmen-öğrenci ilişkisi
              kaldırılır. Eğer öğrenci başka bir öğretmene de bağlıysa, o
              öğretmenin öğrencisi olarak kalır. pending/confirmed aktif
              randevu varsa bu işlem engellenir.
            </p>
          </Modal>
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

function Modal({
  open,
  onClose,
  title,
  subtitle,
  submitLabel,
  submitting,
  onSubmit,
  panelRef,
  error,
  success,
  danger,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  error?: string | null;
  success?: string | null;
  danger?: boolean;
  children: React.ReactNode;
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
      aria-labelledby="modal-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`flex w-full max-w-md flex-col overflow-y-auto rounded-2xl border ${
          danger ? "border-red-500/30" : "border-border"
        } bg-surface outline-none`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-0.5">
            <h2 id="modal-title" className="text-base font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            {subtitle ? (
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            ) : null}
          </div>
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
          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
              {error}
            </p>
          ) : null}
          {success ? (
            <p
              role="status"
              className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400"
            >
              {success}
            </p>
          ) : null}

          {children}

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <SecondaryButton
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              Vazgeç
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              disabled={submitting}
              className={[
                "w-full sm:w-auto",
                danger
                  ? "rounded-full border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                  : "",
              ].join(" ")}
            >
              {submitting ? (danger ? "Kaldırılıyor..." : "Kaydediliyor...") : submitLabel}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
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