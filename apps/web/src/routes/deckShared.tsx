import type { DeckFormat } from '../lib/api'
import { Icon } from '../components/Icon'

export const FORMAT_META: Record<DeckFormat, { label: string; short: string; blurb: string }> = {
  standard: { label: 'Standard', short: 'Standard', blurb: 'Current regulation marks + reprints.' },
  expanded: { label: 'Expanded', short: 'Expanded', blurb: 'Black & White onward, 27-card ban list.' },
  glc: { label: 'Gym Leader Challenge', short: 'GLC', blurb: 'Singleton, single type, no Rule Box.' },
  unlimited: { label: 'Unlimited', short: 'Unlimited', blurb: 'Every US-released card, no ban list.' },
}

// pkmn.gg shows an orange "Not Legal" pill (DECK-FORMATS §5.6 / BEHAVIOR-SPEC §8.4)
// and a green legal state. No dedicated orange token in the theme — use an inline hue.
const ORANGE = '#ff9d42'

export function LegalBadge({ legal, onClick, big }: { legal: boolean; onClick?: () => void; big?: boolean }) {
  const cls = big ? 'px-[14px] py-[7px] text-[13px]' : 'px-[10px] py-[3px] text-[11px]'
  if (legal) {
    return (
      <span className={`inline-flex items-center gap-[6px] rounded-full font-bold ${cls}`} style={{ background: 'rgba(50,255,206,0.16)', color: 'var(--color-success)' }}>
        <Icon name="check-circle" size={big ? 16 : 13} /> Legal
      </span>
    )
  }
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={onClick}
      className={`inline-flex items-center gap-[6px] rounded-full font-bold ${cls} ${onClick ? 'hover:opacity-90' : ''}`}
      style={{ background: 'rgba(255,157,66,0.18)', color: ORANGE }}
    >
      <Icon name="alert" size={big ? 16 : 13} /> Not Legal
    </Tag>
  )
}
