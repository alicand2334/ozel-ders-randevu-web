import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { primaryButtonClasses } from "@/components/ui/button-classes";

const features = [
  {
    title: "Kolay Randevu",
    description:
      "Birkaç adımda ders gününü oluştur. Karmaşık formlarla uğraşmadan randevunu planla.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25M3 18.75a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18.75M3 18.75h18M7.5 12h.008v.008H7.5V12Z"
      />
    ),
  },
  {
    title: "Uygun Saat Seçimi",
    description:
      "Uygun saatleri anında gör; sana en uygun zamanı seçerek programa yerleş.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z"
      />
    ),
  },
  {
    title: "Hızlı Onay",
    description:
      "Randevu talebin hızla değerlendirilir; onay sonrası anında takvimine eklenir.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m4.5 12.75 6 6 9-13.5"
      />
    ),
  },
] as const;

function FeatureIcon({ path }: { path: React.ReactNode }) {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold/25 bg-gold-soft text-gold">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={1.6}
        stroke="currentColor"
        className="h-5 w-5"
        aria-hidden="true"
      >
        {path}
      </svg>
    </span>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="flex flex-1 flex-col items-center justify-center px-6 py-20 sm:px-10 sm:py-28">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
            <Badge>Premium Randevu Sistemi</Badge>

            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-ink-text sm:text-5xl md:text-6xl">
              Özel Ders Randevu
            </h1>

            <p className="mt-5 max-w-md text-base leading-relaxed text-muted sm:text-lg">
              Ders gününü ve saatini kolayca seç.
            </p>

            <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
              <Link
                href="/giris"
                className={`${primaryButtonClasses} w-full sm:w-auto`}
              >
                Giriş Yap
              </Link>
            </div>
          </div>
        </section>

        {/* Öne çıkan özellikler */}
        <section className="px-6 pb-20 sm:px-10 sm:pb-28">
          <div className="mx-auto grid w-full max-w-5xl gap-4 sm:grid-cols-3 sm:gap-5">
            {features.map((f) => (
              <Card key={f.title} raised padding="roomy" className="h-full">
                <FeatureIcon path={f.icon} />
                <h3 className="mt-4 text-base font-semibold text-ink-text">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {f.description}
                </p>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-6 py-6 sm:px-10">
        <p className="mx-auto max-w-5xl text-center text-xs text-subtle">
          Özel Ders Randevu &middot; Mobil öncelikli premium tasarım
        </p>
      </footer>
    </div>
  );
}
