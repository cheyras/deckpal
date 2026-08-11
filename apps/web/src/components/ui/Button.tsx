import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dashed'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  children?: ReactNode
}

// Variant defines colour, font weight and borders.
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-action-primary text-action-primary-text hover:bg-action-primary-hover font-bold',
  secondary:
    'bg-surface-tertiary text-text-primary hover:bg-action-default-hover font-semibold',
  danger:
    'bg-action-danger text-action-danger-text hover:bg-action-danger-hover font-bold',
  ghost:
    'border border-action-ghost-border bg-surface-secondary text-text-primary hover:border-surface-raised hover:bg-action-ghost-hover font-semibold',
  dashed:
    'border border-dashed border-border-default text-text-secondary hover:bg-surface-tertiary font-semibold',
}

// Size defines height, text size and inter-child gap.
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-[36px] text-[13px] gap-[6px]',
  md: 'h-[44px] text-[14px] gap-[8px]',
  lg: 'h-[48px] text-[15px] gap-[8px]',
}

// Prominent variants (primary, danger) get slightly wider padding to match the
// existing call sites; recessive variants (secondary, ghost, dashed) are narrower.
function paddingClass(variant: ButtonVariant, size: ButtonSize): string {
  const wide = variant === 'primary' || variant === 'danger'
  if (size === 'sm') return wide ? 'px-[18px]' : 'px-[14px]'
  if (size === 'lg') return wide ? 'px-[24px]' : 'px-[22px]'
  return wide ? 'px-[24px]' : 'px-[20px]' // md
}

/**
 * Build the className string for a button without rendering the component.
 * Use this when a non-button element (<Link>, <a>) needs the same visual
 * treatment — e.g. auth CTAs that render as TanStack Router links.
 */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
): string {
  return [
    'inline-flex items-center justify-center rounded-full disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    paddingClass(variant, size),
  ].join(' ')
}

/**
 * Button primitive — the one shared button in the design system.
 *
 * Variants: primary | secondary | danger | ghost | dashed
 * Sizes:    sm | md | lg
 *
 * `loading` renders an inline spinner and disables the button. Pass `loading`
 * for operations that may take time; pass `disabled` for inputs that are not
 * yet valid.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClass(variant, size)}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {loading && (
        <span className="h-[16px] w-[16px] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
})
