import { CounterBox } from './CounterBox'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

type Props = {
  label: string
  color: string
  dark: boolean
  qty: number
  disabled: boolean
  onInc: () => void
  onDec: () => void
}

export default {
  name: 'CounterBox',
  source: 'apps/web/src/components/ui/CounterBox.tsx',
  section: 'primitive',
  description:
    'Per-variant quantity counter: tap = +1, long-press/right-click = -1. Used in CardTile and TableView.',
  component: CounterBox,
  defaults: {
    label: 'Normal',
    color: 'var(--color-variant-normal)',
    dark: true,
    qty: 3,
    disabled: false,
    onInc: () => {},
    onDec: () => {},
  },
  variants: [
    {
      label: 'filled (normal)',
      props: { label: 'Normal', color: 'var(--color-variant-normal)', dark: true, qty: 2, disabled: false, onInc: () => {}, onDec: () => {} },
    },
    {
      label: 'filled (reverse)',
      props: { label: 'Reverse Holofoil', color: 'var(--color-variant-reverse-holo)', dark: false, qty: 1, disabled: false, onInc: () => {}, onDec: () => {} },
    },
    {
      label: 'filled (holofoil)',
      props: { label: 'Holofoil', color: 'var(--color-variant-holofoil)', dark: false, qty: 1, disabled: false, onInc: () => {}, onDec: () => {} },
    },
    {
      label: 'empty',
      props: { label: 'Normal', color: 'var(--color-variant-normal)', dark: true, qty: 0, disabled: false, onInc: () => {}, onDec: () => {} },
    },
    {
      label: 'disabled',
      props: { label: 'Normal', color: 'var(--color-variant-normal)', dark: true, qty: 1, disabled: true, onInc: () => {}, onDec: () => {} },
    },
  ],
  knobs: {
    qty: { kind: 'number', min: 0, max: 99, step: 1 },
    disabled: { kind: 'boolean' },
  },
} satisfies GalleryMeta<Props>
