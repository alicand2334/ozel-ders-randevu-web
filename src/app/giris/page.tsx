"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { isValidEmail, translateAuthError } from "@/lib/supabase/auth-helpers";
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  TextInput,
} from "@/components/ui";

export default function GirisPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function update(field: "email" | "password", value: string) {
    if (field === "email") setEmail(value);
    else setPassword(value);
    setErrors((p) => ({ ...p, [field]: "" }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = "E-posta zorunludur.";
    else if (!isValidEmail(email)) next.email = "Geçerli bir e-posta girin.";
    if (!password) next.password = "Şifre zorunludur.";
    else if (password.length < 6)
      next.password = "Şifre en az 6 karakter olmalıdır.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (error) {
      setServerError(translateAuthError(error));
      return;
    }
    router.push("/panel");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 sm:px-10">
      <div className="w-full max-w-md">
        <SectionTitle
          align="center"
          eyebrow="Tekrar Hoş Geldiniz"
          title="Giriş Yap"
          description="Hesabınıza giriş yaparak randevularınızı yönetin."
        />

        <Card className="mt-8" padding="roomy" raised>
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
            {serverError ? (
              <p
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
              >
                {serverError}
              </p>
            ) : null}

            <TextInput
              id="email"
              type="email"
              label="E-posta"
              autoComplete="email"
              placeholder="ornek@eposta.com"
              value={email}
              onChange={(e) => update("email", e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-err" : undefined}
            />
            {errors.email ? (
              <p id="email-err" className="-mt-2 text-xs text-red-400">
                {errors.email}
              </p>
            ) : null}

            <TextInput
              id="password"
              type="password"
              label="Şifre"
              autoComplete="current-password"
              placeholder="Şifreniz"
              value={password}
              onChange={(e) => update("password", e.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "password-err" : undefined}
            />
            {errors.password ? (
              <p id="password-err" className="-mt-2 text-xs text-red-400">
                {errors.password}
              </p>
            ) : null}

            <PrimaryButton type="submit" disabled={submitting} className="mt-2">
              {submitting ? "Giriş yapılıyor..." : "Giriş Yap"}
            </PrimaryButton>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted">
            <Badge tone="neutral">Yeni hesap mı gerekli?</Badge>
            <span className="text-muted">
              Hesaplar yalnızca yönetici tarafından oluşturulur.
            </span>
          </div>
        </Card>

        <div className="mt-6 text-center">
          <SecondaryButton onClick={() => router.push("/")} className="w-full">
            Ana Sayfaya Dön
          </SecondaryButton>
        </div>
      </div>
    </main>
  );
}
