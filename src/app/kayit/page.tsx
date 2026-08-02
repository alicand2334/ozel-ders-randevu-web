"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function KayitPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/giris");
  }, [router]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16 sm:px-10">
      <p className="text-sm text-muted">Giriş sayfasına yönlendiriliyorsunuz...</p>
    </main>
  );
}
