/**
 * Gallery for ValueChart — hand-rolled SVG line chart for collection value over time.
 */
import { ValueChart } from './ValueChart'
import type { GalleryMeta } from '../routes/design/galleryTypes'

// Fixture data: 30 days of sample collection values
const FIXTURE_POINTS = Array.from({ length: 30 }, (_, i) => {
  const value = 1200 + Math.sin(i / 3) * 200 + i * 15
  return { date: new Date(2026, 7, i + 1).toISOString().slice(0, 10), value, valueMinor: Math.round(value * 100) }
})

const FLAT_POINTS = Array.from({ length: 10 }, (_, i) => ({
  date: new Date(2026, 7, i + 1).toISOString().slice(0, 10),
  value: 500,
  valueMinor: 50000,
}))

const RISING_POINTS = Array.from({ length: 20 }, (_, i) => {
  const value = 800 + i * 50
  return { date: new Date(2026, 7, i + 1).toISOString().slice(0, 10), value, valueMinor: Math.round(value * 100) }
})

// Two printings of one card, on different observation days — the card modal's
// Price tab. Deliberately NOT aligned: the Reverse starts later and skips a day,
// which is what makes the date-based x scale visible (an index scale would draw
// them as if they shared dates).
const MULTI_SERIES = [
  {
    label: 'Normal',
    color: 'var(--color-variant-normal)',
    points: Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10),
      value: 2.2 + Math.sin(i / 2) * 0.4,
    })),
  },
  {
    label: 'Reverse Holofoil',
    color: 'var(--color-variant-reverse-holo)',
    points: Array.from({ length: 9 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 7, i * 1.5 + 4)).toISOString().slice(0, 10),
      value: 5.8 + Math.cos(i / 2) * 0.9,
    })),
  },
]

export default {
  name: 'ValueChart',
  source: 'apps/web/src/components/ValueChart.tsx',
  section: 'component',
  description: 'Hand-rolled SVG line chart (zero charting dependency) for collection value over time.',
  component: ValueChart,
  defaults: { points: FIXTURE_POINTS, currency: 'USD', height: 240 },
  variants: [
    { label: 'normal', props: { points: FIXTURE_POINTS, currency: 'USD', height: 240 } },
    { label: 'flat', props: { points: FLAT_POINTS, currency: 'USD', height: 240 } },
    { label: 'rising', props: { points: RISING_POINTS, currency: 'EUR', height: 200 } },
    { label: 'compact', props: { points: FIXTURE_POINTS, currency: 'USD', height: 120 } },
    { label: 'empty', props: { points: [], currency: 'USD', height: 240 } },
    { label: 'two printings', props: { series: MULTI_SERIES, currency: 'USD', height: 200 } },
  ],
  knobs: {
    currency: { kind: 'select', options: ['USD', 'EUR', 'GBP', 'JPY'] },
    height: { kind: 'number', min: 100, max: 400, step: 20 },
  },
} satisfies GalleryMeta<{
  // `points` is the one-series shorthand; `series` is the general shape the card
  // modal's Price tab uses (one line per printing). Both optional here so a
  // gallery variant can supply either.
  points?: Array<{ date: string; value: number; valueMinor: number }>
  series?: Array<{ label: string; color: string; points: Array<{ date: string; value: number }> }>
  currency: string
  height?: number
}>
