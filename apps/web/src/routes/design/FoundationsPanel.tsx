/**
 * Foundations: the spacing scale, the motion tokens and the patterns built on
 * them, drawn rather than listed — /design → Tokens, above the token editor.
 *
 * The token editor below this shows every value and lets it be previewed;
 * this explains what the values are FOR, and shows them moving, which a row of
 * `220ms` text fields cannot.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SPACING_ROLES, SPACING_STEPS } from '../../lib/spacing'
import { DURATION, EASE, type DurationToken, type EaseToken } from '../../lib/motion'
import { useScrollEdge } from '../../lib/useScrollEdge'
import { prefersReducedMotion } from '../../lib/reducedMotion'
import { CloseButton } from '../../components/ui/CloseButton'

export function FoundationsPanel() {
  return (
    <div className="mb-6 space-y-3">
      <Section title="Spacing scale" summary="One 4px grid. Tailwind’s numeric utilities are the scale.">
        <SpacingScale />
      </Section>
      <Section title="Motion" summary="Five durations, five curves, and the rules that pick between them.">
        <Motion />
      </Section>
      <Section title="Patterns" summary="The scroll edge and the close control, built on the tokens above.">
        <Patterns />
      </Section>
    </div>
  )
}

function Section({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="rounded-lg bg-surface-secondary">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 rounded-lg px-4 py-3 text-left hover:bg-surface-tertiary"
      >
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-text-primary">{title}</span>
          <span className="mt-0.5 block text-[12px] text-text-muted">{summary}</span>
        </span>
        <span aria-hidden className="text-[14px] text-text-muted">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && <div className="space-y-4 px-4 pb-4">{children}</div>}
    </section>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-sm bg-surface-primary px-1 py-px font-mono text-[11px] text-text-body">{children}</code>
}

// ── Spacing ─────────────────────────────────────────────────────────────

function SpacingScale() {
  return (
    <>
      <p className="text-[12px] leading-[18px] text-text-body">
        <Code>--spacing: 4px</Code> makes <Code>p-4</Code> 16px and <Code>gap-1.5</Code> 6px. Write the step, never a
        bracket: <Code>px-4</Code>, not <Code>px-[16px]</Code>. Half steps exist only below 16px. In CSS,{' '}
        <Code>calc(var(--spacing) * 4)</Code>.
      </p>
      <ul className="space-y-1">
        {SPACING_STEPS.map((s) => (
          <li key={s.step} className="grid grid-cols-[52px_40px_1fr] items-center gap-2 text-[12px] sm:grid-cols-[60px_44px_96px_1fr]">
            <span className="font-mono text-text-primary">{s.step}</span>
            <span className="tabular-nums text-text-muted">{s.px}px</span>
            <span className="hidden h-2 items-center sm:flex">
              <span className="h-2 rounded-sm bg-action-primary" style={{ width: s.px }} />
            </span>
            <span className="min-w-0 text-text-muted">{s.use}</span>
          </li>
        ))}
      </ul>
      <div>
        <h4 className="text-[12px] font-semibold text-text-primary">Roles</h4>
        <p className="mt-0.5 text-[12px] text-text-muted">A value decided once that has to agree everywhere it appears.</p>
        <ul className="mt-2 space-y-1.5">
          {SPACING_ROLES.map((r) => (
            <li key={r.token} className="text-[12px] text-text-body">
              <Code>{r.utility}</Code> <span className="text-text-muted">· {r.px}px ·</span> {r.use}
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

// ── Motion ──────────────────────────────────────────────────────────────

const DURATION_USE: Record<DurationToken, string> = {
  instant: 'Press feedback, toggles',
  fast: 'Hover, colour, small state changes',
  base: 'Fades, exits, desktop dialogs — the default',
  slow: 'Overlay entrances: sheet, drawer',
  slower: 'Page entrance, long travel',
}

const EASE_USE: Record<EaseToken, string> = {
  standard: 'Colour and opacity',
  enter: 'Things arriving or settling (decelerate)',
  exit: 'Things leaving (accelerate)',
  sheet: 'Overlay travel — the iOS sheet curve',
  spring: 'Small arrivals, with a slight overshoot',
}

/** What each overlay actually uses, so a retune knows what it is moving. */
const PAIRINGS: { what: string; enter: string; exit: string }[] = [
  { what: 'Sheet (phone)', enter: 'slow · sheet', exit: 'base · exit' },
  { what: 'Dialog (desktop)', enter: 'base · enter', exit: 'fast · exit' },
  { what: 'Navigation drawer', enter: 'slow · sheet', exit: 'base · exit' },
  { what: 'Scrim', enter: 'base · enter', exit: 'base · exit' },
  { what: 'Menu → ✕', enter: 'slow · sheet', exit: 'slow · sheet' },
  { what: 'Released drag', enter: 'spring, from the release velocity', exit: 'thrown at the release speed' },
]

function Motion() {
  const [run, setRun] = useState(0)
  const reduced = prefersReducedMotion()
  return (
    <>
      <ul className="list-disc space-y-1 pl-5 text-[12px] leading-[18px] text-text-body">
        <li>Arrivals decelerate, departures accelerate.</li>
        <li>Exits are shorter than entrances — the reader has already decided.</li>
        <li>
          Overlays travel on <Code>ease-sheet</Code>: quick off the mark, long settle.
        </li>
        <li>Reduced motion removes travel, not feedback: slides become fades at the same duration.</li>
        <li>
          Animate <Code>transform</Code> and <Code>opacity</Code> only. Never a layout property.
        </li>
      </ul>
      {reduced && (
        <p className="rounded-md bg-surface-tertiary px-3 py-2 text-[12px] text-text-body">
          This device asks for reduced motion, so the app drops travel. The demos below still play when pressed.
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="h-8 rounded-full bg-action-primary px-4 text-[12px] font-bold text-action-primary-text hover:bg-action-primary-hover"
        >
          Play all
        </button>
        <span className="text-[11px] text-text-muted">Each dot travels the same distance on its own token.</span>
      </div>
      <div>
        <h4 className="text-[12px] font-semibold text-text-primary">Durations</h4>
        <ul className="mt-2 space-y-2.5">
          {(Object.keys(DURATION) as DurationToken[]).map((name) => (
            <li key={name}>
              <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <Code>--duration-{name}</Code>
                <span className="tabular-nums text-text-primary">{DURATION[name]}ms</span>
                <span className="text-text-muted">{DURATION_USE[name]}</span>
              </div>
              <Track run={run} duration={`var(--duration-${name})`} easing="var(--ease-sheet)" />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-[12px] font-semibold text-text-primary">Easings</h4>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2">
          {(Object.keys(EASE) as EaseToken[]).map((name) => (
            <li key={name} className="flex items-center gap-3 rounded-md bg-surface-primary p-2.5">
              <Curve value={EASE[name]} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px]">
                  <Code>ease-{name}</Code>
                </div>
                <div className="mt-1 text-[11px] text-text-muted">{EASE_USE[name]}</div>
                <Track run={run} duration="var(--duration-slower)" easing={`var(--ease-${name})`} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-[12px] font-semibold text-text-primary">Where they are used</h4>
        <table className="mt-2 w-full text-left text-[12px]">
          <thead className="text-text-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Surface</th>
              <th className="py-1 pr-3 font-medium">In</th>
              <th className="py-1 font-medium">Out</th>
            </tr>
          </thead>
          <tbody className="text-text-body">
            {PAIRINGS.map((p) => (
              <tr key={p.what} className="border-t border-divider-subtle">
                <td className="py-1.5 pr-3 text-text-primary">{p.what}</td>
                <td className="py-1.5 pr-3">{p.enter}</td>
                <td className="py-1.5">{p.exit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** A dot that crosses its track on the given duration and curve, on every `run`. */
function Track({ run, duration, easing }: { run: number; duration: string; easing: string }) {
  const [at, setAt] = useState(false)
  useEffect(() => {
    if (run) setAt((a) => !a)
  }, [run])
  return (
    <button
      type="button"
      onClick={() => setAt((a) => !a)}
      aria-label="Play"
      className="relative mt-1.5 block h-4 w-full rounded-full bg-surface-primary [container-type:inline-size]"
    >
      <span
        aria-hidden
        className="absolute left-0.5 top-0.5 block size-3 rounded-full bg-action-primary"
        style={{
          // `left` would be a layout property; the dot travels on transform,
          // as the rules above say everything should. `cqw` is the track's
          // own width, so the trip is the same length at any page width.
          transform: at ? 'translateX(calc(100cqw - 16px))' : 'none',
          transition: `transform ${duration} ${easing}`,
        }}
      />
    </button>
  )
}

/** The timing function, drawn: time across, progress up. */
function Curve({ value }: { value: string }) {
  const nums = value === 'ease' ? [0.25, 0.1, 0.25, 1] : (value.match(/-?[\d.]+/g) ?? []).map(Number)
  const [x1, y1, x2, y2] = nums.length === 4 ? nums : [0, 0, 1, 1]
  const s = 44
  const pad = 8
  const px = (x: number) => pad + x * s
  const py = (y: number) => pad + (1 - y) * s
  return (
    <svg width={s + pad * 2} height={s + pad * 2} viewBox={`0 0 ${s + pad * 2} ${s + pad * 2}`} aria-hidden className="shrink-0">
      <rect x={pad} y={pad} width={s} height={s} fill="none" stroke="var(--color-divider-subtle)" />
      <path
        d={`M${px(0)},${py(0)} C${px(x1)},${py(y1)} ${px(x2)},${py(y2)} ${px(1)},${py(1)}`}
        fill="none"
        stroke="var(--color-action-primary)"
        strokeWidth={2}
      />
    </svg>
  )
}

// ── Patterns ────────────────────────────────────────────────────────────

function Patterns() {
  return (
    <>
      <div>
        <h4 className="text-[12px] font-semibold text-text-primary">Scroll edge</h4>
        <p className="mt-0.5 text-[12px] leading-[18px] text-text-muted">
          Content passing under a bar fades and blurs into it, deepening as it scrolls, instead of being cut off by a
          line. A mask on the scroller (<Code>scroll-edge</Code>) and a blur strip over the edge (
          <Code>scroll-edge-blur</Code>), driven by <Code>useScrollEdge</Code>. Every Sheet has it; the app header has it
          over the page. Mark a sticky element <Code>data-scroll-edge-pin</Code> to keep it whole.
        </p>
        <ScrollEdgeDemo />
      </div>
      <div>
        <h4 className="text-[12px] font-semibold text-text-primary">Close control</h4>
        <p className="mt-0.5 text-[12px] leading-[18px] text-text-muted">
          One <Code>CloseButton</Code> everywhere: a bare ✕ with no disc, a 44px hit box, pinned{' '}
          <Code>--spacing-corner</Code> from the top and the side so the glyph sits as far from one as the other.
        </p>
        <div className="relative mt-2 h-24 max-w-[320px] rounded-xl border border-border-default bg-surface-primary">
          <span aria-hidden className="absolute left-4 top-4 text-[13px] font-bold text-text-primary">
            Sheet title
          </span>
          <CloseButton corner onClick={() => {}} label="Close (demo)" />
          {/* The two insets, measured onto the specimen. */}
          <span aria-hidden className="absolute right-0 top-[30px] h-px w-[24.5px] bg-action-primary/60" />
          <span aria-hidden className="absolute right-[30px] top-0 h-[24.5px] w-px bg-action-primary/60" />
        </div>
      </div>
      <div>
        <h4 className="text-[12px] font-semibold text-text-primary">Grab handle and drag to dismiss</h4>
        <p className="mt-0.5 text-[12px] leading-[18px] text-text-muted">
          On a phone the whole top bar of a sheet is the handle, and a pull down on the body when it is scrolled to the
          top drags the sheet too. It follows the finger 1:1 on <Code>transform</Code>, and when let go either leaves at
          the speed it was thrown or springs back carrying that speed. Open any Sheet under Primitives at phone width to
          try it.
        </p>
      </div>
    </>
  )
}

function ScrollEdgeDemo() {
  const host = useRef<HTMLDivElement>(null)
  const edge = useScrollEdge({ host })
  return (
    <div className="mt-2 flex h-56 max-w-[360px] flex-col overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
      <div className="flex h-11 shrink-0 items-center border-b border-border-default px-4 text-[13px] font-bold text-text-primary">
        Scroll me
      </div>
      <div ref={host} className="relative flex min-h-0 flex-1 flex-col">
        <div ref={edge} className="scroll-edge min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className="rounded-lg bg-surface-tertiary px-3 py-2.5 text-[12px] text-text-body shadow-panel">
              Row {i + 1} — its shadow fades into the bar instead of being sliced off by it.
            </div>
          ))}
        </div>
        <div aria-hidden className="scroll-edge-blur" />
        <div aria-hidden className="scroll-edge-blur" data-edge="bottom" />
      </div>
    </div>
  )
}
