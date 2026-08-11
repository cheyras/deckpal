import { SelectableCard, type SelectableCardProps } from './SelectableCard'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

export default {
  name: 'SelectableCard',
  source: 'apps/web/src/components/ui/SelectableCard.tsx',
  section: 'primitive',
  description:
    'Option card with active/inactive border treatment — gold border when selected, translucent when not.',
  component: SelectableCard,
  defaults: {
    active: true,
    children: (
      <div>
        <div className="text-[14px] font-bold text-text-primary">Standard</div>
        <div className="text-[11px] text-text-muted">Regulation F and newer cards only</div>
      </div>
    ),
  },
  variants: [
    {
      label: 'active',
      props: {
        active: true,
        children: (
          <div>
            <div className="text-[14px] font-bold text-text-primary">Standard</div>
            <div className="text-[11px] text-text-muted">Regulation F and newer cards only</div>
          </div>
        ),
      },
    },
    {
      label: 'inactive',
      props: {
        active: false,
        children: (
          <div>
            <div className="text-[14px] font-bold text-text-primary">Expanded</div>
            <div className="text-[11px] text-text-muted">Black & White era and newer</div>
          </div>
        ),
      },
    },
  ],
  knobs: {
    active: { kind: 'boolean' },
  },
} satisfies GalleryMeta<SelectableCardProps>
