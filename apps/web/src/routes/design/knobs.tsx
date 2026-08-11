/**
 * Knob control components for the design-system catalog.
 *
 * Each knob is a small, self-contained control that renders an editable
 * value for a single prop. The controls are intentionally minimal — no
 * external dependencies, native controls where possible.
 */

interface ColorKnobProps {
  value: string
  onChange: (v: string) => void
  label: string
}

/**
 * Color knob: native <input type="color"> + hex text field.
 * For rgb(r g b / a) values, shows the RGB part in the picker and
 * alpha as a separate 0-1 slider.
 */
export function ColorKnob({ value, onChange, label }: ColorKnobProps) {
  const isRgb = value.startsWith('rgb(')
  let hexPart = value
  let alpha = '1'

  if (isRgb) {
    const match = value.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/)
    if (match) {
      const [, r, g, b, a] = match
      hexPart = `#${Number(r).toString(16).padStart(2, '0')}${Number(g).toString(16).padStart(2, '0')}${Number(b).toString(16).padStart(2, '0')}`
      alpha = a
    }
  }

  return (
    <div className="flex items-center gap-[8px]">
      <label className="text-[11px] text-text-muted min-w-[100px] truncate" title={label}>
        {label}
      </label>
      <input
        type="color"
        value={hexPart.startsWith('#') ? (hexPart.length === 4 ? expandShortHex(hexPart) : hexPart) : '#000000'}
        onChange={(e) => {
          if (isRgb) {
            const hex = e.target.value
            const r = parseInt(hex.slice(1, 3), 16)
            const g = parseInt(hex.slice(3, 5), 16)
            const b = parseInt(hex.slice(5, 7), 16)
            onChange(`rgb(${r} ${g} ${b} / ${alpha})`)
          } else {
            onChange(e.target.value)
          }
        }}
        className="h-[28px] w-[28px] cursor-pointer rounded border border-border-default bg-transparent p-0"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[28px] w-[120px] rounded border border-border-default bg-surface-secondary px-[8px] text-[11px] text-text-primary font-mono"
      />
      {isRgb && (
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={alpha}
          onChange={(e) => {
            const match = value.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*[\d.]+\s*\)/)
            if (match) {
              const [, r, g, b] = match
              onChange(`rgb(${r} ${g} ${b} / ${e.target.value})`)
            }
          }}
          className="w-[60px]"
          title={`Alpha: ${alpha}`}
        />
      )}
    </div>
  )
}

function expandShortHex(hex: string): string {
  // #rgb -> #rrggbb
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
}

interface PxKnobProps {
  value: string
  onChange: (v: string) => void
  label: string
  min?: number
  max?: number
  step?: number
}

/**
 * Pixel value stepper — for radii, text sizes, breakpoints.
 */
export function PxKnob({ value, onChange, label, min = 0, max = 9999, step = 1 }: PxKnobProps) {
  const num = parseFloat(value) || 0

  return (
    <div className="flex items-center gap-[8px]">
      <label className="text-[11px] text-text-muted min-w-[100px] truncate" title={label}>
        {label}
      </label>
      <button
        className="h-[28px] w-[28px] rounded border border-border-default bg-surface-tertiary text-text-primary text-[14px] hover:bg-surface-quaternary"
        onClick={() => onChange(`${Math.max(min, num - step)}px`)}
      >
        -
      </button>
      <input
        type="number"
        value={num}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(`${e.target.value}px`)}
        className="h-[28px] w-[70px] rounded border border-border-default bg-surface-secondary px-[8px] text-[11px] text-text-primary text-center font-mono"
      />
      <button
        className="h-[28px] w-[28px] rounded border border-border-default bg-surface-tertiary text-text-primary text-[14px] hover:bg-surface-quaternary"
        onClick={() => onChange(`${Math.min(max, num + step)}px`)}
      >
        +
      </button>
      <span className="text-[10px] text-text-muted">px</span>
    </div>
  )
}

interface NumberKnobProps {
  value: string
  onChange: (v: string) => void
  label: string
  min?: number
  max?: number
  step?: number
}

/**
 * Raw number stepper — for z-index and other unitless values.
 */
export function NumberKnob({ value, onChange, label, min = -9999, max = 9999, step = 1 }: NumberKnobProps) {
  const num = parseInt(value, 10) || 0

  return (
    <div className="flex items-center gap-[8px]">
      <label className="text-[11px] text-text-muted min-w-[100px] truncate" title={label}>
        {label}
      </label>
      <input
        type="number"
        value={num}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className="h-[28px] w-[80px] rounded border border-border-default bg-surface-secondary px-[8px] text-[11px] text-text-primary text-center font-mono"
      />
    </div>
  )
}

interface TextKnobProps {
  value: string
  onChange: (v: string) => void
  label: string
}

/**
 * Free text field — for shadows, easing, font stacks.
 */
export function TextKnob({ value, onChange, label }: TextKnobProps) {
  return (
    <div className="flex items-center gap-[8px]">
      <label className="text-[11px] text-text-muted min-w-[100px] truncate" title={label}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[28px] flex-1 rounded border border-border-default bg-surface-secondary px-[8px] text-[11px] text-text-primary font-mono"
      />
    </div>
  )
}

interface SelectKnobProps {
  value: string
  onChange: (v: string) => void
  label: string
  options: readonly string[]
}

/**
 * Select knob — dropdown for font stacks and other enumerated values.
 */
export function SelectKnob({ value, onChange, label, options }: SelectKnobProps) {
  return (
    <div className="flex items-center gap-[8px]">
      <label className="text-[11px] text-text-muted min-w-[100px] truncate" title={label}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[28px] rounded border border-border-default bg-surface-secondary px-[8px] text-[11px] text-text-primary"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  )
}

interface BooleanKnobProps {
  value: boolean
  onChange: (v: boolean) => void
  label: string
}

/**
 * Boolean toggle for component prop knobs.
 */
export function BooleanKnob({ value, onChange, label }: BooleanKnobProps) {
  return (
    <div className="flex items-center gap-[8px]">
      <label className="text-[11px] text-text-muted min-w-[100px] truncate" title={label}>
        {label}
      </label>
      <button
        className={`h-[28px] rounded border px-[12px] text-[11px] font-medium ${
          value
            ? 'border-action-primary bg-action-primary/20 text-action-primary'
            : 'border-border-default bg-surface-tertiary text-text-muted'
        }`}
        onClick={() => onChange(!value)}
      >
        {value ? 'true' : 'false'}
      </button>
    </div>
  )
}

interface PropNumberKnobProps {
  value: number
  onChange: (v: number) => void
  label: string
  min?: number
  max?: number
  step?: number
}

/**
 * Number knob for component prop knobs (not token values).
 */
export function PropNumberKnob({ value, onChange, label, min = 0, max = 1000, step = 1 }: PropNumberKnobProps) {
  return (
    <div className="flex items-center gap-[8px]">
      <label className="text-[11px] text-text-muted min-w-[100px] truncate" title={label}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-[28px] w-[80px] rounded border border-border-default bg-surface-secondary px-[8px] text-[11px] text-text-primary text-center font-mono"
      />
    </div>
  )
}
