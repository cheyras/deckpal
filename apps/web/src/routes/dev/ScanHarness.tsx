import harnessUrl from './scan-harness.html?url'

// The P1 card-detector bakeoff harness (see roadmap/plans/card-scanner-redesign,
// p1-results/harness-hybrid.html). Kept byte-identical to the reviewed artifact
// rather than ported to React: the iframe fetches its own document so its
// OpenCV CSP exception does not weaken the app. allow="camera" lets its Live
// tab call getUserMedia — the reason this page exists as an app route at all
// (static hosts we tried deny the camera at the permissions-policy layer).
export default function ScanHarness() {
  return (
    <iframe
      title="Card-detector harness"
      src={harnessUrl}
      allow="camera"
      style={{ display: 'block', width: '100vw', height: '100vh', border: 0 }}
    />
  )
}
