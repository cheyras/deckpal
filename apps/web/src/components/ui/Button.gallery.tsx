import { Button, type ButtonProps } from './Button'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

export default {
  name: 'Button',
  source: 'apps/web/src/components/ui/Button.tsx',
  section: 'primitive',
  description:
    'Shared button primitive — variants primary|secondary|danger|ghost|dashed, sizes sm|md|lg, disabled + loading states.',
  component: Button,
  defaults: { variant: 'primary', size: 'md', children: 'Save changes' },
  variants: [
    { label: 'primary / md', props: { variant: 'primary', size: 'md', children: 'Save' } },
    { label: 'secondary / md', props: { variant: 'secondary', size: 'md', children: 'Cancel' } },
    { label: 'danger / md', props: { variant: 'danger', size: 'md', children: 'Delete' } },
    { label: 'ghost / md', props: { variant: 'ghost', size: 'md', children: 'Sign in' } },
    { label: 'dashed / md', props: { variant: 'dashed', size: 'md', children: 'Add item' } },
    { label: 'primary / sm', props: { variant: 'primary', size: 'sm', children: 'Add' } },
    { label: 'primary / lg', props: { variant: 'primary', size: 'lg', children: 'Create account' } },
    { label: 'primary / disabled', props: { variant: 'primary', size: 'md', disabled: true, children: 'Save' } },
    { label: 'primary / loading', props: { variant: 'primary', size: 'md', loading: true, children: 'Saving…' } },
    { label: 'danger / loading', props: { variant: 'danger', size: 'md', loading: true, children: 'Deleting…' } },
  ],
  knobs: {
    variant: { kind: 'select', options: ['primary', 'secondary', 'danger', 'ghost', 'dashed'] as const },
    size: { kind: 'select', options: ['sm', 'md', 'lg'] as const },
    disabled: { kind: 'boolean' },
    loading: { kind: 'boolean' },
  },
} satisfies GalleryMeta<ButtonProps>
