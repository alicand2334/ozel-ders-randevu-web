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

const EMPTY_FORM: NewStudentForm = {
  full_name: "",
  email: "",
  temporary_password: "",
  phone: "",
};

type StudentRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  created_at: string;
  is_active: boolean | null;
  avatar_url: string | null;
};

const PAGE_SIZE = 10;

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AdminStudentsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [roleLoading, setRoleLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [state, setState] = useState<FetchState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NewStudentForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const modalPanelRef = useRef<HTMLDivElement>(null);

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

  const fetchStudents = useCallback(async () => {
    setState("loading");
    setErrorMsg(null);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, phone, role, created_at, is_active, avatar_url",
      )
      .eq("role", "student")
      .order("created_at", { ascending: false });
    if (error) {
      setErrorMsg(error.message);
      setState("error");
      return;
    }
    setStudents((data ?? []) as StudentRow[]);
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
          "id, full_name, phone, role, created_at, is_active, avatar_url",
        )
        .eq("role", "student")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        setErrorMsg(error.message);
        setState("error");
        return;
      }
      setStudents((data ?? []) as StudentRow[]);
      setState("ready");
    })();

    return () => {
      active = false;
    };
  }, [allowed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => {
      const name = (s.full_name ?? "").toLowerCase();
      const phone = (s.phone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [students, search]);

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

    setSubmitting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      if (!accessToken) {
        setFormError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/admin/students", {
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
        }),
      });

      const payload: CreateStudentResponse | CreateStudentApiError =
        await res.json();

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as CreateStudentApiError;
        setFormError(
          apiError.error ?? "Öğrenci oluşturulurken bir hata oluştu.",
        );
        setSubmitting(false);
        return;
      }

      setFormSuccess("Öğrenci başarıyla oluşturuldu.");
      setForm(EMPTY_FORM);
      setSubmitting(false);

      await fetchStudents();

      setTimeout(() => {
        setModalOpen(false);
        setFormSuccess(null);
      }, 1200);
    } catch {
      setFormError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.");
      setSubmitting(false);
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
            title="Öğrenci Yönetimi"
            description="Sistemdeki öğrenci hesaplarını görüntüleyin ve yeni öğrenci oluşturun."
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
              Öğrenci Listesi
            </h2>
            <div className="flex items-center gap-3">
              {state === "ready" ? (
                <Badge tone="neutral">{filtered.length} kayıt</Badge>
              ) : null}
              <PrimaryButton
                onClick={openModal}
                className="w-full sm:w-auto"
              >
                Yeni Öğrenci Ekle
              </PrimaryButton>
            </div>
          </div>

          <div className="mt-5">
            <TextInput
              id="search"
              type="search"
              label="Ara"
              placeholder="Ad veya telefona göre ara"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              aria-label="Öğrenci ara"
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
                  Öğrenciler yüklenemedi: {errorMsg ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton
                  onClick={fetchStudents}
                  className="w-full sm:w-auto"
                >
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">
                {search.trim()
                  ? "Aramayla eşleşen öğrenci bulunmuyor."
                  : "Henüz öğrenci kaydı bulunmuyor."}
              </p>
            ) : (
              <>
                {/* Masaüstü: tablo */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
                        <th className="py-2.5 pr-3 font-medium">Öğrenci</th>
                        <th className="px-3 py-2.5 font-medium">Telefon</th>
                        <th className="px-3 py-2.5 font-medium">Durum</th>
                        <th className="px-3 py-2.5 font-medium">Tarih</th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          İşlemler
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pageRows.map((s) => (
                        <StudentRowDesktop key={s.id} s={s} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobil: kart listesi */}
                <ul className="divide-y divide-line sm:hidden">
                  {pageRows.map((s) => (
                    <StudentRowMobile key={s.id} s={s} />
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
          aria-labelledby="new-student-modal-title"
        >
          <div
            ref={modalPanelRef}
            tabIndex={-1}
            className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-line bg-surface outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <h2
                id="new-student-modal-title"
                className="text-base font-semibold tracking-tight text-ink-text"
              >
                Yeni Öğrenci Ekle
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
                id="new-student-full-name"
                name="full_name"
                label="Ad Soyad"
                placeholder="ör. Mehmet Demir"
                value={form.full_name}
                onChange={handleFieldChange}
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
                onChange={handleFieldChange}
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
                onChange={handleFieldChange}
                disabled={submitting}
                autoComplete="new-password"
                hint="Öğrenci ilk girişten sonra değiştirebilir."
                required
              />

              <TextInput
                id="new-student-phone"
                name="phone"
                type="tel"
                label="Telefon (isteğe bağlı)"
                placeholder="ör. +90 5xx xxx xx xx"
                value={form.phone}
                onChange={handleFieldChange}
                disabled={submitting}
                autoComplete="tel"
              />

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
                  {submitting ? "Öğrenci oluşturuluyor..." : "Oluştur"}
                </PrimaryButton>
              </div>
            </form>
          </div>
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
        alt={name?.trim() ? name.trim() : "Öğrenci"}
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

function ActionButtons() {
  return (
    <div className="flex flex-wrap gap-2">
      <SecondaryButton
        disabled
        className="w-auto px-3 py-2 text-xs"
      >
        Düzenle
      </SecondaryButton>
      <SecondaryButton
        disabled
        className="w-auto px-3 py-2 text-xs"
      >
        Pasif Yap
      </SecondaryButton>
      <SecondaryButton
        disabled
        className="w-auto px-3 py-2 text-xs"
      >
        Sil
      </SecondaryButton>
    </div>
  );
}

function StudentRowDesktop({ s }: { s: StudentRow }) {
  const isActive = s.is_active !== false;
  return (
    <tr className="text-ink-text">
      <td className="py-3 pr-3">
        <div className="flex items-center gap-3">
          <Avatar name={s.full_name} url={s.avatar_url} />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {s.full_name?.trim() || "İsimsiz"}
            </span>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-muted">
        {s.phone?.trim() || "—"}
      </td>
      <td className="px-3 py-3">
        <StatusBadge active={isActive} />
      </td>
      <td className="px-3 py-3 text-xs text-subtle">
        {formatDateLongNoWeekday(s.created_at)}
      </td>
      <td className="px-3 py-3">
        <div className="flex justify-end">
          <ActionButtons />
        </div>
      </td>
    </tr>
  );
}

function StudentRowMobile({ s }: { s: StudentRow }) {
  const isActive = s.is_active !== false;
  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-start gap-3">
        <Avatar name={s.full_name} url={s.avatar_url} size="large" />
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium text-ink-text">
            {s.full_name?.trim() || "İsimsiz"}
          </span>
          <span className="text-xs text-muted">
            {s.phone?.trim() || "Telefon yok"}
          </span>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge active={isActive} />
            <span className="text-xs text-subtle">
              {formatDateLongNoWeekday(s.created_at)}
            </span>
          </div>
        </div>
      </div>
      <ActionButtons />
    </li>
  );
}
