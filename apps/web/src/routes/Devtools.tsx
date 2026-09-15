import { Link } from '@tanstack/react-router'
import { Content, DataTable, EmptyState } from '../components/ui'
import { Icon } from '../components/Icon'
import { useAccess } from '../lib/access'
export const DEV_TOOLS = [
  { to: '/design', name: 'Design system', permission: 'design.view', description: 'Explore the UI kit and component states. Editing requires the local design service.' },
  { to: '/dev/chat-ui', name: 'Chat UI gallery', permission: 'diagnostics.view', description: 'Review synthetic chat states without starting a conversation.' },
  { to: '/dev/decke-compare', name: 'Character comparison', permission: 'diagnostics.view', description: 'Compare development character models and animation.' },
  { to: '/dev/scan-harness', name: 'Scanner harness', permission: 'diagnostics.view', description: 'Exercise detector fixtures and camera diagnostics.' },
  { to: '/dev/quad-labeler', name: 'Quad labeler', permission: 'scanner.label', description: 'Capture and annotate training photos in the shared photo corpus.' },
  { to: '/dev/quad-harvest', name: 'Training photo review', permission: 'scanner.label', description: 'Inspect captured training photos and labels.' },
]
export function Devtools() {
  const access = useAccess()
  const tools = access.ready && access.permissions.includes('devtools.access') ? DEV_TOOLS.filter(tool => access.permissions.includes(tool.permission)) : []
  return <Content><section className="min-w-0 space-y-[20px] pb-[40px]"><h1 className="font-display text-[32px] text-text-primary">Dev tools</h1><p className="max-w-[720px] text-text-muted">Development galleries, diagnostics and labeling tools. Product features are available through their own navigation and your profile feature preferences.</p><DataTable label="Development tools" rows={tools} getRowId={tool => tool.to} loading={!access.ready} empty={<EmptyState icon="gear" title="Dev tools unavailable" body="Your role does not have development tool access." />} columns={[
    { id: 'name', header: 'Tool', cell: tool => <Link to={tool.to} className="inline-flex items-center gap-[6px] font-semibold text-link">{tool.name}<Icon name="external" size={14} /></Link> },
    { id: 'description', header: 'Purpose', className: 'min-w-[260px] max-w-[620px]', cell: tool => tool.description },
  ]} /></section></Content>
}
