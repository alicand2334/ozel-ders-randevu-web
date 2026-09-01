"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Card } from "@/components/ui";
import { NotificationToggleButton } from "@/components/pwa/NotificationToggleButton";

export default function OgrenciSecimPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/giris");
  };

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-6">
        <p className="text-sm text-muted">Yükleniyor...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="flex min-h-[100dvh] flex-col px-6 sm:px-10">
      <div className="flex flex-col justify-center flex-1 w-full max-w-4xl mx-auto py-12 sm:py-16 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground">Hoş Geldiniz</h1>
            <NotificationToggleButton showLabel={false} compact />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Card
            onClick={() => router.push("/panel")}
            className="group relative cursor-pointer flex flex-col items-center justify-center p-8 rounded-2xl border border-border bg-card transition-all duration-300 hover:border-yellow-500/50 hover:shadow-[0_0_30px_rgba(234,179,8,0.15)] hover:-translate-y-1"
          >
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-500 transition-all duration-300 group-hover:bg-yellow-500/20 group-hover:scale-110">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <h3 className="mb-2 text-2xl font-bold text-foreground">Randevu Al</h3>
            <p className="text-base text-muted-foreground text-center">Öğretmenlerle randevu oluşturun ve randevularınızı yönetin</p>
          </Card>

          <Card
            onClick={() => router.push("/ogrenci/homework")}
            className="group relative cursor-pointer flex flex-col items-center justify-center p-8 rounded-2xl border border-border bg-card transition-all duration-300 hover:border-yellow-500/50 hover:shadow-[0_0_30px_rgba(234,179,8,0.15)] hover:-translate-y-1"
          >
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-500 transition-all duration-300 group-hover:bg-yellow-500/20 group-hover:scale-110">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
            </div>
            <h3 className="mb-2 text-2xl font-bold text-foreground">Ödevlerim</h3>
            <p className="text-base text-muted-foreground text-center">Ödevlerinizi görüntüleyin ve takip edin</p>
          </Card>
        </div>
      </div>
    </main>
  );
}