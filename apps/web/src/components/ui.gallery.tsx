/**
 * Gallery for ui.tsx primitives: Content, BackPill, SetSymbolTile, Spinner, ErrorState.
 */
import { Content, BackPill, SetSymbolTile, Spinner, ErrorState } from './ui'
import type { GalleryMeta } from '../routes/design/galleryTypes'

// ── Content ─────────────────────────────────────────────────────────────

const contentGallery = {
  name: 'Content',
  source: 'apps/web/src/components/ui.tsx',
  section: 'primitive',
  description: 'Page-body wrapper: responsive gutters + per-page max-width cap, centered.',
  component: Content,
  defaults: { children: 'Page content area', cap: 1165 },
  variants: [
    {
      label: 'default (1165)',
      props: {
        children: (
          <div className="rounded-lg border border-border-default bg-surface-tertiary p-[16px] text-[14px] text-text-muted">
            Content area at default 1165px cap
          </div>
        ),
        cap: 1165,
      },
    },
    {
      label: 'narrow (800)',
      props: {
        children: (
          <div className="rounded-lg border border-border-default bg-surface-tertiary p-[16px] text-[14px] text-text-muted">
            Content area at 800px cap
          </div>
        ),
        cap: 800,
      },
    },
  ],
  knobs: {
    cap: { kind: 'number', min: 200, max: 2000, step: 50 },
  },
} satisfies GalleryMeta<{ children: React.ReactNode; cap?: number }>

// ── BackPill ────────────────────────────────────────────────────────────

const backPillGallery = {
  name: 'BackPill',
  source: 'apps/web/src/components/ui.tsx',
  section: 'primitive',
  description: 'Pill-shaped "back to X" link, used at the top of every detail page.',
  component: BackPill,
  defaults: { to: '/series', label: 'Back to Series' },
  variants: [
    { label: 'default', props: { to: '/series', label: 'Back to Series' } },
    { label: 'with params', props: { to: '/series/$series', params: { series: 'sv' }, label: 'Back to Scarlet & Violet' } },
  ],
  knobs: {
    label: { kind: 'text' },
  },
} satisfies GalleryMeta<{ to: string; params?: Record<string, string>; label: string }>

// ── SetSymbolTile ───────────────────────────────────────────────────────

const setSymbolTileGallery = {
  name: 'SetSymbolTile',
  source: 'apps/web/src/components/ui.tsx',
  section: 'primitive',
  description: 'White tile showing a set symbol, with fallback ladders (promo star, energy marks, derived acronym).',
  component: SetSymbolTile,
  defaults: { setId: 'swsh1', hasSymbol: true, name: 'Sword & Shield', size: 40 },
  variants: [
    { label: 'with symbol', props: { setId: 'swsh1', hasSymbol: true, name: 'Sword & Shield', size: 40 } },
    { label: 'text fallback', props: { setId: 'xy10', hasSymbol: false, name: 'Fates Collide', size: 40 } },
    { label: 'promo set', props: { setId: 'swshp', hasSymbol: false, name: 'SWSH Black Star Promos', size: 40 } },
    { label: 'large', props: { setId: 'swsh1', hasSymbol: true, name: 'Sword & Shield', size: 64 } },
    { label: 'no data', props: { setId: null, hasSymbol: null, name: null, size: 40 } },
  ],
  knobs: {
    size: { kind: 'number', min: 20, max: 120, step: 4 },
  },
} satisfies GalleryMeta<{ setId?: string | null; hasSymbol?: boolean | null; name?: string | null; size?: number }>

// ── Spinner ─────────────────────────────────────────────────────────────

const spinnerGallery = {
  name: 'Spinner',
  source: 'apps/web/src/components/ui.tsx',
  section: 'primitive',
  description: 'Spin-ring loading indicator. Block mode (default) for page/section states; inline mode for embedding in buttons/text.',
  component: Spinner,
  defaults: { label: 'Loading...' },
  variants: [
    { label: 'block + label', props: { label: 'Loading cards...' } },
    { label: 'block (no label)', props: {} },
    { label: 'block small (24)', props: { size: 24 } },
    { label: 'inline (16)', props: { inline: true, size: 16 } },
    { label: 'inline (28)', props: { inline: true, size: 28 } },
  ],
  knobs: {
    label: { kind: 'text' },
    size: { kind: 'number', min: 8, max: 80, step: 2 },
    inline: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{ label?: string; size?: number; inline?: boolean }>

// ── ErrorState ──────────────────────────────────────────────────────────

const errorStateGallery = {
  name: 'ErrorState',
  source: 'apps/web/src/components/ui.tsx',
  section: 'primitive',
  description: 'Centered "Something went wrong" + message block.',
  component: ErrorState,
  defaults: { message: 'Failed to load card data' },
  variants: [
    { label: 'short', props: { message: 'Network error' } },
    { label: 'long', props: { message: 'Failed to fetch card details. The server may be unreachable. Check your connection and try again.' } },
  ],
  knobs: {
    message: { kind: 'text' },
  },
} satisfies GalleryMeta<{ message: string }>

// Default export: the first gallery; the rest are discovered via glob
// but each file exports one gallery. Since ui.tsx has multiple exports,
// we combine them by exporting the most representative one as default
// and the glob pattern picks up the file.
// For multi-export files, we export them separately as named exports
// and the CatalogSection renderer will handle all gallery exports.
export default contentGallery
export { backPillGallery, setSymbolTileGallery, spinnerGallery, errorStateGallery }
