"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  Badge,
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
} from "@/components/ui";
import { primaryButtonClasses } from "@/components/ui/button-classes";

type FetchState = "loading" | "ready" | "error";

type AdminModule = {
  key: string;
  title: string;
  description: string;
  eyebrow: string;
  tone: "gold" | "neutral";
};

const MODULES: AdminModule[] = [
  {
    key: "teachers",
    title: "Öğretmen Yönetimi",
    description:
      "Öğretmenleri görüntüleyin, yeni öğretmen ekleyin, branş ve ders atamalarını yönetin.",
    eyebrow: "Kullanıcılar",
    tone: "gold",
  },
  {
    key: "students",
    title: "Öğrenci Yönetimi",
    description:
      "Öğrenci hesaplarını görüntüleyin, pasife alın veya kaldırın.",
    eyebrow: "Kullanıcılar",
    tone: "neutral",
  },
  {
    key: "lessons",
    title: "Ders Yönetimi",
    description:
      "Sistemde tanımlı ders listesini ve ders kategorilerini yönetin.",
    eyebrow: "Sistem",
    tone: "neutral",
  },
  {
    key: "appointments",
    title: "Randevu Yönetimi",
    description:
      "Tüm randevuları listeyin; filtreleyin, durumları takip edin ve denetleyin.",
    eyebrow: "İşlemler",
    tone: "gold",
  },
  {
    key: "notifications",
    title: "Bildirimler",
    description:
      "Sistem genelinde gönderilen bildirimleri görüntüleyin ve yönetin.",
    eyebrow: "İletişim",
    tone: "neutral",
  },
  {
    key: "settings",
    title: "Sistem Ayarları",
    description:
      "Genel sistem ayarlarını, yetki politikalarını ve yapılandırmaları yönetin.",
    eyebrow: "Sistem",
    tone: "neutral",
  },
] as const;

export default function AdminPanelPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [roleLoading, setRoleLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [state, setState] = useState<FetchState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        setState("error");
        setErrorMsg(error.message);
        return;
      }

      if (data?.role === "admin") {
        setAllowed(true);
        setState("ready");
        setRoleLoading(false);
        return;
      }

      if (data?.role === "teacher") {
        router.replace("/panel/ogretmen");
        return;
      }

      router.replace("/panel");
      setRoleLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loading, user, router]);

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
        <SectionTitle
          align="left"
          eyebrow="Yönetici Paneli"
          title="Sistem Yönetimi"
          description="Platform genelinde kullanıcıları, dersleri ve randevuları yönetin."
        />

        {state === "error" ? (
          <Card className="mt-6 sm:mt-8" padding="roomy" raised>
            <p
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
            >
              Yetki bilgisi yüklenemedi: {errorMsg ?? "Bilinmeyen hata"}
            </p>
          </Card>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-5">
            {MODULES.map((m) => (
              <Card key={m.key} padding="roomy" raised className="h-full">
                <div className="flex items-center justify-between gap-3">
                  <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                    {m.eyebrow}
                  </span>
                  <Badge tone={m.tone}>Pasif</Badge>
                </div>
                <h2 className="mt-3 text-base font-semibold tracking-tight text-ink-text">
                  {m.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {m.description}
                </p>
                <div className="mt-5">
                  {m.key === "teachers" ? (
                    <Link
                      href="/panel/admin/teachers"
                      className={`${primaryButtonClasses} w-full sm:w-auto`}
                    >
                      Aç
                    </Link>
                  ) : m.key === "students" ? (
                    <Link
                      href="/panel/admin/students"
                      className={`${primaryButtonClasses} w-full sm:w-auto`}
                    >
                      Aç
                    </Link>
                  ) : (
                    <SecondaryButton
                      disabled
                      className="w-full sm:w-auto"
                      aria-disabled="true"
                    >
                      Yakında
                    </SecondaryButton>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

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
    </main>
  );
}
