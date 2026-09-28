import { useEffect } from 'react'
import { QuadHarvest } from '../../scan/labeler/QuadHarvest'
import { startLegacyCaptureDrain } from '../../scan/labeler/captureMigration'

// Thin route entry, matching QuadLabeler.tsx and the other /dev/* pages: the
// real component lives under scan/labeler/**, and this file is only what
// main.tsx's lazyRoute() dynamically imports, so the harvest view ships in its
// own chunk rather than the app's entry bundle.
export default function QuadHarvestRoute() {
  // Same background move as the labeler route — whichever one the reader opens
  // first after a deploy finishes it. See captureMigration.ts.
  useEffect(() => {
    void startLegacyCaptureDrain()
  }, [])
  return <QuadHarvest />
}
