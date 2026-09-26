import { ToastView, type ToastViewProps } from './Toast'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

const noop = () => {}

export default {
  name: 'Toast',
  source: 'apps/web/src/components/ui/Toast.tsx',
  section: 'primitive',
  description:
    'The one transient message: a save that failed (Retry) or a destructive change that can be undone (Undo). One at a time, bottom-right, above the offline banner.',
  component: ToastView,
  defaults: {
    tone: 'error',
    message: 'Couldn’t save 3 × Charizard ex in “Lost Box”.',
    actionLabel: 'Retry',
    onAction: noop,
    onDismiss: noop,
  },
  variants: [
    {
      label: 'failed save, retryable',
      props: { tone: 'error', message: 'Couldn’t add Charizard ex to “Trade binder”.', actionLabel: 'Retry', onAction: noop, onDismiss: noop },
    },
    {
      label: 'failed save, with a reason',
      props: { tone: 'error', message: 'Couldn’t remove Pikachu from “Charizard chase”. You’re offline.', actionLabel: 'Retry', onAction: noop, onDismiss: noop },
    },
    {
      label: 'failed save, not repeatable',
      props: { tone: 'error', message: 'Couldn’t add 2 × Rare Candy to “Lost Box”.', onDismiss: noop },
    },
    {
      label: 'undoable change',
      props: { tone: 'info', message: 'Moved “Trade binder” to Recently deleted.', actionLabel: 'Undo', onAction: noop, onDismiss: noop },
    },
  ],
  knobs: {
    tone: { kind: 'select', options: ['error', 'info'] },
    message: { kind: 'text' },
    actionLabel: { kind: 'text' },
  },
} satisfies GalleryMeta<ToastViewProps>
