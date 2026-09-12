# Browser boundary checks

Run `pnpm exec playwright install --with-deps chromium` once, then `pnpm test:browser`.
Build `@deckpal/storage` and `@deckpal/matching` first on a clean checkout.
`pnpm test:deploy-assets` runs the asset controls without starting a browser.
The workflow uses Node 24 and a frozen pnpm lockfile.

Reports and eight PNGs go to `TEST_ARTIFACT_DIR` (default `.cache/browser-tests`).
A local installation can set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; CI installs
the Chromium revision selected by pinned Playwright 1.63.0.

The SPA is built twice into owned temporary directories using the real Vite
configuration: cloud at `/`, self-host at `/deckpal/`. The strict server rejects
requests outside the mount, unknown API paths and missing static assets. Cloud's
synthetic Supabase URL is the same loopback server, including image fixtures.
The installed Stripe loader's exact SDK URL is fulfilled locally with an inert
stub; no third-party request reaches the network. Every other external request
fails. This suite does not test Stripe, authentication, real storage or Postgres.

Catalog responses are local fixtures assembled with the production announcement
selection, mapping and ordering helpers. Active, expired and normalized-name
suppression run independently of wall-clock time. The built UI must show complete
titles/dates/logos, exclude placeholders from counts and navigation, and preserve
real-row links at 1280 and 390 pixels. The separate database lane tests real SQL.

The test-only Vite entry imports actual DeckeChat and DeckeScreen. It is absent
from production entries/routes. A separate TypeScript check checks component
props. Tailwind explicitly scans the production components, with a rendered
position assertion guarding against an unstyled fixture.

Coverage replacing chatAccessibility source regexes:

| Previous source assertion | Rendered behavior |
| --- | --- |
| Polite, atomic live region and separation from messages | Persistent region is empty while busy; streaming text has no live ancestor; completed response announces |
| Expansion state, controlled ID and focus styles | Actual button expands with Enter, collapses with Space, retains its controlled region ID and visible keyboard focus |
| Tool mapper and retry callback wiring | Legacy ok/declined chip displays Cancelled; failed tool's real retry control reports its call ID |
| Named greeting, subhead and opener props | /me name reaches greeting; chosen persisted subhead renders; three openers fill without sending and rotate on reopening |
| Spent-credit branch and low-credit header | Low label renders; zero credits replace the textbox while transcript remains readable |
| Composer padding prop | Computed 20px mobile empty/12px desktop empty and 40px transcript bottom padding |
| Dismiss handlers and all three guards | Actual component receives child click, background drag, selection release and plain background click; only the last dismisses |
| Experimental label | Badge appears in the actual chat header |
| Motion policy | Actual reduced-motion chevron has zero transition; one small static guard retains the ban on literal blanket 0.01ms overrides |

Deployment checks derive local logos from the actual announcement metadata,
verify tracking and both ignore files, and keep marketing/character controls and
unrelated caches excluded. Removing each exact exception in a scratch matcher
must exclude the logo. Omitting each logo from a scratch copy of the real build
must fail the actual build gate. Git supplies gitignore-compatible matching;
the Vercel CLI and deployment service are not invoked.
