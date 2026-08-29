import harnessHtml from './scan-harness.html?raw'

// The P1 card-detector bakeoff harness (see roadmap/plans/card-scanner-redesign,
// p1-results/harness-hybrid.html). Kept byte-identical to the reviewed artifact
// rather than ported to React: the srcdoc iframe runs it on this same secure
// origin, and allow="camera" is what lets its Live tab call getUserMedia — the
// reason this page exists as an app route at all (static hosts we tried deny
// the camera at the permissions-policy layer).
export default function ScanHarness() {
  return (
    <iframe
      title="Card-detector harness"
      srcDoc={harnessHtml}
      allow="camera"
      style={{ display: 'block', width: '100vw', height: '100vh', border: 0 }}
    />
  )
}
