/**
 * Gallery for Sheet — the overlay primitive every modal in the app goes
 * through.
 *
 * `overlay: true` because Sheet renders `position: fixed; inset: 0` into a
 * portal on document.body. CatalogSection never mounts an overlay entry inline
 * (see the `overlay` doc comment in galleryTypes.ts) — it renders a
 * "click to open" trigger per variant and wires a real `onClose` when opened,
 * so the `onClose: () => {}` placeholders below are never actually called.
 *
 * Resize the window across the `nav:` breakpoint (1068px) while one is open:
 * below it a sheet is anchored to the bottom edge with a grab handle, above it
 * a centred dialog. The same component, no caller-side branching.
 */
import { Sheet, type SheetSize } from './Sheet'
import { Button } from './Button'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

const SHORT = <p className="text-[14px] text-text-body">A short message that does not need to scroll.</p>

// Deliberately taller than a phone viewport — this is the case that used to
// break. The panel must cap at 92dvh and scroll internally rather than
// overflowing off the top of the screen.
const LONG = (
  <div className="flex flex-col gap-[12px]">
    {Array.from({ length: 24 }, (_, i) => (
      <p key={i} className="text-[14px] text-text-body">
        Paragraph {i + 1}. The sheet caps its own height and scrolls this body,
        so nothing lands outside the viewport however long the content gets.
      </p>
    ))}
  </div>
)

const ACTIONS = (
  <div className="flex justify-end gap-[10px]">
    <Button variant="secondary">Cancel</Button>
    <Button>Save</Button>
  </div>
)

export const sheetGallery = {
  name: 'Sheet',
  source: 'apps/web/src/components/ui/Sheet.tsx',
  section: 'primitive',
  description:
    'Bottom sheet on phones, centred dialog from nav: up. Portalled to body, capped to the viewport, scroll-locked, focus-trapped.',
  component: Sheet,
  overlay: true,
  defaults: {
    title: 'Sheet title',
    onClose: () => {},
    size: 'md' as SheetSize,
    children: SHORT,
  },
  knobs: {
    title: { kind: 'text' },
    size: { kind: 'select', options: ['sm', 'md', 'lg', 'full'] as const },
  },
  variants: [
    { label: 'short', props: { title: 'Delete list', onClose: () => {}, children: SHORT } },
    {
      label: 'short + pinned actions',
      props: { title: 'Delete list', onClose: () => {}, children: SHORT, footer: ACTIONS, size: 'sm' as SheetSize },
    },
    {
      label: 'long — body scrolls, actions stay',
      props: { title: 'Long content', onClose: () => {}, children: LONG, footer: ACTIONS },
    },
    {
      label: 'wide (lg)',
      props: { title: 'Add Cards', onClose: () => {}, children: LONG, size: 'lg' as SheetSize },
    },
    {
      label: 'full — card sheet width',
      props: { title: 'Card details', onClose: () => {}, children: LONG, size: 'full' as SheetSize },
    },
  ],
} satisfies GalleryMeta<Parameters<typeof Sheet>[0]>

export default sheetGallery
