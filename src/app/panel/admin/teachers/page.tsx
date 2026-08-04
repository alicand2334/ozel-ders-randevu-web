"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { isValidEmail } from "@/lib/supabase/auth-helpers";
import { formatDateLongNoWeekday } from "@/lib/datetime";
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  TextInput,
} from "@/components/ui";

type FetchState = "loading" | "ready" | "error";

type NewTeacherForm = {
  full_name: string;
  email: string;
  temporary_password: string;
  phone: string;
  specialization: string;
  bio: string;
};

type CreateTeacherResponse = {
  id: string;
  full_name: string;
  email: string;
  specialization: string;
  is_active: boolean;
};

type CreateTeacherApiError = { error?: string };

type DeleteTeacherApiResponse = {
  message?: string;
  error?: string;
};

type EditTeacherForm = {
  full_name: string;
  phone: string;
  specialization: string;
  bio: string;
};

type EditTeacherResponse = {
  id: string;
  full_name: string | null;
  phone: string | null;
  specialization: string | null;
  bio: string | null;
  is_active: boolean;
};

const EMPTY_EDIT_FORM: EditTeacherForm = {
  full_name: "",
  phone: "",
  specialization: "",
  bio: "",
};

const EMPTY_FORM: NewTeacherForm = {
  full_name: "",
  email: "",
  temporary_password: "",
  phone: "",
  specialization: "",
  bio: "",
};

type TeacherRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  created_at: string;
  is_active: boolean | null;
  avatar_url: string | null;
  bio: string | null;
  specialization: string | null;
};

const PAGE_SIZE = 10;

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AdminTeachersPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [roleLoading, setRoleLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [state, setState] = useState<FetchState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NewTeacherForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const modalPanelRef = useRef<HTMLDivElement>(null);

  const [pwdTarget, setPwdTarget] = useState<TeacherRow | null>(null);
  const [pwdValue, setPwdValue] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const pwdPanelRef = useRef<HTMLDivElement>(null);

  const [editTarget, setEditTarget] = useState<TeacherRow | null>(null);
  const [editForm, setEditForm] = useState<EditTeacherForm>(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const editPanelRef = useRef<HTMLDivElement>(null);

  const [toggleTarget, setToggleTarget] = useState<TeacherRow | null>(null);
  const [toggleSubmitting, setToggleSubmitting] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const togglePanelRef = useRef<HTMLDivElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<TeacherRow | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletePanelRef = useRef<HTMLDivElement>(null);

  const openModal = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(false);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (submitting) return;
    setModalOpen(false);
    setFormError(null);
    setFormSuccess(null);
  }, [submitting]);

  const openPwdModal = useCallback((t: TeacherRow) => {
    setPwdTarget(t);
    setPwdValue("");
    setPwdConfirm("");
    setPwdError(null);
    setPwdSuccess(null);
    setPwdSubmitting(false);
  }, []);

  const closePwdModal = useCallback(() => {
    if (pwdSubmitting) return;
    setPwdTarget(null);
    setPwdError(null);
    setPwdSuccess(null);
  }, [pwdSubmitting]);

  const openEditModal = useCallback((t: TeacherRow) => {
    setEditTarget(t);
    setEditForm({
      full_name: t.full_name?.trim() ?? "",
      phone: t.phone?.trim() ?? "",
      specialization: t.specialization?.trim() ?? "",
      bio: t.bio?.trim() ?? "",
    });
    setEditError(null);
    setEditSubmitting(false);
  }, []);

  const closeEditModal = useCallback(() => {
    if (editSubmitting) return;
    setEditTarget(null);
    setEditError(null);
  }, [editSubmitting]);

  const openToggleActiveModal = useCallback((t: TeacherRow) => {
    setToggleTarget(t);
    setToggleError(null);
    setToggleSubmitting(false);
  }, []);

  const closeToggleActiveModal = useCallback(() => {
    if (toggleSubmitting) return;
    setToggleTarget(null);
    setToggleError(null);
  }, [toggleSubmitting]);

  const openDeleteModal = useCallback((t: TeacherRow) => {
    setDeleteTarget(t);
    setDeleteConfirmName("");
    setDeleteError(null);
    setDeleteSubmitting(false);
  }, []);

  const closeDeleteModal = useCallback(() => {
    if (deleteSubmitting) return;
    setDeleteTarget(null);
    setDeleteConfirmName("");
    setDeleteError(null);
  }, [deleteSubmitting]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => {
      setToast(null);
    }, 2500);
    return () => {
      window.clearTimeout(id);
    };
  }, [toast]);

  function handleEditFieldChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  }

  useEffect(() => {
    if (!pwdTarget) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pwdSubmitting) {
        setPwdTarget(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pwdTarget, pwdSubmitting]);

  useEffect(() => {
    if (!pwdTarget) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    pwdPanelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [pwdTarget]);

  useEffect(() => {
    if (!editTarget) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !editSubmitting) {
        setEditTarget(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [editTarget, editSubmitting]);

  useEffect(() => {
    if (!editTarget) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    editPanelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [editTarget]);

  useEffect(() => {
    if (!toggleTarget) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !toggleSubmitting) {
        setToggleTarget(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toggleTarget, toggleSubmitting]);

  useEffect(() => {
    if (!toggleTarget) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    togglePanelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [toggleTarget]);

  useEffect(() => {
    if (!deleteTarget) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleteSubmitting) {
        setDeleteTarget(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [deleteTarget, deleteSubmitting]);

  useEffect(() => {
    if (!deleteTarget) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    deletePanelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [deleteTarget]);

  useEffect(() => {
    if (!modalOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) {
        setModalOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [modalOpen, submitting]);

  useEffect(() => {
    if (!modalOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    modalPanelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [modalOpen]);

  function handleFieldChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/giris");
    }
  }, [loading, user, router]);

  useEffect(() => {
    let active = true;
    if (loading || !user) return;

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
      if (data?.role === "student") {
        router.replace("/panel");
        return;
      }
      if (data?.role === "admin") {
        setAllowed(true);
      }
      setRoleLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loading, user, router]);

  const fetchTeachers = useCallback(async () => {
    setState("loading");
    setErrorMsg(null);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, phone, role, created_at, is_active, avatar_url, bio, specialization",
      )
      .eq("role", "teacher")
      .order("created_at", { ascending: false });
    if (error) {
      setErrorMsg(error.message);
      setState("error");
      return;
    }
    setTeachers((data ?? []) as TeacherRow[]);
    setState("ready");
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let active = true;

    (async () => {
      setState("loading");
      setErrorMsg(null);
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, phone, role, created_at, is_active, avatar_url, bio, specialization",
        )
        .eq("role", "teacher")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        setErrorMsg(error.message);
        setState("error");
        return;
      }
      setTeachers((data ?? []) as TeacherRow[]);
      setState("ready");
    })();

    return () => {
      active = false;
    };
  }, [allowed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter((t) => {
      const name = (t.full_name ?? "").toLowerCase();
      const phone = (t.phone ?? "").toLowerCase();
      const spec = (t.specialization ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || spec.includes(q);
    });
  }, [teachers, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    setFormError(null);
    setFormSuccess(null);

    const fullName = form.full_name.trim();
    const email = form.email.trim();
    const temporaryPassword = form.temporary_password;
    const specialization = form.specialization.trim();

    if (!fullName) {
      setFormError("Ad Soyad boş olamaz.");
      return;
    }
    if (!isValidEmail(email)) {
      setFormError("Geçerli bir e-posta adresi girin.");
      return;
    }
    if (temporaryPassword.length < 8) {
      setFormError("Geçici şifre en az 8 karakter olmalı.");
      return;
    }
    if (!specialization) {
      setFormError("Branş alanı boş olamaz.");
      return;
    }

    setSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setFormError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          temporary_password: temporaryPassword,
          phone: form.phone.trim() || null,
          specialization,
          bio: form.bio.trim() || null,
        }),
      });

      const payload: CreateTeacherResponse | CreateTeacherApiError =
        await res.json();

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as CreateTeacherApiError;
        setFormError(
          apiError.error ?? "Öğretmen oluşturulurken bir hata oluştu.",
        );
        setSubmitting(false);
        return;
      }

      setFormSuccess("Öğretmen başarıyla oluşturuldu.");
      setForm(EMPTY_FORM);
      setSubmitting(false);

      await fetchTeachers();

      setTimeout(() => {
        setModalOpen(false);
        setFormSuccess(null);
      }, 1200);
    } catch {
      setFormError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setSubmitting(false);
    }
  }

  async function handlePwdSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pwdSubmitting || !pwdTarget) return;

    setPwdError(null);
    setPwdSuccess(null);

    if (pwdValue.length < 8) {
      setPwdError("Yeni geçici şifre en az 8 karakter olmalı.");
      return;
    }
    if (pwdValue !== pwdConfirm) {
      setPwdError("Girilen şifreler eşleşmiyor.");
      return;
    }

    setPwdSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setPwdError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setPwdSubmitting(false);
        return;
      }

      const res = await fetch(
        `/api/admin/teachers/${encodeURIComponent(pwdTarget.id)}/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ temporary_password: pwdValue }),
        },
      );

      const payload: { message?: string; error?: string } = await res.json();

      if (!res.ok) {
        setPwdError(
          payload.error ?? "Şifre güncellenirken bir hata oluştu.",
        );
        setPwdSubmitting(false);
        return;
      }

      setPwdSuccess("Öğretmen şifresi başarıyla güncellendi.");
      setPwdValue("");
      setPwdConfirm("");
      setPwdSubmitting(false);

      setTimeout(() => {
        setPwdTarget(null);
        setPwdSuccess(null);
      }, 1200);
    } catch {
      setPwdError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setPwdSubmitting(false);
    }
  }

  async function handleEditSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (editSubmitting || !editTarget) return;

    setEditError(null);

    const fullName = editForm.full_name.trim();
    const specialization = editForm.specialization.trim();

    if (!fullName) {
      setEditError("Ad soyad boş olamaz.");
      return;
    }
    if (!specialization) {
      setEditError("Branş alanı boş olamaz.");
      return;
    }

    setEditSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setEditError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setEditSubmitting(false);
        return;
      }

      const res = await fetch(
        `/api/admin/teachers/${encodeURIComponent(editTarget.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            full_name: fullName,
            phone: editForm.phone.trim() || null,
            specialization,
            bio: editForm.bio.trim() || null,
          }),
        },
      );

      const payload: EditTeacherResponse | CreateTeacherApiError =
        await res.json();

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as CreateTeacherApiError;
        setEditError(
          apiError.error ?? "Öğretmen güncellenirken bir hata oluştu.",
        );
        setEditSubmitting(false);
        return;
      }

      const updated = payload as EditTeacherResponse;

      setTeachers((prev) =>
        prev.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                full_name: updated.full_name,
                phone: updated.phone,
                specialization: updated.specialization,
                bio: updated.bio,
              }
            : row,
        ),
      );

      setEditSubmitting(false);
      setEditTarget(null);
    } catch {
      setEditError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setEditSubmitting(false);
    }
  }

  async function handleToggleActiveSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (toggleSubmitting || !toggleTarget) return;

    setToggleError(null);
    const nextActive = toggleTarget.is_active !== false ? false : true;

    setToggleSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setToggleError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setToggleSubmitting(false);
        return;
      }

      const res = await fetch(
        `/api/admin/teachers/${encodeURIComponent(toggleTarget.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ is_active: nextActive }),
        },
      );

      const payload: EditTeacherResponse | CreateTeacherApiError =
        await res.json();

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as CreateTeacherApiError;
        setToggleError(
          apiError.error ?? "Durum güncellenirken bir hata oluştu.",
        );
        setToggleSubmitting(false);
        return;
      }

      const updated = payload as EditTeacherResponse;

      setTeachers((prev) =>
        prev.map((row) =>
          row.id === updated.id
            ? { ...row, is_active: updated.is_active }
            : row,
        ),
      );

      setToast(
        updated.is_active
          ? "Öğretmen tekrar aktif edildi."
          : "Öğretmen pasife alındı.",
      );
      setToggleSubmitting(false);
      setToggleTarget(null);
    } catch {
      setToggleError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setToggleSubmitting(false);
    }
  }

  async function handleDeleteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (deleteSubmitting || !deleteTarget) return;

    setDeleteError(null);

    const expectedName = (deleteTarget.full_name ?? "").trim();
    const inputName = deleteConfirmName.trim();

    if (!inputName) {
      setDeleteError("Onay için öğretmenin adını yazın.");
      return;
    }
    if (inputName !== expectedName) {
      setDeleteError("Yazdığınız ad öğretmenin adıyla eşleşmiyor.");
      return;
    }

    setDeleteSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setDeleteError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setDeleteSubmitting(false);
        return;
      }

      const res = await fetch(
        `/api/admin/teachers/${encodeURIComponent(deleteTarget.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const payload: DeleteTeacherApiResponse = await res.json();

      if (!res.ok) {
        setDeleteError(
          payload?.error ?? "Öğretmen silinirken bir hata oluştu.",
        );
        setDeleteSubmitting(false);
        return;
      }

      setTeachers((prev) => prev.filter((row) => row.id !== deleteTarget.id));
      setToast(`Öğretmen silindi: ${expectedName}`);
      setDeleteSubmitting(false);
      setDeleteTarget(null);
      setDeleteConfirmName("");
      setDeleteError(null);
    } catch {
      setDeleteError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setDeleteSubmitting(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/giris");
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
      <div className="w-full max-w-2xl overflow-x-hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <SectionTitle
            align="left"
            eyebrow="Yönetici Paneli"
            title="Öğretmen Yönetimi"
            description="Sistemdeki öğretmenleri görüntüleyin, yönetin ve pasifleştirin."
          />
          <PrimaryButton
            onClick={() => router.push("/panel/admin")}
            className="w-full sm:w-auto"
          >
            Panele Dön
          </PrimaryButton>
        </div>

        <Card className="mt-6 sm:mt-8" padding="roomy" raised>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold tracking-tight text-ink-text">
              Öğretmen Listesi
            </h2>
            <div className="flex items-center gap-3">
              {state === "ready" ? (
                <Badge tone="neutral">{filtered.length} kayıt</Badge>
              ) : null}
              <PrimaryButton
                onClick={openModal}
                className="w-full sm:w-auto"
              >
                Yeni Öğretmen Ekle
              </PrimaryButton>
            </div>
          </div>

          <div className="mt-5">
            <TextInput
              id="search"
              type="search"
              label="Ara"
              placeholder="Ad, telefon veya branşa göre ara"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              aria-label="Öğretmen ara"
            />
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
                  Öğretmenler yüklenemedi: {errorMsg ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton
                  onClick={fetchTeachers}
                  className="w-full sm:w-auto"
                >
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                {search.trim()
                  ? "Aramayla eşleşen öğretmen bulunmuyor."
                  : "Henüz öğretmen kaydı bulunmuyor."}
              </p>
            ) : (
              <>
                {/* Masaüstü: tablo */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
                        <th className="py-2.5 pr-3 font-medium">Öğretmen</th>
                        <th className="px-3 py-2.5 font-medium">Telefon</th>
                        <th className="px-3 py-2.5 font-medium">Durum</th>
                        <th className="px-3 py-2.5 font-medium">Tarih</th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          İşlemler
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pageRows.map((t) => (
                        <TeacherRowDesktop
                          key={t.id}
                          t={t}
                          onPwd={openPwdModal}
                          onEdit={openEditModal}
                          onToggleActive={openToggleActiveModal}
                          onDelete={openDeleteModal}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobil: kart listesi */}
                <ul className="divide-y divide-line sm:hidden">
                  {pageRows.map((t) => (
                    <TeacherRowMobile
                      key={t.id}
                      t={t}
                      onPwd={openPwdModal}
                      onEdit={openEditModal}
                      onToggleActive={openToggleActiveModal}
                      onDelete={openDeleteModal}
                    />
                  ))}
                </ul>

                {/* Sayfalama */}
                {totalPages > 1 ? (
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-xs text-subtle">
                      Sayfa {safePage} / {totalPages}
                    </span>
                    <div className="flex gap-2">
                      <SecondaryButton
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={safePage <= 1}
                        className="w-auto"
                      >
                        Önceki
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={safePage >= totalPages}
                        className="w-auto"
                      >
                        Sonraki
                      </SecondaryButton>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Card>

        <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row">
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

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
          onClick={(e) => {
            if (submitting) return;
            if (e.target === e.currentTarget) {
              setModalOpen(false);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-teacher-modal-title"
        >
          <div
            ref={modalPanelRef}
            tabIndex={-1}
            className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <h2
                id="new-teacher-modal-title"
                className="text-base font-semibold tracking-tight text-ink-text"
              >
                Yeni Öğretmen Ekle
              </h2>
              <SecondaryButton
                onClick={closeModal}
                disabled={submitting}
                className="w-auto px-4 py-2 text-xs"
                aria-label="Kapat"
              >
                Kapat
              </SecondaryButton>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-5 py-5 sm:px-6"
            >
              {formError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {formError}
                </p>
              ) : null}
              {formSuccess ? (
                <p
                  role="status"
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300"
                >
                  {formSuccess}
                </p>
              ) : null}

              <TextInput
                id="new-teacher-full-name"
                name="full_name"
                label="Ad Soyad"
                placeholder="ör. Ayşe Yılmaz"
                value={form.full_name}
                onChange={handleFieldChange}
                disabled={submitting}
                autoComplete="name"
                required
              />

              <TextInput
                id="new-teacher-email"
                name="email"
                type="email"
                label="E-posta"
                placeholder="ornek@eposta.com"
                value={form.email}
                onChange={handleFieldChange}
                disabled={submitting}
                autoComplete="email"
                required
              />

              <TextInput
                id="new-teacher-temporary-password"
                name="temporary_password"
                type="password"
                label="Geçici Şifre"
                placeholder="En az 8 karakter"
                value={form.temporary_password}
                onChange={handleFieldChange}
                disabled={submitting}
                autoComplete="new-password"
                hint="Öğretmen ilk girişten sonra değiştirebilir."
                required
              />

              <TextInput
                id="new-teacher-phone"
                name="phone"
                type="tel"
                label="Telefon (isteğe bağlı)"
                placeholder="ör. +90 5xx xxx xx xx"
                value={form.phone}
                onChange={handleFieldChange}
                disabled={submitting}
                autoComplete="tel"
              />

              <TextInput
                id="new-teacher-specialization"
                name="specialization"
                label="Branş"
                placeholder="ör. Matematik"
                value={form.specialization}
                onChange={handleFieldChange}
                disabled={submitting}
                required
              />

              <div className="w-full">
                <label
                  htmlFor="new-teacher-bio"
                  className="mb-1.5 block text-sm font-medium text-ink-text"
                >
                  Biyografi (isteğe bağlı)
                </label>
                <textarea
                  id="new-teacher-bio"
                  name="bio"
                  placeholder="Öğretmen hakkında kısa bilgi"
                  value={form.bio}
                  onChange={handleFieldChange}
                  disabled={submitting}
                  rows={4}
                  className={[
                    "w-full rounded-xl border border-line bg-ink px-3.5 py-3 text-sm text-ink-text",
                    "placeholder:text-subtle",
                    "transition-colors duration-200 hover:border-line-strong",
                    "focus:border-gold focus:outline-none focus:ring-2 focus:ring-offset-2",
                    "focus:ring-offset-ink focus:ring-gold/60",
                    "min-h-11 touch-manipulation resize-y",
                    "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line",
                  ].join(" ")}
                />
              </div>

              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SecondaryButton
                  type="button"
                  onClick={closeModal}
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
      ) : null}

      {pwdTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
          onClick={(e) => {
            if (pwdSubmitting) return;
            if (e.target === e.currentTarget) {
              setPwdTarget(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwd-modal-title"
        >
          <div
            ref={pwdPanelRef}
            tabIndex={-1}
            className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-0.5">
                <h2
                  id="pwd-modal-title"
                  className="text-base font-semibold tracking-tight text-ink-text"
                >
                  Şifre Sıfırla
                </h2>
                {pwdTarget.full_name?.trim() ? (
                  <span className="text-xs text-subtle">
                    {pwdTarget.full_name.trim()}
                  </span>
                ) : null}
              </div>
              <SecondaryButton
                onClick={closePwdModal}
                disabled={pwdSubmitting}
                className="w-auto px-4 py-2 text-xs"
                aria-label="Kapat"
              >
                Kapat
              </SecondaryButton>
            </div>

            <form
              onSubmit={handlePwdSubmit}
              className="flex flex-col gap-4 px-5 py-5 sm:px-6"
            >
              {pwdError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
                >
                  {pwdError}
                </p>
              ) : null}
              {pwdSuccess ? (
                <p
                  role="status"
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300"
                >
                  {pwdSuccess}
                </p>
              ) : null}

              <TextInput
                id="pwd-new"
                name="temporary_password"
                type="password"
                label="Yeni Geçici Şifre"
                placeholder="En az 8 karakter"
                value={pwdValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setPwdValue(e.target.value)
                }
                disabled={pwdSubmitting}
                autoComplete="new-password"
                hint="Öğretmen ilk girişten sonra değiştirebilir."
                required
              />

              <TextInput
                id="pwd-confirm"
                name="temporary_password_confirm"
                type="password"
                label="Yeni Şifre (Tekrar)"
                placeholder="Aynı şifreyi tekrar girin"
                value={pwdConfirm}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setPwdConfirm(e.target.value)
                }
                disabled={pwdSubmitting}
                autoComplete="new-password"
                required
              />

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <SecondaryButton
                  type="button"
                  onClick={closePwdModal}
                  disabled={pwdSubmitting}
                  className="w-full sm:w-auto"
                >
                  İptal
                </SecondaryButton>
                <PrimaryButton
                  type="submit"
                  disabled={pwdSubmitting}
                  className="w-full sm:w-auto"
                >
                  {pwdSubmitting ? "Şifre güncelleniyor..." : "Şifreyi Sıfırla"}
                </PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
          onClick={(e) => {
            if (editSubmitting) return;
            if (e.target === e.currentTarget) {
              setEditTarget(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-teacher-modal-title"
        >
          <div
            ref={editPanelRef}
            tabIndex={-1}
            className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-0.5">
                <h2
                  id="edit-teacher-modal-title"
                  className="text-base font-semibold tracking-tight text-ink-text"
                >
                  Öğretmeni Düzenle
                </h2>
                {editTarget.full_name?.trim() ? (
                  <span className="text-xs text-subtle">
                    {editTarget.full_name.trim()}
                  </span>
                ) : null}
              </div>
              <SecondaryButton
                onClick={closeEditModal}
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
                id="edit-teacher-full-name"
                name="full_name"
                label="Ad Soyad"
                placeholder="ör. Ayşe Yılmaz"
                value={editForm.full_name}
                onChange={handleEditFieldChange}
                disabled={editSubmitting}
                autoComplete="name"
                required
              />

              <TextInput
                id="edit-teacher-phone"
                name="phone"
                type="tel"
                label="Telefon (isteğe bağlı)"
                placeholder="ör. +90 5xx xxx xx xx"
                value={editForm.phone}
                onChange={handleEditFieldChange}
                disabled={editSubmitting}
                autoComplete="tel"
              />

              <TextInput
                id="edit-teacher-specialization"
                name="specialization"
                label="Branş"
                placeholder="ör. Matematik"
                value={editForm.specialization}
                onChange={handleEditFieldChange}
                disabled={editSubmitting}
                required
              />

              <div className="w-full">
                <label
                  htmlFor="edit-teacher-bio"
                  className="mb-1.5 block text-sm font-medium text-ink-text"
                >
                  Biyografi (isteğe bağlı)
                </label>
                <textarea
                  id="edit-teacher-bio"
                  name="bio"
                  placeholder="Öğretmen hakkında kısa bilgi"
                  value={editForm.bio}
                  onChange={handleEditFieldChange}
                  disabled={editSubmitting}
                  rows={4}
                  className={[
                    "w-full rounded-xl border border-line bg-ink px-3.5 py-3 text-sm text-ink-text",
                    "placeholder:text-subtle",
                    "transition-colors duration-200 hover:border-line-strong",
                    "focus:border-gold focus:outline-none focus:ring-2 focus:ring-offset-2",
                    "focus:ring-offset-ink focus:ring-gold/60",
                    "min-h-11 touch-manipulation resize-y",
                    "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line",
                  ].join(" ")}
                />
              </div>

              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SecondaryButton
                  type="button"
                  onClick={closeEditModal}
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

      {toggleTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
          onClick={(e) => {
            if (toggleSubmitting) return;
            if (e.target === e.currentTarget) {
              setToggleTarget(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="toggle-teacher-modal-title"
        >
          <div
            ref={togglePanelRef}
            tabIndex={-1}
            className="flex w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-line bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-0.5">
                <h2
                  id="toggle-teacher-modal-title"
                  className="text-base font-semibold tracking-tight text-ink-text"
                >
                  {toggleTarget.is_active !== false
                    ? "Öğretmeni Pasife Al"
                    : "Öğretmeni Aktif Et"}
                </h2>
                {toggleTarget.full_name?.trim() ? (
                  <span className="text-xs text-subtle">
                    {toggleTarget.full_name.trim()}
                  </span>
                ) : null}
              </div>
              <SecondaryButton
                onClick={closeToggleActiveModal}
                disabled={toggleSubmitting}
                className="w-auto px-4 py-2 text-xs"
                aria-label="Kapat"
              >
                Kapat
              </SecondaryButton>
            </div>

            <form
              onSubmit={handleToggleActiveSubmit}
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
                {toggleTarget.is_active !== false
                  ? "Bu öğretmeni pasife almak istediğinize emin misiniz? Öğretmen sisteme giriş yapamayacak ve öğrenciler tarafından görüntülenemeyecek."
                  : "Bu öğretmeni tekrar aktif etmek istediğinize emin misiniz?"}
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SecondaryButton
                  type="button"
                  onClick={closeToggleActiveModal}
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
                    : toggleTarget.is_active !== false
                      ? "Pasife Al"
                      : "Aktif Et"}
                </PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
          onClick={(e) => {
            if (deleteSubmitting) return;
            if (e.target === e.currentTarget) {
              setDeleteTarget(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-teacher-modal-title"
        >
          <div
            ref={deletePanelRef}
            tabIndex={-1}
            className="flex w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-red-500/40 bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-red-500/30 px-5 py-4 sm:px-6">
              <h2
                id="delete-teacher-modal-title"
                className="text-base font-semibold tracking-tight text-red-300"
              >
                Öğretmeni Kalıcı Sil
              </h2>
              <SecondaryButton
                onClick={closeDeleteModal}
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

              <p className="text-sm leading-relaxed text-ink-text">
                <span className="font-semibold text-ink-text">
                  {deleteTarget.full_name?.trim() || "İsimsiz"}
                </span>
                {" adlı öğretmeni kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz."}
              </p>
              <p className="text-xs leading-relaxed text-muted">
                Öğretmene bağlı müsaitlikler, öğrenci eşleştirmeleri ve ilgili
                kayıtlar etkilenebilir.
              </p>

              <TextInput
                id="delete-teacher-confirm"
                name="confirm_name"
                label="Onay için öğretmenin adını birebir yazın"
                placeholder={deleteTarget.full_name?.trim() || "Öğretmen adı"}
                value={deleteConfirmName}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setDeleteConfirmName(e.target.value)
                }
                disabled={deleteSubmitting}
                autoComplete="off"
              />

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <SecondaryButton
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={deleteSubmitting}
                  className="w-full sm:w-auto"
                >
                  Vazgeç
                </SecondaryButton>
                <PrimaryButton
                  type="submit"
                  disabled={
                    deleteSubmitting ||
                    deleteConfirmName.trim() !==
                      (deleteTarget.full_name ?? "").trim()
                  }
                  className="w-full sm:w-auto rounded-full border border-red-500/30 bg-red-500/10 text-red-300 transition-colors duration-200 hover:bg-red-500/20 active:bg-red-500/30 focus-visible:ring-red-400/60"
                >
                  {deleteSubmitting ? "Siliniyor..." : "Kalıcı Sil"}
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

function Avatar({
  name,
  url,
  size = "default",
}: {
  name: string | null;
  url?: string | null;
  size?: "default" | "large";
}) {
  const dim = size === "large" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs";
  if (url) {
    return (
      <Image
        src={url}
        alt={name?.trim() ? name.trim() : "Öğretmen"}
        width={size === "large" ? 44 : 36}
        height={size === "large" ? 44 : 36}
        className={[
          "inline-flex shrink-0 items-center justify-center rounded-full object-cover border border-line",
          dim,
        ].join(" ")}
        unoptimized
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-full",
        "border border-line bg-ink font-semibold text-gold",
        dim,
      ].join(" ")}
    >
      {initialsOf(name)}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge tone={active ? "gold" : "neutral"}>
      {active ? "Aktif" : "Pasif"}
    </Badge>
  );
}

function ActionButtons({
  t,
  onPwd,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  t: TeacherRow;
  onPwd: (t: TeacherRow) => void;
  onEdit: (t: TeacherRow) => void;
  onToggleActive: (t: TeacherRow) => void;
  onDelete: (t: TeacherRow) => void;
}) {
  const isActive = t.is_active !== false;
  const name = t.full_name?.trim() || "Öğretmen";

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <SecondaryButton
        onClick={() => onEdit(t)}
        aria-label={`${name} düzenle`}
        className="w-full px-3 py-2 text-xs sm:w-auto"
      >
        📝 Düzenle
      </SecondaryButton>
      <SecondaryButton
        onClick={() => onPwd(t)}
        aria-label={`${name} şifresini sıfırla`}
        className="w-full px-3 py-2 text-xs sm:w-auto"
      >
        🔑 Şifre Sıfırla
      </SecondaryButton>
      <SecondaryButton
        onClick={() => onToggleActive(t)}
        aria-label={
          isActive ? `${name} pasife al` : `${name} aktif et`
        }
        className="w-full px-3 py-2 text-xs sm:w-auto"
      >
        {isActive ? "⏸️ Pasife Al" : "▶️ Aktif Et"}
      </SecondaryButton>
      <SecondaryButton
        type="button"
        onClick={() => onDelete(t)}
        aria-label={`${name} kalıcı sil`}
        className="w-full px-3 py-2 text-xs sm:w-auto rounded-full border border-red-500/30 bg-transparent text-red-300 transition-colors duration-200 hover:bg-red-500/10 hover:border-red-500/50 active:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:ring-red-400/60"
      >
        🗑️ Kalıcı Sil
      </SecondaryButton>
    </div>
  );
}

function TeacherRowDesktop({
  t,
  onPwd,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  t: TeacherRow;
  onPwd: (t: TeacherRow) => void;
  onEdit: (t: TeacherRow) => void;
  onToggleActive: (t: TeacherRow) => void;
  onDelete: (t: TeacherRow) => void;
}) {
  const isActive = t.is_active !== false;
  return (
    <tr className="text-ink-text">
      <td className="py-3 pr-3">
        <div className="flex items-center gap-3">
          <Avatar name={t.full_name} url={t.avatar_url} />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {t.full_name?.trim() || "İsimsiz"}
            </span>
            <span className="text-xs text-subtle">
              {t.specialization?.trim() || "Branş belirtilmedi"}
            </span>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-muted">
        {t.phone?.trim() || "—"}
      </td>
      <td className="px-3 py-3">
        <StatusBadge active={isActive} />
      </td>
      <td className="px-3 py-3 text-xs text-subtle">
        {formatDateLongNoWeekday(t.created_at)}
      </td>
      <td className="px-3 py-3">
        <div className="flex justify-end">
          <ActionButtons
            t={t}
            onPwd={onPwd}
            onEdit={onEdit}
            onToggleActive={onToggleActive}
            onDelete={onDelete}
          />
        </div>
      </td>
    </tr>
  );
}

function TeacherRowMobile({
  t,
  onPwd,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  t: TeacherRow;
  onPwd: (t: TeacherRow) => void;
  onEdit: (t: TeacherRow) => void;
  onToggleActive: (t: TeacherRow) => void;
  onDelete: (t: TeacherRow) => void;
}) {
  const isActive = t.is_active !== false;
  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-start gap-3">
        <Avatar name={t.full_name} url={t.avatar_url} size="large" />
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium text-ink-text">
            {t.full_name?.trim() || "İsimsiz"}
          </span>
          <span className="text-xs text-subtle">
            {t.specialization?.trim() || "Branş belirtilmedi"}
          </span>
          <span className="text-xs text-muted">
            {t.phone?.trim() || "Telefon yok"}
          </span>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge active={isActive} />
            <span className="text-xs text-subtle">
              {formatDateLongNoWeekday(t.created_at)}
            </span>
          </div>
        </div>
      </div>
      <ActionButtons
        t={t}
        onPwd={onPwd}
        onEdit={onEdit}
        onToggleActive={onToggleActive}
        onDelete={onDelete}
      />
    </li>
  );
}
