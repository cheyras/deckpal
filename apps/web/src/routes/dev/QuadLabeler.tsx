import { useEffect } from 'react'
import { QuadLabeler } from '../../scan/labeler/QuadLabeler'
import { startLegacyCaptureDrain } from '../../scan/labeler/captureMigration'

// Thin route entry, matching the other /dev/* pages (ScanHarness.tsx,
// Decke.tsx): the real component lives under scan/labeler/**, this file is
// only what main.tsx's lazyRoute() dynamically imports, so the labeler's
// code (and the engine chunk it pulls in on first use) ships in its own
// chunk rather than the app's entry bundle.
export default function QuadLabelerRoute() {
  // Finish moving any pre-2026-09-28 captures out of the public bucket, in the
  // background — see captureMigration.ts. Nothing on screen depends on it.
  useEffect(() => {
    void startLegacyCaptureDrain()
  }, [])
  return <QuadLabeler />
}
