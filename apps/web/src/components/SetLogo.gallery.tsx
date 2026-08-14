/**
 * Gallery for SetLogo — set logo image with on-light plating for low-contrast logos.
 */
import { SetLogo } from './SetLogo'
import type { GalleryMeta } from '../routes/design/galleryTypes'

export default {
  name: 'SetLogo',
  source: 'apps/web/src/components/SetLogo.tsx',
  section: 'component',
  description: 'Set logo image with on-light "plate" behind it for logos that need light backgrounds.',
  component: SetLogo,
  defaults: { setId: 'swsh1', imgClassName: 'h-[60px] object-contain' },
  variants: [
    {
      label: 'regular',
      props: { setId: 'swsh1', imgClassName: 'h-[60px] object-contain' },
    },
    {
      label: 'large',
      props: { setId: 'sv1', imgClassName: 'h-[80px] object-contain' },
    },
    {
      label: 'small',
      props: { setId: 'xy1', imgClassName: 'h-[40px] object-contain' },
    },
  ],
  knobs: {
    setId: { kind: 'text' },
  },
} satisfies GalleryMeta<{
  setId: string
  alt?: string
  imgClassName: string
  platedImgClassName?: string
  plateClassName?: string
}>
