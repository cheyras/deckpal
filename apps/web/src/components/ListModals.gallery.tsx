/**
 * Gallery for ListModals — Modal, ConfirmModal.
 *
 * Modal is the shared dialog shell. ListFormModal and AddCardModal require
 * live data/queries and are noted in pending.ts; ConfirmModal is standalone.
 */
import { Modal, ConfirmModal } from './ListModals'
import type { GalleryMeta } from '../routes/design/galleryTypes'

export const modalGallery = {
  name: 'Modal',
  source: 'apps/web/src/components/ListModals.tsx',
  section: 'component',
  description: 'Shared dialog shell with title, close button, and scrim overlay.',
  component: Modal,
  defaults: {
    title: 'Edit list',
    onClose: () => {},
    children: (
      <div className="p-[16px] text-[13px] text-text-body">
        Modal content goes here.
      </div>
    ),
    wide: false,
  },
  variants: [
    {
      label: 'default',
      props: {
        title: 'Create a new list',
        onClose: () => {},
        children: (
          <div className="p-[16px] text-[13px] text-text-body">
            Form fields would go here.
          </div>
        ),
      },
    },
    {
      label: 'wide',
      props: {
        title: 'Search cards',
        onClose: () => {},
        wide: true,
        children: (
          <div className="p-[16px] text-[13px] text-text-body">
            Wide modal for search/card-add flows.
          </div>
        ),
      },
    },
  ],
  knobs: {
    title: { kind: 'text' },
    wide: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}>

export const confirmModalGallery = {
  name: 'ConfirmModal',
  source: 'apps/web/src/components/ListModals.tsx',
  section: 'component',
  description: 'Confirmation dialog with message, confirm/cancel buttons, and busy state.',
  component: ConfirmModal,
  defaults: {
    title: 'Delete list',
    message: 'Are you sure you want to delete "My Favorites"? This cannot be undone.',
    confirmLabel: 'Delete',
    onClose: () => {},
    onConfirm: () => {},
    busy: false,
  },
  variants: [
    {
      label: 'delete',
      props: {
        title: 'Delete list',
        message: 'Are you sure you want to delete "My Favorites"? This cannot be undone.',
        confirmLabel: 'Delete',
        onClose: () => {},
        onConfirm: () => {},
      },
    },
    {
      label: 'busy',
      props: {
        title: 'Delete deck',
        message: 'Deleting "Charizard ex"...',
        confirmLabel: 'Deleting...',
        onClose: () => {},
        onConfirm: () => {},
        busy: true,
      },
    },
  ],
  knobs: {
    title: { kind: 'text' },
    message: { kind: 'text' },
    confirmLabel: { kind: 'text' },
    busy: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  title: string
  message: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => void
  busy?: boolean
}>

export default modalGallery
