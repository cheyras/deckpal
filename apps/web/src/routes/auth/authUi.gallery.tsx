/**
 * Gallery for authUi.tsx primitives: Field, SubmitButton, FormAlert, StatusPanel.
 *
 * AuthPage and AuthCard are layout wrappers — cataloged but with simple
 * content-slot previews rather than interactive knobs.
 */
import { Field, SubmitButton, FormAlert, StatusPanel, AuthPage, AuthCard } from './authUi'
import type { GalleryMeta } from '../design/galleryTypes'
import type { IconName } from '../../components/Icon'

export const fieldGallery = {
  name: 'Field',
  source: 'apps/web/src/routes/auth/authUi.tsx',
  section: 'primitive',
  description: 'Labeled <input> with error/hint text and aria-invalid/aria-describedby wiring. The closest thing to a generic TextInput in this codebase.',
  component: Field,
  defaults: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
  variants: [
    { label: 'text', props: { label: 'Username', type: 'text', placeholder: 'Choose a username' } },
    { label: 'email', props: { label: 'Email', type: 'email', placeholder: 'you@example.com' } },
    { label: 'password', props: { label: 'Password', type: 'password', placeholder: 'Enter password' } },
    { label: 'with error', props: { label: 'Email', type: 'email', error: 'This email is already taken' } },
    { label: 'with hint', props: { label: 'Password', type: 'password', hint: 'At least 8 characters' } },
    { label: 'disabled', props: { label: 'Email', type: 'email', disabled: true, value: 'locked@example.com' } },
  ],
  knobs: {
    label: { kind: 'text' },
    error: { kind: 'text' },
    hint: { kind: 'text' },
    disabled: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  label: string
  type?: string
  placeholder?: string
  error?: string | null
  hint?: string
  disabled?: boolean
  value?: string
}>

export const submitButtonGallery = {
  name: 'SubmitButton',
  source: 'apps/web/src/routes/auth/authUi.tsx',
  section: 'primitive',
  description: 'Full-width primary submit button with built-in loading spinner.',
  component: SubmitButton,
  defaults: { children: 'Sign in', loading: false, disabled: false },
  variants: [
    { label: 'default', props: { children: 'Sign in' } },
    { label: 'loading', props: { children: 'Signing in...', loading: true } },
    { label: 'disabled', props: { children: 'Sign in', disabled: true } },
    { label: 'long text', props: { children: 'Create your free account' } },
  ],
  knobs: {
    loading: { kind: 'boolean' },
    disabled: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  children: React.ReactNode
  loading?: boolean
  disabled?: boolean
}>

export const formAlertGallery = {
  name: 'FormAlert',
  source: 'apps/web/src/routes/auth/authUi.tsx',
  section: 'primitive',
  description: 'Inline role="alert" banner with error/info/success tone variants.',
  component: FormAlert,
  defaults: { kind: 'error' as const, children: 'Invalid email or password.' },
  variants: [
    { label: 'error', props: { kind: 'error' as const, children: 'Invalid email or password.' } },
    { label: 'info', props: { kind: 'info' as const, children: 'Check your email for a verification link.' } },
    { label: 'success', props: { kind: 'success' as const, children: 'Password updated successfully.' } },
  ],
  knobs: {
    kind: { kind: 'select', options: ['error', 'info', 'success'] as const },
  },
} satisfies GalleryMeta<{
  kind: 'error' | 'info' | 'success'
  children: React.ReactNode
}>

export const statusPanelGallery = {
  name: 'StatusPanel',
  source: 'apps/web/src/routes/auth/authUi.tsx',
  section: 'primitive',
  description: 'Terminal-state card: haloed icon + title + body + actions. Used for "check your email" / "reset link sent" screens.',
  component: StatusPanel,
  defaults: {
    icon: 'mail' as IconName,
    tone: 'success' as const,
    title: 'Check your email',
    children: 'We sent a password reset link to your email address.',
  },
  variants: [
    {
      label: 'success',
      props: {
        icon: 'mail' as IconName,
        tone: 'success' as const,
        title: 'Check your email',
        children: 'We sent a verification link to your email.',
      },
    },
    {
      label: 'neutral',
      props: {
        icon: 'check-circle' as IconName,
        tone: 'neutral' as const,
        title: 'Password changed',
        children: 'Your password has been updated. You can now sign in.',
      },
    },
  ],
  knobs: {
    tone: { kind: 'select', options: ['success', 'neutral'] as const },
  },
} satisfies GalleryMeta<{
  icon: IconName
  tone?: 'success' | 'neutral'
  title: string
  children: React.ReactNode
  actions?: React.ReactNode
}>

export default fieldGallery
