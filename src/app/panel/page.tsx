"use client";

import { Suspense, lazy } from "react";

const PanelInner = lazy(() => import("./PanelInner"));

export default function PanelPage() {
  return (
    <Suspense fallback={<p>Yükleniyor...</p>}>
      <PanelInner />
    </Suspense>
  );
}