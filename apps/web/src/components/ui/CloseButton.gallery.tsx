/**
 * Gallery for CloseButton — the one ✕ every sheet, dialog and overlay closes
 * with. The `corner` variants sit in a mock panel so the equal top/side inset
 * can be seen against a real edge.
 */
import { CloseButton, type CloseButtonProps } from './CloseButton'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

function Specimen(props: CloseButtonProps) {
  if (!props.corner) return <CloseButton {...props} />
  return (
    <div className="relative h-20 w-44 rounded-xl border border-border-default bg-surface-secondary">
      <CloseButton {...props} />
    </div>
  )
}

export const closeButtonGallery = {
  name: 'CloseButton',
  source: 'apps/web/src/components/ui/CloseButton.tsx',
  section: 'primitive',
  description:
    'A bare ✕ in a 44px hit box. `corner` pins it --spacing-corner from the top AND the side, so the glyph is as far from one edge as the other.',
  component: Specimen,
  defaults: { corner: true, label: 'Close', onClick: () => {} },
  knobs: {
    corner: { kind: 'boolean' },
    label: { kind: 'text' },
  },
  variants: [
    { label: 'corner of a panel', props: { corner: true, onClick: () => {} } },
    { label: 'in flow', props: { corner: false, onClick: () => {} } },
    { label: 'disabled', props: { corner: true, disabled: true, onClick: () => {} } },
  ],
} satisfies GalleryMeta<CloseButtonProps>

export default closeButtonGallery
