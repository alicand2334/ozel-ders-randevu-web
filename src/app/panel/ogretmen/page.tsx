"use client";

import { useState } from "react";
import InnerPanel from "./InnerPanel";
import OgretmenHomeworkPage from "./dev-takibi/page";

export default function OgretmenPanelPage() {
  const [view, setView] = useState<'menu' | 'appointments' | 'homework'>('menu');

  if (view === 'menu') {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="space-y-8 w-full max-w-2xl">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-ink-text">Hoş Geldiniz Hocam</h1>
            <p className="mt-2 text-sm text-muted">Yapmak istediğiniz işlemi seçin</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div
              onClick={() => setView('appointments')}
              className="group relative cursor-pointer flex flex-col items-center p-8 border border-surface/20 rounded-xl bg-surface/50 hover:border-gold/20 hover:bg-gold/5 transition-colors"
            >
              <div className="mb-6 h-12 w-12 flex items-center justify-center bg-gold/10 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gold" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-ink-text">Randevularını Ayarla</h3>
              <p className="text-sm text-muted text-center">Takvimini ve müsaitliklerini yönet</p>
            </div>
            <div
              onClick={() => setView('homework')}
              className="group relative cursor-pointer flex flex-col items-center p-8 border border-surface/20 rounded-xl bg-surface/50 hover:border-gold/20 hover:bg-gold/5 transition-colors"
            >
              <div className="mb-6 h-12 w-12 flex items-center justify-center bg-gold/10 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gold" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-ink-text">Ödevlendirme Yap</h3>
              <p className="text-sm text-muted text-center">Öğrencilerine ödev ver ve takip et</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'appointments') {
    return <InnerPanel onBackToMenu={() => setView('menu')} />;
  }

  if (view === 'homework') {
    return <OgretmenHomeworkPage onBack={() => setView('menu')} />;
  }

  return null;
}