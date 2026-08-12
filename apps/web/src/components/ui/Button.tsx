import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Spinner } from '../ui'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dashed'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  children?: ReactNode
}

// Variant defines colour, font weight and borders. The three filled variants
// (primary, secondary, danger) carry their convex/concave face and elevation
// via the .btn-fill-* classes in theme.css; ghost/dashed stay flat outlines.
//
// Every label sits one step heavier than the old Inter-era weights. Figtree is
// a rounder, more open face than Inter and reads lighter at the same numeric
// weight, and button labels are short bursts of text that need to hold against
// a saturated fill.
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'btn-fill-primary text-action-primary-text font-extrabold',
  secondary:
    'btn-fill-secondary text-text-primary font-bold',
  danger:
    'btn-fill-danger text-action-danger-text font-extrabold',
  ghost:
    'border border-action-ghost-border bg-surface-secondary text-text-primary hover:border-surface-raised hover:bg-action-ghost-hover font-bold',
  dashed:
    'border border-dashed border-border-default text-text-secondary hover:bg-surface-tertiary font-bold',
}

// Size defines height, text size and inter-child gap.
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-[36px] text-[14px] gap-[6px]',
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
      {loading && <Spinner inline size={16} />}
      {children}
    </button>
  )
})
