import { EmptyState, type EmptyStateProps } from './EmptyState'
import { Button } from './Button'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

export default {
  name: 'EmptyState',
  source: 'apps/web/src/components/ui/EmptyState.tsx',
  section: 'primitive',
  description:
    'Centered placeholder with icon, title, optional body, and optional CTA. Dashed-border variant by default.',
  component: EmptyState,
  defaults: {
    icon: 'deck',
    title: 'No Decks Yet',
    body: 'Build one from scratch, or import a decklist.',
    variant: 'dashed',
  },
  variants: [
    {
      label: 'dashed + body',
      props: {
        icon: 'deck',
        title: 'No Decks Yet',
        body: 'Build one from scratch, or import a Pokémon TCG Live decklist.',
      },
    },
    {
      label: 'dashed + CTA',
      props: {
        icon: 'cards',
        title: 'This list is empty',
        children: <Button size="sm">Add Cards</Button>,
      },
    },
    {
      label: 'plain variant',
      props: {
        icon: 'search',
        title: 'No results',
        body: 'Try a different search term.',
        variant: 'plain' as const,
      },
    },
  ],
  knobs: {
    title: { kind: 'text' },
    body: { kind: 'text' },
    variant: { kind: 'select', options: ['dashed', 'plain'] as const },
  },
} satisfies GalleryMeta<EmptyStateProps>
