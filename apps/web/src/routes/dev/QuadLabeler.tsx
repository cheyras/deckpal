import { QuadLabeler } from '../../scan/labeler/QuadLabeler'

// Thin route entry, matching the other /dev/* pages (ScanHarness.tsx,
// Decke.tsx): the real component lives under scan/labeler/**, this file is
// only what main.tsx's lazyRoute() dynamically imports, so the labeler's
// code (and the engine chunk it pulls in on first use) ships in its own
// chunk rather than the app's entry bundle.
export default function QuadLabelerRoute() {
  return <QuadLabeler />
}
