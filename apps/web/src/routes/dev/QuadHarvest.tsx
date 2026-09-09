import { QuadHarvest } from '../../scan/labeler/QuadHarvest'

// Thin route entry, matching QuadLabeler.tsx and the other /dev/* pages: the
// real component lives under scan/labeler/**, and this file is only what
// main.tsx's lazyRoute() dynamically imports, so the harvest view ships in its
// own chunk rather than the app's entry bundle.
export default function QuadHarvestRoute() {
  return <QuadHarvest />
}
