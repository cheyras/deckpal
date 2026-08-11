/**
 * Gallery for SignInPrompt — the "what would be here if you were signed in" slot-filler.
 */
import { SignInPrompt } from './SignInPrompt'
import type { GalleryMeta } from '../routes/design/galleryTypes'

export default {
  name: 'SignInPrompt',
  source: 'apps/web/src/components/SignInPrompt.tsx',
  section: 'component',
  description: 'Slot-filler shown for signed-out users. Inline or banner variant.',
  component: SignInPrompt,
  defaults: { title: 'Track your collection', variant: 'inline' as const },
  variants: [
    { label: 'inline', props: { title: 'Track your collection', variant: 'inline' as const } },
    { label: 'inline + detail', props: { title: 'Track your collection', detail: 'Sign in to mark cards you own and track progress.', variant: 'inline' as const } },
    { label: 'banner', props: { title: 'Track your collection', variant: 'banner' as const } },
    { label: 'banner + detail', props: { title: 'Start your Pokedex', detail: 'Log in to capture species and track your journey.', variant: 'banner' as const } },
  ],
  knobs: {
    title: { kind: 'text' },
    detail: { kind: 'text' },
    variant: { kind: 'select', options: ['inline', 'banner'] as const },
  },
} satisfies GalleryMeta<{ title: string; detail?: string; variant?: 'inline' | 'banner' }>
