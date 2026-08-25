"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent, FormEvent } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth/AuthProvider"
import { isValidEmail } from "@/lib/supabase/auth-helpers"
import { formatDateLongNoWeekday } from "@/lib/datetime"
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  TextInput,
} from "@/components/ui"

type FetchState = "loading" | "ready" | "error"

type NewStudentForm = {
  full_name: string
  email: string
  temporary_password: string
  phone: string
}

type CreateStudentResponse = {
  id: string
  full_name: string
  email: string
  is_active: boolean
}

type CreateStudentApiError = { error?: string }

type DeleteStudentApiResponse = {
  message?: string
  error?: string
}

type EditStudentForm = {
  full_name: string
  phone: string
}

type EditStudentResponse = {
  id: string
  full_name: string | null
  phone: string | null
  is_active: boolean
}

const EMPTY_EDIT_FORM: EditStudentForm = {
  full_name: "",
  phone: "",
}

const EMPTY_FORM: NewStudentForm = {
  full_name: "",
  email: "",
  temporary_password: "",
  phone: "",
}

type StudentRow = {
  id: string
  full_name: string | null
  phone: string | null
  role: string | null
  created_at: string
  is_active: boolean | null
  avatar_url: string | null
}

const PAGE_SIZE = 10

function initialsOf(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function AdminStudentsPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [roleLoading, setRoleLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)

  const [students, setStudents] = useState<StudentRow[]>([])
  const [state, setState] = useState<FetchState>("loading")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<NewStudentForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const modalPanelRef = useRef<HTMLDivElement>(null)

  const [pwdTarget, setPwdTarget] = useState<StudentRow | null>(null)
  const [pwdValue, setPwdValue] = useState("")
  const [pwdConfirm, setPwdConfirm] = useState("")
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null)
  const [pwdSubmitting, setPwdSubmitting] = useState(false)
  const pwdPanelRef = useRef<HTMLDivElement>(null)

  const [editTarget, setEditTarget] = useState<StudentRow | null>(null)
  const [editForm, setEditForm] = useState<EditStudentForm>(EMPTY_EDIT_FORM)
  const [editError, setEditError] = useState<string | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const editPanelRef = useRef<HTMLDivElement>(null)

  const [toggleTarget, setToggleTarget] = useState<StudentRow | null>(null)
  const [toggleSubmitting, setToggleSubmitting] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const togglePanelRef = useRef<HTMLDivElement>(null)

  const [deleteTarget, setDeleteTarget] = useState<StudentRow | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState("")
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deletePanelRef = useRef<HTMLDivElement>(null)

  const openModal = useCallback(() => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormSuccess(null)
    setSubmitting(false)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    if (submitting) return
    setModalOpen(false)
    setFormError(null)
    setFormSuccess(null)
  }, [submitting])

  const openPwdModal = useCallback((s: StudentRow) => {
    setPwdTarget(s)
    setPwdValue("")
    setPwdConfirm("")
    setPwdError(null)
    setPwdSuccess(null)
    setPwdSubmitting(false)
  }, [])

  const closePwdModal = useCallback(() => {
    if (pwdSubmitting) return
    setPwdTarget(null)
    setPwdError(null)
    setPwdSuccess(null)
  }, [pwdSubmitting])

  const openEditModal = useCallback((s: StudentRow) => {
    setEditTarget(s)
    setEditForm({
      full_name: s.full_name?.trim() ?? "",
      phone: s.phone?.trim() ?? "",
    })
    setEditError(null)
    setEditSubmitting(false)
  }, [])

  const closeEditModal = useCallback(() => {
    if (editSubmitting) return
    setEditTarget(null)
    setEditError(null)
  }, [editSubmitting])

  const openToggleActiveModal = useCallback((s: StudentRow) => {
    setToggleTarget(s)
    setToggleError(null)
    setToggleSubmitting(false)
  }, [])

  const closeToggleActiveModal = useCallback(() => {
    if (toggleSubmitting) return
    setToggleTarget(null)
    setToggleError(null)
  }, [toggleSubmitting])

  const openDeleteModal = useCallback((s: StudentRow) => {
    setDeleteTarget(s)
    setDeleteConfirmName("")
    setDeleteError(null)
    setDeleteSubmitting(false)
  }, [])

  const closeDeleteModal = useCallback(() => {
    if (deleteSubmitting) return
    setDeleteTarget(null)
    setDeleteConfirmName("")
    setDeleteError(null)
  }, [deleteSubmitting])

  useEffect(() => {
    if (!modalOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) {
        setModalOpen(false)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [modalOpen, submitting])

  useEffect(() => {
    if (!modalOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    modalPanelRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [modalOpen])

  useEffect(() => {
    if (!pwdTarget) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pwdSubmitting) {
        setPwdTarget(null)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [pwdTarget, pwdSubmitting])

  useEffect(() => {
    if (!pwdTarget) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    pwdPanelRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [pwdTarget])

  useEffect(() => {
    if (!editTarget) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !editSubmitting) {
        setEditTarget(null)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [editTarget, editSubmitting])

  useEffect(() => {
    if (!editTarget) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    editPanelRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [editTarget])

  useEffect(() => {
    if (!toggleTarget) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !toggleSubmitting) {
        setToggleTarget(null)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [toggleTarget, toggleSubmitting])

  useEffect(() => {
    if (!toggleTarget) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    togglePanelRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [toggleTarget])

  useEffect(() => {
    if (!deleteTarget) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleteSubmitting) {
        setDeleteTarget(null)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [deleteTarget, deleteSubmitting])

  useEffect(() => {
    if (!deleteTarget) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    deletePanelRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [deleteTarget])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => {
      setToast(null)
    }, 2500)
    return () => {
      window.clearTimeout(id)
    }
  }, [toast])

  function handleEditFieldChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setEditForm((prev) => ({ ...prev, [name]: value }))
  }

  function handleFieldChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/giris")
    }
  }, [loading, user, router])

  useEffect(() => {
    let active = true
    if (loading || !user) return

    ;(async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
      if (!active) return
      if (error) {
        setRoleLoading(false)
        return
      }
      if (data?.role === "teacher") {
        router.replace("/panel/ogretmen")
        return
      }
      if (data?.role === "student") {
        router.replace("/panel")
        return
      }
      if (data?.role === "admin") {
        setAllowed(true)
      }
      setRoleLoading(false)
    })()

    return () => {
      active = false
    }
  }, [loading, user, router])

  const fetchStudents = useCallback(async () => {
    setState("loading")
    setErrorMsg(null)
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, phone, role, created_at, is_active, avatar_url",
      )
      .eq("role", "student")
      .order("created_at", { ascending: false })
    if (error) {
      setErrorMsg(error.message)
      setState("error")
      return
    }
    setStudents((data ?? []) as StudentRow[])
    setState("ready")
  }, [])

  useEffect(() => {
    if (!allowed) return
    let active = true

    ;(async () => {
      setState("loading")
      setErrorMsg(null)
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, phone, role, created_at, is_active, avatar_url",
        )
        .eq("role", "student")
        .order("created_at", { ascending: false })
      if (!active) return
      if (error) {
        setErrorMsg(error.message)
        setState("error")
        return
      }
      setStudents((data ?? []) as StudentRow[])
      setState("ready")
    })()

    return () => {
      active = false
    }
  }, [allowed])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) => {
      const name = (s.full_name ?? "").toLowerCase()
      const phone = (s.phone ?? "").toLowerCase()
      return name.includes(q) || phone.includes(q)
    })
  }, [students, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return

    setFormError(null)
    setFormSuccess(null)

    const fullName = form.full_name.trim()
    const email = form.email.trim()
    const temporaryPassword = form.temporary_password

    if (!fullName) {
      setFormError("Ad Soyad boş olamaz.")
      return
    }
    if (!isValidEmail(email)) {
      setFormError("Geçerli bir e-posta adresi girin.")
      return
    }
    if (temporaryPassword.length < 8) {
      setFormError("Geçici şifre en az 8 karakter olmalı.")
      return
    }

    setSubmitting(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token ?? null

      if (!accessToken) {
        setFormError("Oturum bulunamadı. Lütfen tekrar giriş yapın.")
        setSubmitting(false)
        return
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
      })

      const payload: CreateStudentResponse | CreateStudentApiError =
        await res.json()

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as CreateStudentApiError
        setFormError(
          apiError.error ?? "Öğrenci oluşturulurken bir hata oluştu.",
        )
        setSubmitting(false)
        return
      }

      setFormSuccess("Öğrenci başarıyla oluşturuldu.")
      setForm(EMPTY_FORM)
      setSubmitting(false)

      await fetchStudents()

      setTimeout(() => {
        setModalOpen(false)
        setFormSuccess(null)
      }, 1200)
    } catch {
      setFormError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.")
      setSubmitting(false)
    }
  }

  async function handlePwdSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pwdSubmitting || !pwdTarget) return

    setPwdError(null)
    setPwdSuccess(null)

    if (pwdValue.length < 8) {
      setPwdError("Yeni geçici şifre en az 8 karakter olmalı.")
      return
    }
    if (pwdValue !== pwdConfirm) {
      setPwdError("Girilen şifreler eşleşmiyor.")
      return
    }

    setPwdSubmitting(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token ?? null

      if (!accessToken) {
        setPwdError("Oturum bulunamadı. Lütfen tekrar giriş yapın.")
        setPwdSubmitting(false)
        return
      }

      const res = await fetch(
        `/api/admin/students/${encodeURIComponent(pwdTarget.id)}/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ temporary_password: pwdValue }),
        },
      )

      const payload: { message?: string; error?: string } = await res.json()

      if (!res.ok) {
        setPwdError(
          payload.error ?? "Şifre güncellenirken bir hata oluştu.",
        )
        setPwdSubmitting(false)
        return
      }

      setPwdSuccess("Öğrenci şifresi başarıyla güncellendi.")
      setPwdValue("")
      setPwdConfirm("")
      setPwdSubmitting(false)

      setTimeout(() => {
        setPwdTarget(null)
        setPwdSuccess(null)
      }, 1200)
    } catch {
      setPwdError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.")
      setPwdSubmitting(false)
    }
  }

  async function handleEditSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (editSubmitting || !editTarget) return

    setEditError(null)

    const fullName = editForm.full_name.trim()

    if (!fullName) {
      setEditError("Ad soyad boş olamaz.")
      return
    }

    setEditSubmitting(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token ?? null

      if (!accessToken) {
        setEditError("Oturum bulunamadı. Lütfen tekrar giriş yapın.")
        setEditSubmitting(false)
        return
      }

      const res = await fetch(
        `/api/admin/students/${encodeURIComponent(editTarget.id)}`,
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
      )

      const payload: EditStudentResponse | CreateStudentApiError =
        await res.json()

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as CreateStudentApiError
        setEditError(
          apiError.error ?? "Öğrenci güncellenirken bir hata oluştu.",
        )
        setEditSubmitting(false)
        return
      }

      const updated = payload as EditStudentResponse

      setStudents((prev) =>
        prev.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                full_name: updated.full_name,
                phone: updated.phone,
              }
            : row,
        ),
      )

      setEditSubmitting(false)
      setEditTarget(null)
    } catch {
      setEditError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.")
      setEditSubmitting(false)
    }
  }

  async function handleToggleActiveSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (toggleSubmitting || !toggleTarget) return

    setToggleError(null)
    const nextActive = toggleTarget.is_active !== false ? false : true

    setToggleSubmitting(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token ?? null

      if (!accessToken) {
        setToggleError("Oturum bulunamadı. Lütfen tekrar giriş yapın.")
        setToggleSubmitting(false)
        return
      }

      const res = await fetch(
        `/api/admin/students/${encodeURIComponent(toggleTarget.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ is_active: nextActive }),
        },
      )

      const payload: EditStudentResponse | CreateStudentApiError =
        await res.json()

      if (!res.ok || !("id" in payload)) {
        const apiError = payload as CreateStudentApiError
        setToggleError(
          apiError.error ?? "Durum güncellenirken bir hata oluştu.",
        )
        setToggleSubmitting(false)
        return
      }

      const updated = payload as EditStudentResponse

      setStudents((prev) =>
        prev.map((row) =>
          row.id === updated.id
            ? { ...row, is_active: updated.is_active }
            : row,
        ),
      )

      setToast(
        updated.is_active
          ? "Öğrenci tekrar aktif edildi."
          : "Öğrenci pasife alındı.",
      )
      setToggleSubmitting(false)
      setToggleTarget(null)
    } catch {
      setToggleError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.")
      setToggleSubmitting(false)
    }
  }

  async function handleDeleteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (deleteSubmitting || !deleteTarget) return

    setDeleteError(null)

    const expectedName = (deleteTarget.full_name ?? "").trim()
    const inputName = deleteConfirmName.trim()

    if (!inputName) {
      setDeleteError("Onay için öğrencinin adını yazın.")
      return
    }
    if (inputName !== expectedName) {
      setDeleteError("Yazdığınız ad öğrencinin adıyla eşleşmiyor.")
      return
    }

    setDeleteSubmitting(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token ?? null

      if (!accessToken) {
        setDeleteError("Oturum bulunamadı. Lütfen tekrar giriş yapın.")
        setDeleteSubmitting(false)
        return
      }

      const res = await fetch(
        `/api/admin/students/${encodeURIComponent(deleteTarget.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      )

      const payload: DeleteStudentApiResponse = await res.json()

      if (!res.ok) {
        setDeleteError(
          payload?.error ?? "Öğrenci silinirken bir hata oluştu.",
        )
        setDeleteSubmitting(false)
        return
      }

      setStudents((prev) => prev.filter((row) => row.id !== deleteTarget.id))
      setToast(`Öğrenci silindi: ${expectedName}`)
      setDeleteSubmitting(false)
      setDeleteTarget(null)
      setDeleteConfirmName("")
      setDeleteError(null)
    } catch {
      setDeleteError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.")
      setDeleteSubmitting(false)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace("/giris")
  }

  if (loading || (user && roleLoading)) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="text-sm text-muted">Yükleniyor...</p>
      </main>
    )
  }

  if (!user || !allowed) {
    return null
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 py-8 sm:px-10">
      <div className="w-full max-w-4xl mx-auto space-y-6">
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

        <Card className="overflow-hidden" padding="snug">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Öğrenci Listesi</h2>
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
                setSearch(e.target.value)
                setPage(1)
              }}
              aria-label="Öğrenci ara"
            />
          </div>

          <div className="mt-5">
            {state === "loading" ? (
              <p className="text-sm text-muted-foreground text-center py-8">Yükleniyor...</p>
            ) : state === "error" ? (
              <div className="flex flex-col gap-3 text-center py-4">
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                >
                  Öğrenciler yüklenemedi: {errorMsg ?? "Bilinmeyen hata"}
                </p>
                <SecondaryButton
                  onClick={fetchStudents}
                  className="w-full sm:w-auto mx-auto"
                >
                  Tekrar Dene
                </SecondaryButton>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted-foreground text-center py-8">
                {search.trim()
                  ? "Aramayla eşleşen öğrenci bulunmuyor."
                  : "Henüz öğrenci kaydı bulunmuyor."}
              </p>
            ) : (
              <>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
                        <th className="py-2.5 pr-3 font-medium">Öğrenci</th>
                        <th className="px-3 py-2.5 font-medium">Telefon</th>
                        <th className="px-3 py-2.5 font-medium">Durum</th>
                        <th className="px-3 py-2.5 font-medium">Tarih</th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          İşlemler
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageRows.map((s) => (
                        <StudentRowDesktop
                          key={s.id}
                          s={s}
                          onPwd={openPwdModal}
                          onEdit={openEditModal}
                          onToggleActive={openToggleActiveModal}
                          onDelete={openDeleteModal}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="divide-y divide-border sm:hidden">
                  {pageRows.map((s) => (
                    <StudentRowMobile
                      key={s.id}
                      s={s}
                      onPwd={openPwdModal}
                      onEdit={openEditModal}
                      onToggleActive={openToggleActiveModal}
                      onDelete={openDeleteModal}
                    />
                  ))}
                </ul>

                {totalPages > 1 ? (
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
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

        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryButton onClick={handleSignOut} className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white focus-visible:ring-red-500">
            Çıkış Yap
          </PrimaryButton>
          <SecondaryButton
            onClick={() => router.push("/")}
            className="w-full sm:w-auto"
          >
            Ana Sayfa
          </SecondaryButton>
        </div>

        {modalOpen ? (
          <Modal
            open={modalOpen}
            onClose={closeModal}
            title="Yeni Öğrenci Ekle"
            submitLabel="Oluştur"
            submitting={submitting}
            onSubmit={handleSubmit}
            panelRef={modalPanelRef}
            error={formError}
            success={formSuccess}
          >
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
          </Modal>
        ) : null}

        {pwdTarget ? (
          <Modal
            open={true}
            onClose={closePwdModal}
            title="Şifre Sıfırla"
            subtitle={pwdTarget.full_name?.trim()}
            submitLabel="Şifreyi Sıfırla"
            submitting={pwdSubmitting}
            onSubmit={handlePwdSubmit}
            panelRef={pwdPanelRef}
            error={pwdError}
            success={pwdSuccess}
          >
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
              hint="Öğrenci ilk girişten sonra değiştirebilir."
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
          </Modal>
        ) : null}

        {editTarget ? (
          <Modal
            open={true}
            onClose={closeEditModal}
            title="Öğrenciyi Düzenle"
            subtitle={editTarget.full_name?.trim()}
            submitLabel="Kaydet"
            submitting={editSubmitting}
            onSubmit={handleEditSubmit}
            panelRef={editPanelRef}
            error={editError}
          >
            <TextInput
              id="edit-student-full-name"
              name="full_name"
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

        {toggleTarget ? (
          <Modal
            open={true}
            onClose={closeToggleActiveModal}
            title={toggleTarget.is_active !== false ? "Öğrenciyi Pasife Al" : "Öğrenciyi Aktif Et"}
            subtitle={toggleTarget.full_name?.trim()}
            submitLabel={toggleTarget.is_active !== false ? "Pasife Al" : "Aktif Et"}
            submitting={toggleSubmitting}
            onSubmit={handleToggleActiveSubmit}
            panelRef={togglePanelRef}
            error={toggleError}
          >
            <p className="text-sm leading-relaxed text-foreground">
              {toggleTarget.is_active !== false
                ? "Bu öğrenciyi pasife almak istediğinize emin misiniz? Öğrenci sisteme giriş yapamayacak ve yeni randevu oluşturamayacak."
                : "Bu öğrenciyi tekrar aktif etmek istediğinize emin misiniz?"}
            </p>
          </Modal>
        ) : null}

        {deleteTarget ? (
          <Modal
            open={true}
            onClose={closeDeleteModal}
            title="Öğrenciyi Kalıcı Sil"
            subtitle={deleteTarget.full_name?.trim()}
            submitLabel="Kalıcı Sil"
            submitting={deleteSubmitting}
            onSubmit={handleDeleteSubmit}
            panelRef={deletePanelRef}
            error={deleteError}
            danger
          >
            <p className="text-sm leading-relaxed text-foreground">
              <span className="font-semibold text-foreground">
                {deleteTarget.full_name?.trim() || "İsimsiz"}
              </span>
              {" adlı öğrenciyi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz."}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Öğrenciye bağlı randevular ve öğretmen eşleştirmeleri
              etkilenebilir.
            </p>

            <TextInput
              id="delete-student-confirm"
              name="confirm_name"
              label="Onay için öğrencinin adını birebir yazın"
              placeholder={deleteTarget.full_name?.trim() || "Öğrenci adı"}
              value={deleteConfirmName}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setDeleteConfirmName(e.target.value)
              }
              disabled={deleteSubmitting}
              autoComplete="off"
            />
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
  )
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
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string | null
  submitLabel: string
  submitting: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  panelRef: React.RefObject<HTMLDivElement | null>
  error?: string | null
  success?: string | null
  danger?: boolean
  children: React.ReactNode
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center sm:py-10"
      onClick={(e) => {
        if (submitting) return
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`flex w-full max-w-lg flex-col overflow-y-auto rounded-2xl border ${
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
              İptal
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
              {submitting ? (danger ? "Siliniyor..." : "Kaydediliyor...") : submitLabel}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  )
}

function Avatar({
  name,
  url,
  size = "default",
}: {
  name: string | null
  url?: string | null
  size?: "default" | "large"
}) {
  const dim = size === "large" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs"
  if (url) {
    return (
      <Image
        src={url}
        alt={name?.trim() ? name.trim() : "Öğrenci"}
        width={size === "large" ? 44 : 36}
        height={size === "large" ? 44 : 36}
        className={[
          "inline-flex shrink-0 items-center justify-center rounded-full object-cover border border-border",
          dim,
        ].join(" ")}
        unoptimized
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-full",
        "border border-border bg-yellow-500/20 font-semibold text-black",
        dim,
      ].join(" ")}
    >
      {initialsOf(name)}
    </span>
  )
}

function StudentRowDesktop({
  s,
  onPwd,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  s: StudentRow
  onPwd: (s: StudentRow) => void
  onEdit: (s: StudentRow) => void
  onToggleActive: (s: StudentRow) => void
  onDelete: (s: StudentRow) => void
}) {
  const isActive = s.is_active !== false
  const name = s.full_name?.trim() || "Öğrenci"

  return (
    <tr className="text-foreground">
      <td className="py-3 pr-3">
        <div className="flex items-center gap-3">
          <Avatar name={s.full_name} url={s.avatar_url} size="default" />
          <div>
            <span className="font-medium">{name}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{s.phone?.trim() || "—"}</td>
      <td className="px-3 py-2.5">
        <Badge tone={isActive ? "gold" : "neutral"}>
          {isActive ? "Aktif" : "Pasif"}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">
        {formatDateLongNoWeekday(s.created_at)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <ActionButtonsDesktop
          s={s}
          onPwd={onPwd}
          onEdit={onEdit}
          onToggleActive={onToggleActive}
          onDelete={onDelete}
        />
      </td>
    </tr>
  )
}

function StudentRowMobile({
  s,
  onPwd,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  s: StudentRow
  onPwd: (s: StudentRow) => void
  onEdit: (s: StudentRow) => void
  onToggleActive: (s: StudentRow) => void
  onDelete: (s: StudentRow) => void
}) {
  const isActive = s.is_active !== false
  const name = s.full_name?.trim() || "Öğrenci"

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <Avatar name={s.full_name} url={s.avatar_url} size="default" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{name}</span>
            <Badge tone={isActive ? "gold" : "neutral"}>
              {isActive ? "Aktif" : "Pasif"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{formatDateLongNoWeekday(s.created_at)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <SecondaryButton onClick={() => onEdit(s)} className="w-full sm:w-auto">Düzenle</SecondaryButton>
        <SecondaryButton onClick={() => onPwd(s)} className="w-full sm:w-auto">Şifre Sıfırla</SecondaryButton>
        <SecondaryButton onClick={() => onToggleActive(s)} className="w-full sm:w-auto">{isActive ? "Pasife Al" : "Aktif Et"}</SecondaryButton>
        <SecondaryButton onClick={() => onDelete(s)} className="w-full sm:w-auto rounded-full border border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10">Sil</SecondaryButton>
      </div>
    </li>
  )
}

function ActionButtonsDesktop({
  s,
  onPwd,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  s: StudentRow
  onPwd: (s: StudentRow) => void
  onEdit: (s: StudentRow) => void
  onToggleActive: (s: StudentRow) => void
  onDelete: (s: StudentRow) => void
}) {
  const isActive = s.is_active !== false
  const name = s.full_name?.trim() || "Öğrenci"

  return (
    <div className="flex items-center justify-end gap-2">
      <SecondaryButton
        onClick={() => onEdit(s)}
        aria-label={`${name} düzenle`}
        className="px-3 py-2 text-xs"
      >
        Düzenle
      </SecondaryButton>
      <SecondaryButton
        onClick={() => onPwd(s)}
        aria-label={`${name} şifresini sıfırla`}
        className="px-3 py-2 text-xs"
      >
        Şifre Sıfırla
      </SecondaryButton>
      <SecondaryButton
        onClick={() => onToggleActive(s)}
        aria-label={isActive ? `${name} pasife al` : `${name} aktif et`}
        className="px-3 py-2 text-xs"
      >
        {isActive ? "Pasife Al" : "Aktif Et"}
      </SecondaryButton>
      <SecondaryButton
        type="button"
        onClick={() => onDelete(s)}
        aria-label={`${name} kalıcı sil`}
        className="px-3 py-2 text-xs rounded-full border border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
      >
        Sil
      </SecondaryButton>
    </div>
  )
}